#!/usr/bin/env node
// 朝向诊断探针：把 6 类敌人定身排成一排，强制切线 (0,0,1)，
// 截图观察各模型原生正面朝向；同时输出 mesh.rotation.y 数值。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const URL_TARGET = process.argv[2] || 'http://127.0.0.1:8137/?level=0,9';
const OUT = process.argv[3] || 'logs/shot-facing.png';

const BROWSERS = [
  process.env.TD_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const exe = BROWSERS.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!exe) { console.error('[faceprobe] no browser found'); process.exit(3); }

const PORT = 9341;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-face-'));
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
  // 等待异步 enterBattle 完成（terrain 重建较慢）
  let b = null, D = null;
  for (let i = 0; i < 150; i++) {
    D = window.__TD_DEBUG;
    b = D && D.battle();
    if (b) break;
    await new Promise(r => setTimeout(r, 200));
  }
  if (!b) return String(window.__TD_FATAL || "no-battle");
  const list = ["grunt", "runner", "tank", "flyer", "healer", "splitter"];
  const xs = [-16, -14, -12, -10, -8, -6];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    b.spawnEnemy(list[i]);
    const e = b.enemies[b.enemies.length - 1];
    e.baseSpeed = 0.0001;
    const x = xs[i], z = -0.5;
    e.sampler = { total: 999, at: (d, o) => o.set(x, 0, z), tangentAt: (d, o) => o.set(0, 0, 1) };
    e.pos.set(x, 0, z);
    e.mesh.position.set(x, e.baseY, z);
    const model = e.def.model ? e.def.model.name : "procedural";
    out.push(model + "#rot=" + e.mesh.rotation.y.toFixed(3));
  }
  const r = D.rig;
  r.dist = 13; r.cur.dist = 13;
  r.yaw = 0; r.cur.yaw = 0;
  r.cur.focus.set(-11, 0, -0.5);
  await new Promise(res => setTimeout(res, 1200));
  return out.join(" | ");
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
    if (v.fatal) { console.error('[faceprobe] page fatal:\n' + v.fatal); process.exit(2); }
    if (v.ready) { okState = 'ready'; break; }
    await sleep(400);
  }
  if (!okState) { console.error('[faceprobe] timeout waiting __TD_READY'); process.exit(4); }

  await sleep(1000); // 等模型预热
  const r = await call('Runtime.evaluate', { expression: EVAL, returnByValue: true, awaitPromise: true });
  console.log('[faceprobe] ' + JSON.stringify(r.result?.value ?? r.result ?? null));
  if (r.exceptionDetails) console.log('[faceprobe-exception] ' + JSON.stringify(r.exceptionDetails).slice(0, 600));

  const shot = await call('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(shot.data, 'base64');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, buf);
  console.log(`[faceprobe] saved ${OUT} (${buf.length} bytes)`);
  process.exit(0);
} catch (e) {
  console.error('[faceprobe] ' + e.message);
  process.exit(1);
}
