#!/usr/bin/env node
// 探针：第一世界最后一关 (0,9) 的 boss 波怪物朝向检查
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const URL_TARGET = process.argv[2] || 'http://127.0.0.1:8137/?level=0,9&auto=1';
const OUT = process.argv[3] || 'logs/shot-bosswave.png';

const BROWSERS = [
  process.env.TD_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const exe = BROWSERS.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!exe) { console.error('[bossprobe] no browser found'); process.exit(3); }

const PORT = 9343;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-boss-'));
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
  // 跳到最后一波（boss 波）
  b.intermission = 0;
  while (b.waveIdx < b.level.waves.length - 1) {
    b.startWave();
    b.spawnQueue = [];
    b.state = 'intermission';
    b.intermission = 0;
  }
  b.state = 'build';
  b.startWave();
  // 等待出怪
  for (let i = 0; i < 40; i++) {
    if (b.enemies.length > 0) break;
    await new Promise(r => setTimeout(r, 300));
  }
  await new Promise(r => setTimeout(r, 2000));
  const out = [];
  const tan = { set: function(x,y,z){this.x=x;this.y=y;this.z=z;return this}, x:0, y:0, z:0 };
  for (const e of b.enemies) {
    if (!e.alive) continue;
    const rot = e.mesh.rotation.y;
    e.sampler.tangentAt(e.dist, tan);
    const moveAngle = Math.atan2(tan.x, tan.z);
    const faceAngle = Math.atan2(Math.sin(rot), Math.cos(rot));
    const diff = Math.abs(faceAngle - moveAngle) % (Math.PI*2);
    const diffDeg = Math.min(diff, Math.PI*2 - diff) * 180 / Math.PI;
    out.push({ type: e.def.key, model: e.def.model ? e.def.model.name : 'proc', rotY: rot.toFixed(3), moveA: moveAngle.toFixed(3), diff: diffDeg.toFixed(1), wave: b.waveIdx });
  }
  return JSON.stringify(out);
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
    if (v.fatal) { console.error('[bossprobe] page fatal:\n' + v.fatal); process.exit(2); }
    if (v.ready) { okState = 'ready'; break; }
    await sleep(400);
  }
  if (!okState) { console.error('[bossprobe] timeout waiting __TD_READY'); process.exit(4); }

  await sleep(1200);
  const r = await call('Runtime.evaluate', { expression: EVAL, returnByValue: true, awaitPromise: true });
  console.log('[bossprobe] ' + JSON.stringify(r.result?.value ?? r.result ?? null));
  if (r.exceptionDetails) console.log('[bossprobe-exception] ' + JSON.stringify(r.exceptionDetails).slice(0, 600));

  const shot = await call('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(shot.data, 'base64');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, buf);
  console.log(`[bossprobe] saved ${OUT} (${buf.length} bytes)`);
  process.exit(0);
} catch (e) {
  console.error('[bossprobe] ' + e.message);
  process.exit(1);
}
