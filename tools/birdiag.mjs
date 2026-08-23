#!/usr/bin/env node
// 鸟类模型诊断：flamingo/stork 的包围盒 vs 分位数包围盒（找离群顶点）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const URL_TARGET = process.argv[2] || 'http://127.0.0.1:8137/?level=0,0';

const BROWSERS = [
  process.env.TD_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const exe = BROWSERS.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!exe) { console.error('[birdiag] no browser found'); process.exit(3); }

const PORT = 9352;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-bird-'));
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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('cdp timeout ' + method)); } }, 30000);
  });
  return { ready, call };
}

const EVAL = `(async () => {
  const lib = await import('./js/engine/modellib.js');
  const out = [];
  for (const nm of ['bird_flamingo', 'bird_stork', 'bird_parrot']) {
    const tpl = await lib.loadEnemyTemplate(nm);
    if (!tpl) { out.push({ name: nm, fail: 'load' }); continue; }
    const info = { name: nm, tplHeight: +tpl.height.toFixed(2), meshes: [] };
    let vx = [], vy = [], vz = [];
    tpl.tpl.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      info.meshes.push({
        verts: o.geometry.attributes.position.count,
        boxMin: [+bb.min.x.toFixed(1), +bb.min.y.toFixed(1), +bb.min.z.toFixed(1)],
        boxMax: [+bb.max.x.toFixed(1), +bb.max.y.toFixed(1), +bb.max.z.toFixed(1)],
        morphs: o.geometry.morphAttributes?.position?.length ?? 0,
      });
      // 抽样顶点做分位数统计
      const pos = o.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 4000));
      for (let i = 0; i < pos.count; i += step) {
        vx.push(pos.getX(i)); vy.push(pos.getY(i)); vz.push(pos.getZ(i));
      }
    });
    const pct = (arr, p) => { arr.sort((a, b) => a - b); return arr[Math.floor(arr.length * p)]; };
    if (vx.length) {
      info.pBox = {
        x: [+(pct(vx, 0.02)).toFixed(1), +(pct(vx, 0.98)).toFixed(1)],
        y: [+(pct(vy, 0.02)).toFixed(1), +(pct(vy, 0.98)).toFixed(1)],
        z: [+(pct(vz, 0.02)).toFixed(1), +(pct(vz, 0.98)).toFixed(1)],
      };
      info.pHeights = {
        fullY: +(pct(vy, 0.98) - pct(vy, 0.02)).toFixed(1),
      };
    }
    out.push(info);
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
    if (v.fatal) { console.error('[birdiag] page fatal:\n' + v.fatal); process.exit(2); }
    if (v.ready) { okState = 'ready'; break; }
    await sleep(400);
  }
  if (!okState) { console.error('[birdiag] timeout'); process.exit(4); }
  await sleep(1000);
  const r = await call('Runtime.evaluate', { expression: EVAL, returnByValue: true, awaitPromise: true });
  console.log('[birdiag] ' + JSON.stringify(r.result?.value ?? r.result ?? null));
  if (r.exceptionDetails) console.log('[birdiag-exception] ' + JSON.stringify(r.exceptionDetails).slice(0, 800));
  process.exit(0);
} catch (e) {
  console.error('[birdiag] ' + e.message);
  process.exit(1);
}
