// 实时行为探针：模拟真实可见页面的持续帧驱动，周期采样战斗内部状态。
// 用法: node tools/liveprobe.mjs [levelW] [levelL] [seconds]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const [W = '0', L = '4', SEC = '80'] = process.argv.slice(2);
const URL_TARGET = `http://127.0.0.1:8137/?level=${W},${L}&auto=1`;

const BROWSERS = [
  process.env.TD_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const exe = BROWSERS.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!exe) { console.error('no browser'); process.exit(3); }

const PORT = 9341;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-live-'));
const child = spawn(exe, [
  '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${PORT}`,
  '--window-size=1280,720', URL_TARGET,
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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('cdp timeout')); } }, 15000);
  });
  return { ready, call };
}

try {
  const wsUrl = await findTarget();
  const { ready, call } = cdp(wsUrl);
  await ready;
  await call('Page.enable');
  await call('Runtime.enable');

  // 等 ready
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const r = await call('Runtime.evaluate', { expression: '({ready: !!window.__TD_READY, fatal: window.__TD_FATAL || null})', returnByValue: true });
    if (r.result.value?.fatal) { console.error('FATAL:\n' + r.result.value.fatal); process.exit(2); }
    if (r.result.value?.ready) break;
    await sleep(400);
  }

  // 安装页面内记录器：错误捕获 + 周期采样
  await call('Runtime.evaluate', { expression: `
    window.__REC = { errs: [], samples: [] };
    window.addEventListener('error', (e) => __REC.errs.push(String(e.message)));
    window.addEventListener('unhandledrejection', (e) => __REC.errs.push('rejection:' + String(e.reason).slice(0, 200)));
    window.__RAF_TICKS = 0;
    (function tick(){ __RAF_TICKS++; requestAnimationFrame(tick); })();
    setInterval(() => {
      try {
        const b = window.__TD_DEBUG.battle(); if (!b) return;
        __REC.samples.push({
          wall: performance.now() | 0,
          raf: window.__RAF_TICKS,
          state: b.state, wave: b.waveIdx + 1, kills: b.kills, gold: b.gold,
          proj: b.projectiles.list.length,
          nanProj: b.projectiles.list.filter(p => !isFinite(p.mesh.position.x)).length,
          fires: b.towers.map(t => t.fireCount || 0),
          keys: b.towers.map(t => t.key),
        });
      } catch (e) { __REC.samples.push({ err: String(e) }); }
    }, 4000);
  ` });

  // 持续活动窗口：每 2s 轻量 evaluate 保活（等价真实可见标签页的帧驱动）
  const endAt = Date.now() + Number(SEC) * 1000;
  while (Date.now() < endAt) {
    await sleep(2000);
    await call('Runtime.evaluate', { expression: '1', returnByValue: true });
  }

  const fin = await call('Runtime.evaluate', { expression: 'JSON.stringify(window.__REC)', returnByValue: true });
  const rec = JSON.parse(fin.result.value);
  console.log(`errors(${rec.errs.length}):`, rec.errs.slice(0, 5));
  console.log('wall  raf   state        wave kills gold proj nanProj fires(keys)');
  let prev = null;
  for (const s of rec.samples) {
    if (s.err) { console.log('SAMPLE_ERR', s.err); continue; }
    const delta = prev ? s.fires.map((f, i) => f - prev[i]).join(',') : s.fires.join(',');
    console.log(
      `${String(s.wall).padStart(6)} ${String(s.raf).padStart(5)} ${String(s.state).padEnd(12)} ` +
      `${String(s.wave).padStart(3)} ${String(s.kills).padStart(4)} ${String(s.gold).padStart(4)} ` +
      `${String(s.proj).padStart(3)} ${String(s.nanProj).padStart(3)} [${delta}] (${s.keys.join(',')})`,
    );
    prev = s.fires;
  }
  process.exit(0);
} catch (e) {
  console.error('[liveprobe] ' + e.message);
  process.exit(1);
}
