#!/usr/bin/env node
// 触摸手势探针：CDP Input.dispatchTouchEvent 模拟真机触摸，数值断言四件事：
//   ① 轻点塔坞 → 进入建造模式  ② 轻点空地 → 建成一座塔
//   ③ 单指拖动 → 相机平移      ④ 双指捏合 → 缩放
// 用法: node tools/touchprobe.mjs [--url=http://127.0.0.1:8137/?level=0,0]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const URL_TARGET = arg('url', 'http://127.0.0.1:8137/?level=0,0');

const BROWSERS = [
  process.env.TD_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const exe = BROWSERS.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!exe) { console.error('[touchprobe] no browser found'); process.exit(3); }

const PORT = 9355;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-touch-'));
const child = spawn(exe, [
  '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${PORT}`,
  '--window-size=900,700', '--hide-scrollbars', URL_TARGET,
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
  ws.binaryType = 'arraybuffer';
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
  const t0 = Date.now();
  while (!(window.__TD_READY && window.__TD_DEBUG && window.__TD_DEBUG.battle && window.__TD_DEBUG.battle())) {
    if (Date.now() - t0 > 30000) return { fatal: 'battle not ready' };
    await new Promise(r => setTimeout(r, 300));
  }
  const D = window.__TD_DEBUG;
  const THREE = await import('three');
  const b = D.battle();

  // 找一个可建造格子，投影到屏幕坐标
  let cell = null;
  outer:
  for (let r = 0; r < 10; r++) {
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      const cx = 11 + dx, cz = 7 + dz;
      if (b.isBuildable(cx, cz)) { cell = { cx, cz }; break outer; }
    }
  }
  if (!cell) return { fatal: 'no buildable cell' };
  const v = new THREE.Vector3(cell.cx - 11 + 0.5, 0, cell.cz - 7.5 + 0.5).project(D.camera);
  const sx = (v.x * 0.5 + 0.5) * innerWidth;
  const sy = (-v.y * 0.5 + 0.5) * innerHeight;

  // 塔坞第一个按钮中心（箭塔）
  const dock = document.querySelector('.dock-card').getBoundingClientRect();
  const dxp = dock.left + dock.width / 2, dyp = dock.top + dock.height / 2;
  return { sx, sy, dockX: dxp, dockY: dyp, towers0: b.towers.length };
})()`;

try {
  const wsUrl = await findTarget();
  const { ready, call } = cdp(wsUrl);
  await ready;
  await call('Page.enable');
  await call('Runtime.enable');

  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const r = await call('Runtime.evaluate', { expression: '({ready: !!window.__TD_READY, fatal: window.__TD_FATAL || null})', returnByValue: true });
    if (r.result.value?.fatal) { console.error('[touchprobe] page fatal'); process.exit(2); }
    if (r.result.value?.ready) break;
    await sleep(400);
  }

  const info = await call('Runtime.evaluate', { expression: EVAL, returnByValue: true, awaitPromise: true });
  const P = info.result.value;
  if (!P || P.fatal) { console.error('[touchprobe] ' + (P?.fatal || 'eval failed')); process.exit(2); }
  console.log('[info] ' + JSON.stringify(P));

  const touch = (type, pts) => call('Input.dispatchTouchEvent', {
    type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i + 1 })),
  });
  const get = (expr) => call('Runtime.evaluate', { expression: expr, returnByValue: true }).then(r => r.result.value);

  // ① 轻点塔坞 → 建造模式
  await touch('touchStart', [{ x: P.dockX, y: P.dockY }]);
  await sleep(80);
  await touch('touchEnd', []);
  await sleep(250);
  const sel = await get(`window.__TD_DEBUG.battle().selectedType`);
  console.log(`[1] tap dock → selectedType=${sel} ${sel === 'arrow' ? 'PASS' : 'FAIL'}`);

  // ② 轻点空地 → 建塔
  const focusBefore = await get(`({x:__TD_DEBUG.rig.cur.focus.x, z:__TD_DEBUG.rig.cur.focus.z, d:__TD_DEBUG.rig.cur.dist})`);
  await touch('touchStart', [{ x: P.sx, y: P.sy }]);
  await sleep(80);
  await touch('touchEnd', []);
  await sleep(400);
  const dbg = await get(`({tap:__TD_DEBUG.touch.lastTap, sel:__TD_DEBUG.battle().selectedType, gold:__TD_DEBUG.battle().gold, buildable:__TD_DEBUG.battle().isBuildable(11,7), hint:(document.querySelector('#hud-hint')?.textContent||'')})`);
  console.log('[dbg] ' + JSON.stringify(dbg));
  const towers = await get(`window.__TD_DEBUG.battle().towers.length`);
  console.log(`[2] tap ground → towers=${towers} ${towers > P.towers0 ? 'PASS' : 'FAIL'}`);

  // ③ 单指拖动 → 平移
  await touch('touchStart', [{ x: 500, y: 350, id: 1 }]);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: 500 - i * 15, y: 350, id: 1 }]); await sleep(40); }
  await touch('touchEnd', []);
  await sleep(300);
  const focusAfter = await get(`({x:__TD_DEBUG.rig.cur.focus.x, z:__TD_DEBUG.rig.cur.focus.z, d:__TD_DEBUG.rig.cur.dist})`);
  const panDx = Math.abs(focusAfter.x - focusBefore.x) + Math.abs(focusAfter.z - focusBefore.z);
  console.log(`[3] drag → focus Δ=${panDx.toFixed(2)} ${panDx > 0.5 ? 'PASS' : 'FAIL'}`);

  // ④ 双指捏合（张开）→ 缩放
  await touch('touchStart', [{ x: 400, y: 350, id: 1 }, { x: 500, y: 350, id: 2 }]);
  await sleep(60);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: 400 - i * 20, y: 350, id: 1 }, { x: 500 + i * 20, y: 350, id: 2 }]); await sleep(40); }
  await touch('touchEnd', []);
  await sleep(400);
  const d = await get(`__TD_DEBUG.rig.cur.dist`);
  console.log(`[4] pinch → dist ${focusBefore.d.toFixed(1)}→${d.toFixed(1)} ${d < focusBefore.d - 0.8 ? 'PASS' : 'FAIL'}`);

  const okAll = sel === 'arrow' && towers > P.towers0 && panDx > 0.5 && d < focusBefore.d - 0.8;
  console.log(okAll ? '[touchprobe] ALL PASS ✓' : '[touchprobe] SOME FAILED ✗');
  process.exit(okAll ? 0 : 1);
} catch (e) {
  console.error('[touchprobe] ' + e.message);
  process.exit(1);
}
