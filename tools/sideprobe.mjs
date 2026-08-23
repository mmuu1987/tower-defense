#!/usr/bin/env node
// 侧视探针：把 9 类敌人以 rotation.y=0（= 当前代码对 +Z 行进切线的输出，yaw=π）
// 排成一行，从 +X 侧低角度侧视截图。屏幕左 = 世界 +Z：
//   模型面朝屏幕左 → 原生面向 +Z → 当前 yaw=π 正确（面向行进方向）
//   模型面朝屏幕右 → 原生面向 -Z → 当前 yaw=π 会 180° 倒退行走
// 再补一张正面视角（相机 yaw=0 从 +Z 看）：面向 +Z 的模型应正对镜头露脸。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const URL_TARGET = process.argv[2] || 'http://127.0.0.1:8137/?level=0,0';
const OUT_SIDE = process.argv[3] || 'logs/shot-side.png';
const OUT_FRONT = process.argv[4] || 'logs/shot-front.png';

const BROWSERS = [
  process.env.TD_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const exe = BROWSERS.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!exe) { console.error('[sideprobe] no browser found'); process.exit(3); }

const PORT = 9347;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-side-'));
const child = spawn(exe, [
  '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${PORT}`,
  '--window-size=1280,720', '--hide-scrollbars', URL_TARGET,
], { stdio: 'ignore' });
const cleanup = () => { try { child.kill(); } catch {} try { fs.rmSync(prof, { recursive: true, force: true }) } catch {} };
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
  await new Promise(r => setTimeout(r, 800));
  const types = ['grunt','runner','tank','flyer','healer','splitter','meadow','lava','frost'];
  const list = [];
  for (let i = 0; i < types.length; i++) {
    const t = types[i];
    b.spawnEnemy(t);
    const e = b.enemies[b.enemies.length - 1];
    if (!e || !e.alive) { list.push({ t, fail: true }); continue; }
    e.baseSpeed = 0.0001;
    e.sampler = { total: 999, at: (d, o) => o.set(0, 0, 0), tangentAt: (d, o) => o.set(0, 0, 1) };
    e.alive = false; // 冻结：主循环不再驱动（dying=false，不会进尸体清理）
    list.push({ e, t, model: e.def.model ? e.def.model.name : 'proc', yawOff: e.yawOff });
  }
  window.__SP_LIST = list;
  const shot = async (mode) => {
    for (const it of window.__SP_LIST) {
      if (!it.e) continue;
      const k = it.e;
      if (mode === 'side') {
        k.pos.set(0, 0, (list.indexOf(it) - 4) * 2.4);
      } else {
        k.pos.set((list.indexOf(it) - 4) * 2.4, 0, 0);
      }
      k.mesh.position.set(k.pos.x, k.baseY || 0, k.pos.z);
      k.mesh.rotation.y = 0; // = atan2(0,-1)+π 对 +Z 切线的输出
      k.mesh.updateMatrixWorld(true);
    }
    if (mode === 'side') {
      D.rig.pitch = 0.22; D.rig.yaw = Math.PI / 2; D.rig.dist = 15;
      D.rig.cur.yaw = Math.PI / 2; D.rig.cur.dist = 15;
      D.rig.cur.focus.set(0, 0, 0);
    } else {
      D.rig.pitch = 0.30; D.rig.yaw = 0; D.rig.dist = 13;
      D.rig.cur.yaw = 0; D.rig.cur.dist = 13;
      D.rig.cur.focus.set(0, 0, 0);
    }
    await new Promise(r => setTimeout(r, 700));
  };
  await shot('side');
  return JSON.stringify(list.map((it) => ({ t: it.t, model: it.model, yawOff: it.yawOff, ok: !!it.e })));
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
    if (v.fatal) { console.error('[sideprobe] page fatal:\n' + v.fatal); process.exit(2); }
    if (v.ready) { okState = 'ready'; break; }
    await sleep(400);
  }
  if (!okState) { console.error('[sideprobe] timeout waiting __TD_READY'); process.exit(4); }

  await sleep(1200);
  const r = await call('Runtime.evaluate', { expression: EVAL, returnByValue: true, awaitPromise: true });
  console.log('[sideprobe] ' + JSON.stringify(r.result?.value ?? r.result ?? null));
  if (r.exceptionDetails) console.log('[sideprobe-exception] ' + JSON.stringify(r.exceptionDetails).slice(0, 800));

  const shot1 = await call('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(path.dirname(OUT_SIDE), { recursive: true });
  fs.writeFileSync(OUT_SIDE, Buffer.from(shot1.data, 'base64'));
  console.log(`[sideprobe] saved ${OUT_SIDE}`);

  // 正面视角
  await call('Runtime.evaluate', { expression: `(async () => {
    const D = window.__TD_DEBUG;
    for (const it of window.__SP_LIST) {
      if (!it.e) continue;
      const k = it.e;
      k.pos.set((window.__SP_LIST.indexOf(it) - 4) * 2.4, 0, 0);
      k.mesh.position.set(k.pos.x, k.baseY || 0, k.pos.z);
      k.mesh.rotation.y = 0;
      k.mesh.updateMatrixWorld(true);
    }
    D.rig.pitch = 0.30; D.rig.yaw = 0; D.rig.dist = 13;
    D.rig.cur.yaw = 0; D.rig.cur.dist = 13;
    D.rig.cur.focus.set(0, 0, 0);
    await new Promise(r2 => setTimeout(r2, 700));
    return 'front-ok';
  })()`, returnByValue: true, awaitPromise: true });
  const shot2 = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT_FRONT, Buffer.from(shot2.data, 'base64'));
  console.log(`[sideprobe] saved ${OUT_FRONT}`);
  process.exit(0);
} catch (e) {
  console.error('[sideprobe] ' + e.message);
  process.exit(1);
}
