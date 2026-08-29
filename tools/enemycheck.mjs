#!/usr/bin/env node
// 敌人全类型体检：朝向（rotY 预期：yaw=π 模型≈6.28 / yaw=0 模型≈3.14）
// + 动画状态（mixer/walk 动作名/是否真在播放/全部剪辑名）+ 是否回退程序化造型
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const URL_TARGET = process.argv[2] || 'http://127.0.0.1:8137/?level=0,0';
const OUT = process.argv[3] || 'logs/shot-enemycheck.png';

const BROWSERS = [
  process.env.TD_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const exe = BROWSERS.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!exe) { console.error('[enemycheck] no browser found'); process.exit(3); }

const PORT = 9352;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-ec-'));
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
  const D = window.__TD_DEBUG;
  let b = null;
  for (let i = 0; i < 200 && !b; i++) { b = D.battle(); if (!b) await new Promise((r) => setTimeout(r, 300)); }
  if (!b) return JSON.stringify({ fatal: String(window.__TD_FATAL || 'no-battle') });
  // 等敌人模型预载完成（boot 时 preloadEnemyModels）
  await new Promise((r) => setTimeout(r, 1500));
  const types = ['grunt','runner','tank','flyer','healer','splitter','fox','flamingo','mummy','stork','dancer','meadow','lava','frost','sand','graveyard'];
  const out = [];
  const made = [];
  for (let i = 0; i < types.length; i++) {
    const t = types[i];
    b.spawnEnemy(t);
    const e = b.enemies[b.enemies.length - 1];
    if (!e || !e.alive) { out.push({ t, fail: true }); continue; }
    e.baseSpeed = 0.0001;
    e.sampler = { total: 999, at: (d, o) => o.set(0, 0, 0), tangentAt: (d, o) => o.set(0, 0, 1) };
    // 走真实更新路径：rotation.y = atan2(-tan.x,-tan.z)+yawOff（切线 +Z 时 atan2(0,-1)=π）
    e.update(0.05, {
      enemies: [], time: 0, camera: D.camera,
      fx: { ring() {}, burst() {}, beam() {}, decal() {}, shockwave() {} },
      projectiles: { list: [] }, hitEnemy() {}, explode() {}, tangentOf() {},
    });
    const anim = e.mixer ? {
      walk: e.actions?.walk?._clip?.name ?? null,
      death: e.actions?.death?._clip?.name ?? null,
      running: Object.values(e.actions || {}).filter((a) => a.isRunning()).map((a) => a._clip?.name),
      clips: e.mixer._actions?.length ?? 0,
    } : null;
    e.alive = false; // 冻结，主循环不再驱动
    const z = (i - 8) * 2.6;
    e.pos.set(0, 0, z);
    e.mesh.position.set(0, e.baseY || 0, z);
    e.mesh.updateMatrixWorld(true);
    made.push(e);
    out.push({
      t,
      model: e.def.model?.name ?? 'proc',
      glb: !!e.mixer,
      yawOff: +e.yawOff.toFixed(2),
      rotY: +e.mesh.rotation.y.toFixed(3),
      anim,
    });
  }
  window.__EC_MADE = made;
  D.rig.pitch = 0.24; D.rig.yaw = Math.PI / 2; D.rig.dist = 24;
  D.rig.cur.yaw = Math.PI / 2; D.rig.cur.dist = 24;
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
    if (v.fatal) { console.error('[enemycheck] page fatal:\n' + v.fatal); process.exit(2); }
    if (v.ready) { okState = 'ready'; break; }
    await sleep(400);
  }
  if (!okState) { console.error('[enemycheck] timeout waiting __TD_READY'); process.exit(4); }

  await sleep(1000);
  const r = await call('Runtime.evaluate', { expression: EVAL, returnByValue: true, awaitPromise: true });
  const raw = r.result?.value;
  if (r.exceptionDetails) console.log('[enemycheck-exception] ' + JSON.stringify(r.exceptionDetails).slice(0, 800));
  let rows = [];
  try { rows = JSON.parse(raw); } catch { console.error('[enemycheck] 解析失败: ' + String(raw).slice(0, 300)); process.exit(1); }

  console.log('类型        模型            GLB  yawOff  rotY    预期rotY  判定    walk动作          在播');
  for (const e of rows) {
    if (e.fail) { console.log(`${e.t.padEnd(11)} ✗ spawn 失败`); continue; }
    // 切线+Z 时 atan2(-0,-1) = -π（JS 负零语义），故 rotY = -π + yawOff（模 2π 后 ≡ π+yawOff）
    const raw = -Math.PI + e.yawOff;
    const expect = +(raw - Math.PI * 2 * Math.round(raw / (Math.PI * 2))).toFixed(3); // 归一化到 (-π, π]
    const rotOk = Math.abs(e.rotY - expect) < 0.05;
    const walk = e.anim?.walk ?? '(无)';
    const running = e.anim ? (e.anim.running.length ? e.anim.running.join(',') : '静止!') : '程序化';
    const flag = (!e.glb ? '回退程序化' : (!rotOk ? 'rotY异常' : 'ok'));
    console.log(
      `${e.t.padEnd(11)} ${String(e.model).padEnd(15)} ${(e.glb ? '✓' : '✗').padEnd(4)} ${String(e.yawOff).padEnd(7)} ${String(e.rotY).padEnd(7)} ${String(expect).padEnd(8)} ${flag.padEnd(8)} ${walk.padEnd(17)} ${running}`,
    );
  }
  // 预期朝向说明：屏幕左 = +Z 行进方向。rotY=π+yawOff 是数学正确的"沿切线"；
  // 模型原生面向决定 yawOff 取值：+Z 原生 → π；-Z 原生 → 0
  const shot = await call('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log(`[enemycheck] 截图 ${OUT}`);
  process.exit(0);
} catch (e) {
  console.error('[enemycheck] ' + e.message);
  process.exit(1);
}
