#!/usr/bin/env node
// 单模型特写探针：horse / bird_parrot / soldier / xbot 逐个放在原点（rotation.y=0），
// 从 +X 侧低角度特写。屏幕左 = 世界 +Z：
//   模型面朝屏幕左 → 原生面向 +Z（当前 yaw=π 正确）
//   模型面朝屏幕右 → 原生面向 -Z（当前 yaw=π 会倒退行走，需要改 yaw=0）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const URL_TARGET = process.argv[2] || 'http://127.0.0.1:8137/?level=0,0';
const OUTDIR = process.argv[3] || 'logs';

const BROWSERS = [
  process.env.TD_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const exe = BROWSERS.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!exe) { console.error('[closeup] no browser found'); process.exit(3); }

const PORT = 9348;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-close-'));
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
    if (v.fatal) { console.error('[closeup] page fatal:\n' + v.fatal); process.exit(2); }
    if (v.ready) { okState = 'ready'; break; }
    await sleep(400);
  }
  if (!okState) { console.error('[closeup] timeout waiting __TD_READY'); process.exit(4); }

  await sleep(1000);
  fs.mkdirSync(OUTDIR, { recursive: true });

  for (const t of ['runner', 'flyer']) {
    const expr = `(async () => {
      const D = window.__TD_DEBUG;
      let b = null;
      for (let i = 0; i < 100 && !b; i++) { b = D.battle(); if (!b) await new Promise((r2) => setTimeout(r2, 300)); }
      if (!b) return 'no-battle';
      // 清掉上一个
      if (window.__CU_E) {
        window.__CU_E.dispose(D.scene);
        b.enemies = b.enemies.filter((x) => x !== window.__CU_E);
        window.__CU_E = null;
      }
      b.spawnEnemy('${t}');
      const e = b.enemies[b.enemies.length - 1];
      e.baseSpeed = 0.0001;
      e.sampler = { total: 999, at: (d, o) => o.set(0, 0, 0), tangentAt: (d, o) => o.set(0, 0, 1) };
      e.pos.set(0, 0, 0);
      e.mesh.position.set(0, e.baseY || 0, 0);
      e.mesh.rotation.y = 0;
      e.alive = false;
      window.__CU_E = e;
      D.rig.pitch = 0.16; D.rig.yaw = Math.PI / 2; D.rig.dist = 6.5;
      D.rig.cur.yaw = Math.PI / 2; D.rig.cur.dist = 6.5;
      D.rig.cur.focus.set(0, ${t === 'flyer' ? '1.6' : '0.7'}, 0);
      await new Promise((r2) => setTimeout(r2, 600));
      return 'ok';
    })()`;
    const res = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (res?.exceptionDetails) console.log(`[closeup][${t}-exception] ` + JSON.stringify(res.exceptionDetails).slice(0, 800));
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    const out = path.join(OUTDIR, `close-${t}.png`);
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log(`[closeup] saved ${out}`);
  }
  process.exit(0);
} catch (e) {
  console.error('[closeup] ' + e.message);
  process.exit(1);
}
