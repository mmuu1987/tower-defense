#!/usr/bin/env node
// 头顶投影探针（v2）：对每个敌人模型（rotation.y=0，面向 +Z），
// 用 getVertexPosition 取世界坐标顶点，从 +X 方向正交投影 (z,y)，
// 统计"最高 15%" 顶点的质心 z 相对剪影 z 中心的偏移。
// 偏移 > 0 → 头顶在 +Z 侧 → 模型正面朝 +Z（与代码 yaw=π 一致）
// 偏移 < 0 → 头顶在 -Z 侧 → 模型正面朝 -Z（yaw=π 会视觉反转 180°）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const URL_TARGET = process.argv[2] || 'http://127.0.0.1:8137/?level=0,0';
const OUT = process.argv[3] || 'logs/shot-sil2.png';

const BROWSERS = [
  process.env.TD_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const exe = BROWSERS.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!exe) { console.error('[sil2] no browser found'); process.exit(3); }

const PORT = 9346;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-sil2-'));
const child = spawn(exe, [
  '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${PORT}`,
  '--window-size=1280,720', '--hide-scrollbars', URL_TARGET,
], { stdio: 'ignore' });
const cleanup = () => { try { child.kill(); } catch {} try { fs.rmSync(prof, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanup);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(300);
  }
  throw new Error('devtools endpoint not reachable');
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const data = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8');
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  };
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('cdp timeout ' + method)); } }, 25000);
  });
  return { ready, call };
}

const EVAL = `(async () => {
  let b = null, D = null;
  for (let i = 0; i < 200; i++) {
    D = window.__TD_DEBUG;
    b = D && D.battle();
    if (b) break;
    await new Promise(r => setTimeout(r, 300));
  }
  if (!b) return String(window.__TD_FATAL || 'no-battle');
  await new Promise(r => setTimeout(r, 1500));
  const types = ['grunt','runner','tank','flyer','healer','splitter','meadow','lava','frost'];
  const results = [];
  for (const t of types) {
    b.spawnEnemy(t);
    const e = b.enemies[b.enemies.length - 1];
    if (!e || !e.alive) { results.push({ type: t, fail: true }); continue; }
    e.baseSpeed = 0.0001;
    e.sampler = { total: 999, at: (d, o) => o.set(0, 0, 0), tangentAt: (d, o) => o.set(0, 0, 1) };
    e.pos.set(0, 0, 0);
    e.mesh.position.set(0, 0, 0);
    e.mesh.rotation.y = 0; // 面向 +Z
    // 手动更新骨骼（确保 SkinnedMesh 的骨骼矩阵正确）
    e.mesh.traverse((o) => { if (o.isSkinnedMesh && o.skeleton) o.skeleton.update(); });
    e.mesh.updateMatrixWorld(true);
    // 收集世界顶点
    const pts = [];
    const Vec3 = e.mesh.position.constructor; // THREE.Vector3
    const v = new Vec3();
    e.mesh.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      const pos = o.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 500));
      const m = o.matrixWorld;
      for (let i = 0; i < pos.count; i += step) {
        v.x = pos.getX(i); v.y = pos.getY(i); v.z = pos.getZ(i);
        v.applyMatrix4(m);
        pts.push({ y: v.y, z: v.z });
      }
    });
    if (!pts.length) { results.push({ type: t, noPts: true }); continue; }
    let yMin = Infinity, yMax = -Infinity, zMin = Infinity, zMax = -Infinity;
    for (const p of pts) {
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
      if (p.z < zMin) zMin = p.z;
      if (p.z > zMax) zMax = p.z;
    }
    // 最高 15% 顶点（头顶/耳朵/天线区）
    const thr = yMin + (yMax - yMin) * 0.85;
    let topZSum = 0, topN = 0;
    for (const p of pts) {
      if (p.y >= thr) { topZSum += p.z; topN++; }
    }
    const topCz = topN ? topZSum / topN : (zMin + zMax) / 2;
    const midZ = (zMin + zMax) / 2;
    results.push({
      type: t, model: e.def.model ? e.def.model.name : 'proc',
      zRange: [+zMin.toFixed(2), +zMax.toFixed(2)],
      yMax: +yMax.toFixed(2),
      topCz: +topCz.toFixed(2),
      headOffset: +(topCz - midZ).toFixed(2), // >0 → 头在 +Z 侧
    });
    e.dispose(D.scene);
    b.enemies = b.enemies.filter((x) => x !== e);
  }
  return JSON.stringify(results);
})()`;

try {
  const wsUrl = await findTarget();
  const { ready, call } = cdp(wsUrl);
  await ready;
  await call('Page.enable');
  await call('Runtime.enable');

  const t0 = Date.now();
  let okState = null;
  while (Date.now() - t0 < 30000) {
    const r = await call('Runtime.evaluate', { expression: '({ready: !!window.__TD_READY, fatal: window.__TD_FATAL || null})', returnByValue: true });
    const v = r.result.value || {};
    if (v.fatal) { console.error('[sil2] page fatal:\n' + v.fatal); process.exit(2); }
    if (v.ready) { okState = 'ready'; break; }
    await sleep(400);
  }
  if (!okState) { console.error('[sil2] timeout waiting __TD_READY'); process.exit(4); }

  await sleep(1200);
  const r = await call('Runtime.evaluate', { expression: EVAL, returnByValue: true, awaitPromise: true });
  console.log('[sil2] ' + JSON.stringify(r.result?.value ?? r.result ?? null));
  if (r.exceptionDetails) console.log('[sil2-exception] ' + JSON.stringify(r.exceptionDetails).slice(0, 800));

  const shot = await call('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(shot.data, 'base64');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, buf);
  console.log(`[sil2] saved ${OUT} (${buf.length} bytes)`);
  process.exit(0);
} catch (e) {
  console.error('[sil2] ' + e.message);
  process.exit(1);
}
