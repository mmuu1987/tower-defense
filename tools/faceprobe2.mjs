#!/usr/bin/env node
// 朝向诊断探针 2：检查每个敌人 GLB 模型的"视觉正面"方向。
// 方法：spawn 敌人后强制 rotation.y=0，读取头部骨骼/网格在模型本地空间的 Z 坐标。
// 若 head.z > 0 → 模型正面朝 +Z（代码 yaw=π 假设正确）；
// 若 head.z < 0 → 模型正面朝 -Z（与 yaw=π 校准相反 → 视觉 180° 反转）。
// 同时输出 程序化/GLB 分支、模型是否加载成功。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const URL_TARGET = process.argv[2] || 'http://127.0.0.1:8137/?level=0,0';
const OUT = process.argv[3] || 'logs/shot-face2.png';

const BROWSERS = [
  process.env.TD_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const exe = BROWSERS.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!exe) { console.error('[faceprobe2] no browser found'); process.exit(3); }

const PORT = 9342;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-face2-'));
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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('cdp timeout ' + method)); } }, 15000);
  });
  return { ready, call };
}

const EVAL = `
(async () => {
  let b = null, D = null;
  for (let i = 0; i < 150; i++) {
    D = window.__TD_DEBUG;
    b = D && D.battle();
    if (b) break;
    await new Promise(r => setTimeout(r, 200));
  }
  if (!b) return String(window.__TD_FATAL || "no-battle");
  const out = [];
  const types = ["grunt","runner","tank","flyer","healer","splitter","meadow","lava","frost"];
  const wp = new (function(){this.setFromMatrixPosition=function(m){this.x=m.elements[12];this.y=m.elements[13];this.z=m.elements[14];return this};this.x=0;this.y=0;this.z=0})();
  for (const t of types) {
    b.spawnEnemy(t);
    const e = b.enemies[b.enemies.length - 1];
    if (!e || !e.alive) { out.push({ type: t, spawnFail: true }); continue; }
    e.baseSpeed = 0.0001;
    e.sampler = { total: 999, at: (d, o) => o.set(0, 0, 0), tangentAt: (d, o) => o.set(0, 0, 1) };
    e.pos.set(0, 0, 0);
    e.mesh.position.set(0, e.baseY, 0);
    e.mesh.rotation.y = 0; // 原生朝向，不旋转
    e.mesh.updateMatrixWorld(true);
    const feats = [];
    const bonesAll = [];
    e.mesh.traverse((o) => {
      if (o.isBone) {
        wp.setFromMatrixPosition(o.matrixWorld);
        bonesAll.push(o.name + "@" + wp.z.toFixed(2));
        if (/head|Head|HEAD|face|Face|eye|Eye|neck|Neck|beak|Beak|nose|Nose|ear|Ear|horn|Horn/.test(o.name)) {
          feats.push({ n: o.name.replace(/.*_/g, ''), z: +wp.z.toFixed(2), x: +wp.x.toFixed(2) });
        }
      }
    });
    // 模型网格世界 Z 范围
    let zMin = Infinity, zMax = -Infinity;
    const v = { x: 0, y: 0, z: 0 };
    e.mesh.traverse((o) => {
      if (!o.geometry) return;
      const pos = o.geometry.attributes.position;
      if (!pos) return;
      const m = o.matrixWorld;
      for (let i = 0; i < pos.count; i += Math.max(1, Math.floor(pos.count / 120))) {
        v.x = pos.getX(i); v.y = pos.getY(i); v.z = pos.getZ(i);
        const wz = m.elements[2]*v.x + m.elements[6]*v.y + m.elements[10]*v.z + m.elements[14];
        if (wz < zMin) zMin = wz;
        if (wz > zMax) zMax = wz;
      }
    });
    out.push({
      type: t,
      model: e.def.model ? e.def.model.name : "procedural",
      hasModel: !!e.mixer,
      yawOff: e.yawOff,
      feats: feats.slice(0, 8),
      bones: bonesAll.length,
      meshZRange: [zMin.toFixed(2), zMax.toFixed(2)],
    });
  }
  return JSON.stringify(out);
})()
`;

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
    if (v.fatal) { console.error('[faceprobe2] page fatal:\n' + v.fatal); process.exit(2); }
    if (v.ready) { okState = 'ready'; break; }
    await sleep(400);
  }
  if (!okState) { console.error('[faceprobe2] timeout waiting __TD_READY'); process.exit(4); }

  await sleep(1000);
  const r = await call('Runtime.evaluate', { expression: EVAL, returnByValue: true, awaitPromise: true });
  console.log('[faceprobe2] ' + JSON.stringify(r.result?.value ?? r.result ?? null));
  if (r.exceptionDetails) console.log('[faceprobe2-exception] ' + JSON.stringify(r.exceptionDetails).slice(0, 800));

  const shot = await call('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(shot.data, 'base64');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, buf);
  console.log(`[faceprobe2] saved ${OUT} (${buf.length} bytes)`);
  process.exit(0);
} catch (e) {
  console.error('[faceprobe2] ' + e.message);
  process.exit(1);
}
