#!/usr/bin/env node
// 无头视觉验证工具：CDP 驱动 Edge/Chrome，等 __TD_READY 后截图。
// 用法: node tools/shot.mjs [--url=http://127.0.0.1:8137/] [--out=logs/shot.png] [--wait=20000]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const URL_TARGET = arg('url', 'http://127.0.0.1:8137/');
const OUT = arg('out', 'logs/shot.png');
const WAIT_MS = Number(arg('wait', '25000'));
const SETTLE_MS = Number(arg('settle', '900')); // 就绪后继续模拟的时长
const WIN_W = Number(arg('w', '1280'));
const WIN_H = Number(arg('h', '720'));

const BROWSERS = [
  process.env.TD_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const exe = BROWSERS.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!exe) { console.error('[shot] no browser found'); process.exit(3); }

const PORT = 9337;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-shot-'));
const child = spawn(exe, [
  '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${PORT}`,
  `--window-size=${WIN_W},${WIN_H}`, '--hide-scrollbars', URL_TARGET,
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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('cdp timeout ' + method)); } }, 15000);
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
  while (Date.now() - t0 < WAIT_MS) {
    const r = await call('Runtime.evaluate', { expression: '({ready: !!window.__TD_READY, fatal: window.__TD_FATAL || null})', returnByValue: true });
    const v = r.result.value || {};
    if (v.fatal) { console.error('[shot] page fatal:\n' + v.fatal); process.exit(2); }
    if (v.ready) { okState = 'ready'; break; }
    await sleep(400);
  }
  if (!okState) { console.error('[shot] timeout waiting __TD_READY'); process.exit(4); }

  const settleEnd = Date.now() + SETTLE_MS;
  while (Date.now() < settleEnd) {
    const r = await call('Runtime.evaluate', { expression: '({fatal: window.__TD_FATAL || null})', returnByValue: true });
    if (r.result.value?.fatal) { console.error('[shot] page fatal during settle:\n' + r.result.value.fatal); process.exit(2); }
    await sleep(500);
  }
  const EVAL = arg('eval', '');
  if (EVAL) {
    try {
      const r = await call('Runtime.evaluate', {
        expression: EVAL, returnByValue: true, awaitPromise: true,
      });
      console.log('[eval] ' + JSON.stringify(r.result?.value ?? r.result ?? null));
      if (r.exceptionDetails) console.log('[eval-exception] ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
    } catch (e) { console.error('[eval-fail] ' + e.message); }
  }
  const shot = await call('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(shot.data, 'base64');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, buf);
  console.log(`[shot] saved ${OUT} (${buf.length} bytes)`);
  process.exit(0);
} catch (e) {
  console.error('[shot] ' + e.message);
  process.exit(1);
}
