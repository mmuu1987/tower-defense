#!/usr/bin/env node
// 修复验证探针：9 类敌人走真实 Enemy.update 代码路径（切线 +Z），读取计算出的 rotation.y，
// 再排成一排侧视截图。屏幕左 = 世界 +Z：修复后所有模型都应面朝屏幕左（行进方向）。
// 预期 rotation.y：yaw=π 的模型 ≈ 6.283；yaw=0 的模型（soldier/xbot 系）≈ 3.141。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const URL_TARGET = process.argv[2] || 'http://127.0.0.1:8137/?level=0,0';
const OUT = process.argv[3] || 'logs/shot-livecheck.png';

const BROWSERS = [
  process.env.TD_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const exe = BROWSERS.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!exe) { console.error('[livecheck] no browser found'); process.exit(3); }

const PORT = 9349;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-live-'));
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
  const D = window.__TD_DEBUG;
  let b = null;
  for (let i = 0; i < 200 && !b; i++) { b = D.battle(); if (!b) await new Promise((r) => setTimeout(r, 300)); }
  if (!b) return String(window.__TD_FATAL || 'no-battle');
  await new Promise((r) => setTimeout(r, 500));
  const types = ['grunt','runner','tank','flyer','healer','splitter','fox','flamingo','mummy','stork','dancer','meadow','lava','frost','sand'];
  const out = [];
  const made = [];
  for (let i = 0; i < types.length; i++) {
    const t = types[i];
    b.spawnEnemy(t);
    const e = b.enemies[b.enemies.length - 1];
    if (!e || !e.alive) { out.push({ t, fail: true }); continue; }
    e.baseSpeed = 0.0001;
    e.sampler = { total: 999, at: (d, o) => o.set(0, 0, 0), tangentAt: (d, o) => o.set(0, 0, 1) };
    // 走真实更新路径一次：rotation.y 由 atan2(-tan.x,-tan.z)+yawOff 计算
    e.update(0.001, {
      enemies: [], time: 0, camera: D.camera,
      fx: { ring() {}, burst() {}, beam() {}, decal() {}, shockwave() {} },
      projectiles: { list: [] }, hitEnemy() {}, explode() {}, tangentOf() {},
    });
    e.alive = false; // 冻结，主循环不再驱动
    const z = (i - 4) * 2.4;
    e.pos.set(0, 0, z);
    e.mesh.position.set(0, e.baseY || 0, z);
    e.mesh.updateMatrixWorld(true);
    made.push(e);
    out.push({ t, model: e.def.model?.name ?? 'proc', yawOff: +e.yawOff.toFixed(2), rotY: +e.mesh.rotation.y.toFixed(3) });
  }
  window.__LC_MADE = made;
  // 相机：+X 侧低角度 → 屏幕左 = +Z
  D.rig.pitch = 0.22; D.rig.yaw = Math.PI / 2; D.rig.dist = 15;
  D.rig.cur.yaw = Math.PI / 2; D.rig.cur.dist = 15;
  D.rig.cur.focus.set(0, 0, 0);
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
    if (v.fatal) { console.error('[livecheck] page fatal:\n' + v.fatal); process.exit(2); }
    if (v.ready) { okState = 'ready'; break; }
    await sleep(400);
  }
  if (!okState) { console.error('[livecheck] timeout waiting __TD_READY'); process.exit(4); }

  await sleep(1200);
  const r = await call('Runtime.evaluate', { expression: EVAL, returnByValue: true, awaitPromise: true });
  console.log('[livecheck] ' + JSON.stringify(r.result?.value ?? r.result ?? null));
  if (r.exceptionDetails) console.log('[livecheck-exception] ' + JSON.stringify(r.exceptionDetails).slice(0, 800));

  const shot = await call('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log(`[livecheck] saved ${OUT} (${shot.data.length} bytes b64)`);
  process.exit(0);
} catch (e) {
  console.error('[livecheck] ' + e.message);
  process.exit(1);
}
