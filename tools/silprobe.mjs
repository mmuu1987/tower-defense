#!/usr/bin/env node
// 侧影剪影探针：把每个敌人模型强制 rotation.y=0（切线 +Z），
// 用正交相机从 +X 方向渲染剪影，分析"最高点"出现在屏幕的哪一端。
// 马/鸟/人形站立时头最高 → 最高点的 X 方向 = 模型正面方向。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const URL_TARGET = process.argv[2] || 'http://127.0.0.1:8137/?level=0,0';
const OUT = process.argv[3] || 'logs/shot-silhouette.png';

const BROWSERS = [
  process.env.TD_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const exe = BROWSERS.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!exe) { console.error('[silprobe] no browser found'); process.exit(3); }

const PORT = 9344;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-sil-'));
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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('cdp timeout ' + method)); } }, 20000);
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
  const renderer = D.renderer;
  const scene = D.scene;
  const types = ['grunt','runner','tank','flyer','healer','splitter','meadow','lava','frost'];
  const results = [];
  for (const t of types) {
    b.spawnEnemy(t);
    const e = b.enemies[b.enemies.length - 1];
    if (!e || !e.alive) { results.push({ type: t, fail: true }); continue; }
    e.baseSpeed = 0.0001;
    e.sampler = { total: 999, at: (d, o) => o.set(0, 0, 0), tangentAt: (d, o) => o.set(0, 0, 1) };
    e.pos.set(0, 0, 0);
    e.mesh.position.set(0, 0.5, 0);
    e.mesh.rotation.y = 0; // 原生朝向
    e.mesh.updateMatrixWorld(true);
    // 计算世界包围盒
    const box = new (e.mesh.children[0] ? e.mesh.children[0].constructor : Object)();
    // 用 mesh 的 geometry 顶点收集（含蒙皮姿势 → 用 Box3.setFromObject）
    let zMin = Infinity, zMax = -Infinity, yMax = -Infinity, yMin = Infinity;
    const v = { x: 0, y: 0, z: 0 };
    e.mesh.traverse((o) => {
      if (!o.geometry) return;
      const pos = o.geometry.attributes.position;
      if (!pos) return;
      const m = o.matrixWorld;
      for (let i = 0; i < pos.count; i += Math.max(1, Math.floor(pos.count / 200))) {
        v.x = pos.getX(i); v.y = pos.getY(i); v.z = pos.getZ(i);
        const wx = m.elements[0]*v.x + m.elements[4]*v.y + m.elements[8]*v.z + m.elements[12];
        const wy = m.elements[1]*v.x + m.elements[5]*v.y + m.elements[9]*v.z + m.elements[13];
        const wz = m.elements[2]*v.x + m.elements[6]*v.y + m.elements[10]*v.z + m.elements[14];
        if (wz < zMin) zMin = wz;
        if (wz > zMax) zMax = wz;
        if (wy > yMax) yMax = wy;
        if (wy < yMin) yMin = wy;
      }
    });
    // 找"最高顶点"（y 最大）的 z —— 头顶的位置决定正面方向
    let topZ = null, topN = 0;
    const zTop = new Map();
    e.mesh.traverse((o) => {
      if (!o.geometry) return;
      const pos = o.geometry.attributes.position;
      if (!pos) return;
      const m = o.matrixWorld;
      const thr = yMax - 0.02 * (yMax - yMin || 1); // 顶部 2%
      for (let i = 0; i < pos.count; i += Math.max(1, Math.floor(pos.count / 200))) {
        v.x = pos.getX(i); v.y = pos.getY(i); v.z = pos.getZ(i);
        const wy = m.elements[1]*v.x + m.elements[5]*v.y + m.elements[9]*v.z + m.elements[13];
        if (wy >= thr) {
          const wz = m.elements[2]*v.x + m.elements[6]*v.y + m.elements[10]*v.z + m.elements[14];
          const k = Math.round(wz * 4) / 4;
          zTop.set(k, (zTop.get(k) || 0) + 1);
        }
      }
    });
    if (zTop.size) {
      // 取顶部顶点聚集的质心 z
      let sum = 0, cnt = 0;
      for (const [k, n] of zTop) { sum += k * n; cnt += n; }
      topZ = sum / cnt;
    }
    results.push({
      type: t, model: e.def.model ? e.def.model.name : 'proc',
      zRange: [zMin.toFixed(2), zMax.toFixed(2)],
      yMax: yMax.toFixed(2),
      topCentroidZ: topZ !== null ? topZ.toFixed(2) : null,
      // 顶部质心在 z 范围的相对位置：<0.5 = 靠 -Z，>0.5 = 靠 +Z
      headSide: topZ !== null ? (topZ / (zMax - zMin || 1)).toFixed(2) : null,
    });
    // 移除这个测试敌人
    e.dispose(scene);
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
    if (v.fatal) { console.error('[silprobe] page fatal:\n' + v.fatal); process.exit(2); }
    if (v.ready) { okState = 'ready'; break; }
    await sleep(400);
  }
  if (!okState) { console.error('[silprobe] timeout waiting __TD_READY'); process.exit(4); }

  await sleep(1200);
  const r = await call('Runtime.evaluate', { expression: EVAL, returnByValue: true, awaitPromise: true });
  console.log('[silprobe] ' + JSON.stringify(r.result?.value ?? r.result ?? null));
  if (r.exceptionDetails) console.log('[silprobe-exception] ' + JSON.stringify(r.exceptionDetails).slice(0, 600));

  const shot = await call('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(shot.data, 'base64');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, buf);
  console.log(`[silprobe] saved ${OUT} (${buf.length} bytes)`);
  process.exit(0);
} catch (e) {
  console.error('[silprobe] ' + e.message);
  process.exit(1);
}
