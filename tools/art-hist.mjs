#!/usr/bin/env node
// 定位 UI 截图中按钮行/塔坞的实际坐标（x 直方图）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.argv[2] || path.join(ROOT, 'release', '4399', 'art', 'banner-5-ui.png');

const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
  .find((p) => { try { return fs.existsSync(p); } catch { return false; } });
const PORT = 9346;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-hist-'));
const child = spawn(exe, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${PORT}`, '--window-size=900,700', 'about:blank',
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
  const call = (method, params = {}) => new Promise((resolve) => {
    const id = ++seq; pending.set(id, { resolve });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve(null); } }, 30000);
  });

  const data = fs.readFileSync(FILE).toString('base64');
  const r = await (async () => {
    const res = await call('Runtime.evaluate', {
      expression: `(async () => {
        const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,${data}'; });
        const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
        const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
        const W = img.width, H = img.height;
        const d = g.getImageData(0, 0, W, H).data;
        const px = (x, y) => { const p = (y * W + x) * 4; return [d[p], d[p+1], d[p+2]]; };
        // 水平直方图（80px 桶）：指定 y 区间内 bright/gold 像素的 x 分布
        const hist = (y0, y1) => {
          const cols = [];
          for (let x = 0; x < W; x += 80) cols.push({ x, bright: 0, gold: 0 });
          for (let y = y0; y < Math.min(y1, H); y++) for (let x = 0; x < W; x++) {
            const [R, G, B] = px(x, y);
            const c = cols[Math.floor(x / 80)];
            if (R + G + B > 500) c.bright++;
            if (R > 170 && G > 110 && G < 230 && B < 120 && R > G && G > B) c.gold++;
          }
          return cols.filter((c) => c.bright + c.gold > 0);
        };
        return {
          size: [W, H],
          topRow: hist(20, 100),      // 按钮行 + 资源条
          bottom: hist(580, 720),     // 塔坞 / 面板
        };
      })()`, returnByValue: true, awaitPromise: true,
    });
    return res.result.value;
  })();

  console.log('文件:', FILE);
  console.log('尺寸:', r.size);
  console.log('\n顶部 y20-100（资源条+按钮行）x 直方图:');
  for (const c of r.topRow) console.log(`  x${c.x}-${c.x + 80}: bright=${c.bright} gold=${c.gold}`);
  console.log('\n底部 y580-720（塔坞/面板）x 直方图:');
  for (const c of r.bottom) console.log(`  x${c.x}-${c.x + 80}: bright=${c.bright} gold=${c.gold}`);
  process.exit(0);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
