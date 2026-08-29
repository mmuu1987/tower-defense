#!/usr/bin/env node
// 对比探针：磁盘 PNG vs 现场重绘画布，逐坐标采样找出差异 + 无 clip 截图对照
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = fs.readFileSync(path.join(ROOT, 'logs', 'art', 'raw-meadow-hero.png')).toString('base64');
const PNG = fs.readFileSync(path.join(ROOT, 'release', '4399', 'art', 'banner-1-hero.png')).toString('base64');

const BROWSERS = [
  process.env.TD_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const exe = BROWSERS.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
const PORT = 9345;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-cmp-'));
const child = spawn(exe, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${PORT}`,
  '--window-size=1280,720', 'about:blank',
], { stdio: 'ignore' });
const cleanup = () => { try { child.kill(); } catch {} try { fs.rmSync(prof, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanup);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let wsUrl = null;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !wsUrl) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch {}
    if (!wsUrl) await sleep(300);
  }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
    if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); p.resolve(msg.result); }
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout')); } }, 30000);
  });
  const evalJs = async (expression) => {
    const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description || '').slice(0, 400));
    return r.result?.value;
  };

  // 页面里：同时放 磁盘PNG(canvas A) 与 重复合成(canvas B)，对同一批坐标采样
  const samples = await evalJs(`(async () => {
    const W = 1280, H = 720;
    document.body.style.cssText = 'margin:0;overflow:hidden';
    const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; c.style.cssText = 'position:absolute;left:0;top:0;width:' + W + 'px;height:' + H + 'px'; document.body.appendChild(c); return c; };
    const A = mk(); // 磁盘 PNG
    const imgA = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,${PNG}'; });
    A.getContext('2d').drawImage(imgA, 0, 0);
    const B = mk(); // 现场重复合成（与 make-art 同逻辑）
    const g = B.getContext('2d');
    const bg = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,${RAW}'; });
    g.drawImage(bg, 0, 0, W, H);
    const chip = (text, x, y, size) => {
      g.font = '700 ' + size + 'px "Microsoft YaHei"';
      const pad = size * 0.62, w = g.measureText(text).width + pad * 2, h = size * 1.9, r = h / 2;
      g.beginPath(); g.roundRect(x, y, w, h, r);
      g.fillStyle = 'rgba(10,18,34,0.85)'; g.fill();
      g.lineWidth = 2; g.strokeStyle = 'rgba(255,205,90,0.55)'; g.stroke();
      g.fillStyle = '#f2f6ff'; g.textBaseline = 'middle'; g.textAlign = 'left';
      g.fillText(text, x + pad, y + h / 2 + 1);
    };
    chip('五塔布阵', 72, 620, 26);
    const pts = [[100, 640], [200, 645], [300, 640], [400, 645], [120, 628], [500, 640], [88, 645], [250, 630]];
    const read = (cv) => pts.map(([x, y]) => { const d = cv.getContext('2d').getImageData(x, y, 1, 1).data; return d[0] + d[1] + d[2]; });
    return { png: read(A), redraw: read(B), pts };
  })()`);

  console.log('坐标(x,y)          磁盘PNG   现场重绘');
  samples.pts.forEach(([x, y], i) => {
    console.log(`(${x},${y})`.padEnd(18) + String(samples.png[i]).padStart(7) + String(samples.redraw[i]).padStart(9));
  });

  // 对照：无 clip 全页截图里角标区是否明亮
  const shot = await call('Page.captureScreenshot', { format: 'png' });
  const full = Buffer.from(shot.data, 'base64');
  fs.writeFileSync(path.join(ROOT, 'logs', 'art', 'debug-full-viewport.png'), full);
  const check = await evalJs(`(async () => {
    const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,${shot.data}'; });
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
    let b = 0;
    const d = g.getImageData(60, 610, 780, 65).data;
    for (let p = 0; p < d.length; p += 4) if (d[p] + d[p+1] + d[p+2] > 500) b++;
    return { w: img.width, h: img.height, chipBright: b };
  })()`);
  console.log('无clip整页截图:', JSON.stringify(check), '→ logs/art/debug-full-viewport.png');
  process.exit(0);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
