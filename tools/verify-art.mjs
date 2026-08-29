#!/usr/bin/env node
// 素材像素校验：无头加载产物 PNG，采样关键区域确认标题/按钮/预览条已渲染
// 用法: node tools/verify-art.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ART = path.join(ROOT, 'release', '4399', 'art');

const BROWSERS = [
  process.env.TD_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const exe = BROWSERS.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!exe) { console.error('[verify] no browser'); process.exit(3); }

const PORT = 9343;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-vart-'));
const child = spawn(exe, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${PORT}`,
  '--window-size=900,700', 'about:blank',
], { stdio: 'ignore' });
const cleanup = () => { try { child.kill(); } catch {} try { fs.rmSync(prof, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanup);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function findTarget() {
  const deadline = Date.now() + 15000;
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
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout')); } }, 30000);
  });
  return { ready, call };
}
const evalJs = async (call, expression) => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 300));
  return r.result?.value;
};

// 校验规则：gold=金色标题像素 | warn=橙红(预览条⚔️/按钮金边) | bright=亮像素
const CHECKS = [
  { file: 'icon-512.png', w: 512, h: 512, regions: [
    { name: '标题金字带', x: 60, y: 350, w: 392, h: 130, need: 'gold', min: 2500 },
  ]},
  { file: 'banner-1-hero.png', w: 1280, h: 720, regions: [
    { name: '大标题金字带', x: 40, y: 150, w: 700, h: 180, need: 'gold', min: 8000 },
    { name: '特性角标带', x: 40, y: 600, w: 800, h: 100, need: 'bright', min: 800 },
  ]},
  { file: 'banner-2-lava.png', w: 1280, h: 720, regions: [
    { name: '水印标题带', x: 900, y: 590, w: 360, h: 110, need: 'gold', min: 1200 },
    { name: '世界标签带', x: 20, y: 20, w: 600, h: 100, need: 'bright', min: 300 },
  ]},
  { file: 'banner-3-frost.png', w: 1280, h: 720, regions: [
    { name: '水印标题带', x: 900, y: 590, w: 360, h: 110, need: 'gold', min: 1200 },
  ]},
  { file: 'banner-4-sand.png', w: 1280, h: 720, regions: [
    { name: '水印标题带', x: 900, y: 590, w: 360, h: 110, need: 'gold', min: 1200 },
  ]},
  { file: 'banner-5-ui.png', w: 1280, h: 720, regions: [
    { name: '提前开战按钮(白字+金边)', x: 760, y: 25, w: 240, h: 65, need: 'bright', min: 200 },
    // 预览条正文是游戏原生的暗色 --dim(#93a3c4)，亮像素主要来自"下一波"标签与 ⚔️ 角标
    { name: '下一波预览条', x: 0, y: 65, w: 560, h: 60, need: 'bright', min: 100 },
    { name: '塔坞(底部建塔栏)', x: 300, y: 640, w: 680, h: 70, need: 'bright', min: 200 },
  ]},
];

try {
  const { ready, call } = cdp(await findTarget());
  await ready;
  await call('Page.enable');
  await call('Runtime.enable');

  let allOk = true;
  for (const c of CHECKS) {
    const file = path.join(ART, c.file);
    if (!fs.existsSync(file)) { console.log(`[FAIL] ${c.file} 不存在`); allOk = false; continue; }
    const data = fs.readFileSync(file).toString('base64');
    const results = await evalJs(call, `(async () => {
      const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,${data}'; });
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
      const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
      const regions = ${JSON.stringify(c.regions)};
      return regions.map((r) => {
        const d = g.getImageData(r.x, r.y, r.w, r.h).data;
        let gold = 0, bright = 0, warn = 0;
        for (let p = 0; p < d.length; p += 4) {
          const R = d[p], G = d[p+1], B = d[p+2];
          if (R > 170 && G > 110 && G < 230 && B < 120 && R > G && G > B) gold++;
          if (R + G + B > 500) bright++;
          if (R > 200 && G > 110 && G < 200 && B < 90) warn++;
        }
        return { name: r.name, need: r.need, min: r.min, gold, bright, warn,
          got: r.need === 'gold' ? gold : r.need === 'warn' ? warn : bright };
      });
    })()`);
    for (const r of results) {
      const ok = r.got >= r.min;
      if (!ok) allOk = false;
      console.log(`[${ok ? 'PASS' : 'FAIL'}] ${c.file} · ${r.name}: ${r.need}=${r.got} (阈值 ${r.min})`);
    }
  }
  console.log(allOk ? '\n[verify-art] ALL PASS ✓' : '\n[verify-art] SOME FAILED ✗');
  process.exit(allOk ? 0 : 1);
} catch (e) {
  console.error('[verify] ' + e.message);
  process.exit(1);
}
