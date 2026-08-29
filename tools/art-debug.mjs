#!/usr/bin/env node
// 素材调试探针：定位产物中亮像素/金像素的实际分布，校准校验区域
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
].filter(Boolean);
const exe = BROWSERS.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
const PORT = 9344;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-dbg-'));
const child = spawn(exe, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${PORT}`,
  '--window-size=900,700', 'about:blank',
], { stdio: 'ignore' });
const cleanup = () => { try { child.kill(); } catch {} try { fs.rmSync(prof, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanup);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const deadline = Date.now() + 15000;
  let wsUrl = null;
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
  const call = (method, params = {}) => new Promise((resolve) => {
    const id = ++seq; pending.set(id, { resolve });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve(null); } }, 30000);
  });
  const evalJs = async (expression) => {
    const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r?.result?.value;
  };

  for (const file of ['banner-1-hero.png', 'banner-5-ui.png']) {
    const data = fs.readFileSync(path.join(ART, file)).toString('base64');
    const r = await evalJs(`(async () => {
      const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,${data}'; });
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
      const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
      const W = img.width, H = img.height;
      const d = g.getImageData(0, 0, W, H).data;
      const px = (x, y) => { const p = (y * W + x) * 4; return [d[p], d[p+1], d[p+2]]; };
      const isBright = (R, G, B) => R + G + B > 500;
      const isGold = (R, G, B) => R > 170 && G > 110 && G < 230 && B < 120 && R > G && G > B;
      // 亮像素/金像素包围盒
      let bb = null, bg2 = null;
      for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
        const [R, G, B] = px(x, y);
        if (isBright(R, G, B)) { if (!bb) bb = { x0: x, y0: y, x1: x, y1: y }; else { bb.x0 = Math.min(bb.x0, x); bb.y0 = Math.min(bb.y0, y); bb.x1 = Math.max(bb.x1, x); bb.y1 = Math.max(bb.y1, y); } }
        if (isGold(R, G, B)) { if (!bg2) bg2 = { x0: x, y0: y, x1: x, y1: y }; else { bg2.x0 = Math.min(bg2.x0, x); bg2.y0 = Math.min(bg2.y0, y); bg2.x1 = Math.max(bg2.x1, x); bg2.y1 = Math.max(bg2.y1, y); } }
      }
      // 每 60px 高度带的亮/金像素计数
      const bands = [];
      for (let y = 0; y < H; y += 60) {
        let b = 0, gd = 0;
        for (let yy = y; yy < Math.min(y + 60, H); yy++) for (let x = 0; x < W; x += 2) {
          const [R, G, B] = px(x, yy);
          if (isBright(R, G, B)) b++;
          if (isGold(R, G, B)) gd++;
        }
        bands.push(\`y\${y}-\${y + 60}: bright=\${b} gold=\${gd}\`);
      }
      return { file: '${file}', brightBox: bb, goldBox: bg2, bands };
    })()`);
    console.log(`\n=== ${file} ===`);
    console.log('亮像素包围盒:', JSON.stringify(r.brightBox));
    console.log('金像素包围盒:', JSON.stringify(r.goldBox));
    console.log(r.bands.join('\n'));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
