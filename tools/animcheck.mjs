#!/usr/bin/env node
// 真实主循环动画体检：进指定关卡 → 刷全部敌人 → 主循环真实驱动 3s，
// 每 600ms 采样 {dist, mixer.time, walkAction.time} —— dist 推进但 mixer.time 冻结 = 没动画地滑行
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const URL_TARGET = process.argv[2] || 'http://127.0.0.1:8137/?level=4,0';
const BROWSERS = [
  process.env.TD_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const exe = BROWSERS.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!exe) { console.error('[animcheck] no browser'); process.exit(3); }

const PORT = 9353;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-anim-'));
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
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(300);
  }
  throw new Error('devtools not reachable');
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
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('cdp timeout ' + method)); } }, 30000);
  });
  return { ready, call };
}

const EVAL = `(async () => {
  const D = window.__TD_DEBUG;
  let b = null;
  for (let i = 0; i < 250 && !b; i++) { b = D.battle(); if (!b) await new Promise((r) => setTimeout(r, 300)); }
  if (!b) return JSON.stringify({ fatal: String(window.__TD_FATAL || 'no-battle') });
  await new Promise((r) => setTimeout(r, 2000)); // 模型预载
  b.speed = 1;
  const types = ['grunt','runner','tank','flyer','healer','splitter','fox','flamingo','mummy','stork','dancer','meadow','lava','frost','sand','graveyard'];
  const spawned = [];
  for (let i = 0; i < types.length; i++) {
    b.spawnEnemy(types[i]);
    const e = b.enemies[b.enemies.length - 1];
    e.baseSpeed = 0.5;                    // 慢速行军，3s 内不漏怪
    e.hp = e.maxHp = 999999;              // 不死
    spawned.push({ t: types[i], e });
  }
  // 采样 5 次，间隔 600ms（主循环真实驱动）
  const snaps = [];
  for (let s = 0; s < 5; s++) {
    await new Promise((r) => setTimeout(r, 600));
    snaps.push(spawned.map(({ t, e }) => ({
      t,
      dist: +e.dist.toFixed(3),
      mix: +(e.mixer ? e.mixer.time.toFixed(3) : -1),
      walk: +(e.actions?.walk ? e.actions.walk.time.toFixed(3) : -1),
    })));
  }
  // 判定：dist 推进 (末-首 > 0.3) 但 mixer.time 推进 < 0.05 → 滑行无动画
  const report = spawned.map(({ t, e }, i) => {
    const d0 = snaps[0][i].dist, d4 = snaps[4][i].dist;
    const m0 = snaps[0][i].mix, m4 = snaps[4][i].mix;
    const w0 = snaps[0][i].walk, w4 = snaps[4][i].walk;
    const moving = d4 - d0 > 0.3;
    const animating = m4 - m0 > 0.05;
    const walkAdvancing = w4 - w0 > 0.05;
    return {
      t, model: e.def.model?.name ?? 'proc',
      dMove: +(d4 - d0).toFixed(2), dMix: +(m4 - m0).toFixed(2), dWalk: +(w4 - w0).toFixed(2),
      verdict: !moving ? '未移动' : (!animating ? '★滑行无动画' : (!walkAdvancing ? '★mixer转但walk冻结' : 'ok')),
    };
  });
  // 清理
  for (const { e } of spawned) { e.alive = false; e.disposed = true; }
  return JSON.stringify(report);
})()`;

try {
  const wsUrl = await findTarget();
  const { ready, call } = cdp(wsUrl);
  await ready;
  await call('Page.enable');
  await call('Runtime.enable');
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    const r = await call('Runtime.evaluate', { expression: '({ready: !!window.__TD_READY, fatal: window.__TD_FATAL || null})', returnByValue: true });
    const v = r.result.value || {};
    if (v.fatal) { console.error('[animcheck] page fatal:\n' + v.fatal); process.exit(2); }
    if (v.ready) break;
    await sleep(400);
  }
  const r = await call('Runtime.evaluate', { expression: EVAL, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) { console.error('[animcheck-exception] ' + JSON.stringify(r.exceptionDetails).slice(0, 500)); process.exit(1); }
  const rows = JSON.parse(r.result.value);
  console.log('类型        模型            位移   mixerΔ  walkΔ   判定');
  for (const e of rows) {
    console.log(`${e.t.padEnd(11)} ${String(e.model).padEnd(15)} ${String(e.dMove).padEnd(6)} ${String(e.dMix).padEnd(7)} ${String(e.dWalk).padEnd(7)} ${e.verdict}`);
  }
  const bad = rows.filter((e) => e.verdict.startsWith('★'));
  console.log(bad.length ? `\n★ 异常: ${bad.map((e) => e.t).join(', ')}` : '\n全部动画正常推进');
  process.exit(0);
} catch (e) {
  console.error('[animcheck] ' + e.message);
  process.exit(1);
}
