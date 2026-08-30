#!/usr/bin/env node
// 用户截图颜色聚类分析：网格采样 → 色相聚类 → 输出主要色块的位置和占比
// 用于在"看不了图"的会话里识别截图里出现了哪些敌人（对照 ENEMY_DEFS 配色）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const FILE = process.argv[2];
if (!FILE || !fs.existsSync(FILE)) { console.error('[imgscan] 文件不存在: ' + FILE); process.exit(3); }

const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
  .find((p) => { try { return fs.existsSync(p); } catch { return false; } });
const PORT = 9355;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-scan-'));
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

  const b64 = fs.readFileSync(FILE).toString('base64');
  const isJpg = /\.jpe?g$/i.test(FILE);
  const r = await call('Runtime.evaluate', {
    expression: `(async () => {
      const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/${isJpg ? 'jpeg' : 'png'};base64,${b64}'; });
      const W = img.width, H = img.height;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, W, H).data;
      // RGB→HSL
      const hsl = (R, G, B) => {
        R /= 255; G /= 255; B /= 255;
        const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
        let h = 0, s = 0; const l = (mx + mn) / 2;
        if (mx !== mn) {
          const dd = mx - mn;
          s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
          if (mx === R) h = ((G - B) / dd + (G < B ? 6 : 0)) / 6;
          else if (mx === G) h = ((B - R) / dd + 2) / 6;
          else h = ((R - G) / dd + 4) / 6;
        }
        return [h * 360, s, l];
      };
      // 8px 网格采样，跳过过暗/过灰像素，按色相桶聚类
      const buckets = {};
      const STEP = 8;
      for (let y = 0; y < H; y += STEP) {
        for (let x = 0; x < W; x += STEP) {
          const p = (y * W + x) * 4;
          const [R, G, B] = [d[p], d[p+1], d[p+2]];
          const [h, s, l] = hsl(R, G, B);
          if (l < 0.12 || l > 0.97) continue;        // 纯黑/纯白跳过
          if (s < 0.18 && l < 0.45) continue;         // 暗灰背景跳过
          let key;
          if (s < 0.14) key = l > 0.7 ? '白/亮灰' : '中灰';
          else if (h < 15 || h >= 345) key = '红';
          else if (h < 45) key = l > 0.55 ? '米黄/橙黄' : '棕橙';
          else if (h < 70) key = '黄绿';
          else if (h < 150) key = '绿';
          else if (h < 200) key = '青/青绿';
          else if (h < 250) key = '蓝/蓝紫';
          else if (h < 290) key = '紫';
          else key = '粉/品红';
          (buckets[key] ||= { n: 0, xs: [], ys: [], sSum: 0, lSum: 0 });
          const b = buckets[key];
          b.n++; b.xs.push(x); b.ys.push(y); b.sSum += s; b.lSum += l;
        }
      }
      const total = Object.values(buckets).reduce((a, b) => a + b.n, 0) || 1;
      const box = (arr) => { arr.sort((a, b2) => a - b2); return [arr[Math.floor(arr.length * 0.05)], arr[Math.floor(arr.length * 0.95)]]; };
      const out = Object.entries(buckets)
        .filter(([, b]) => b.n >= 30)
        .sort((a, b2) => b2[1].n - a[1].n)
        .slice(0, 10)
        .map(([k, b]) => {
          const [x0, x1] = box(b.xs); const [y0, y1] = box(b.ys);
          return { 色: k, 占比: +(b.n / total * 100).toFixed(1) + '%', 区域: 'x' + x0 + '-' + x1 + ',y' + y0 + '-' + y1, 饱和度: +(b.sSum / b.n).toFixed(2), 亮度: +(b.lSum / b.n).toFixed(2) };
        });
      return JSON.stringify({ 尺寸: [W, H], 色块: out });
    })()`,
    returnByValue: true, awaitPromise: true,
  });
  console.log('文件:', FILE);
  const v = r?.result?.value;
  if (!v) { console.error('[imgscan] 分析失败: ' + JSON.stringify(r).slice(0, 300)); process.exit(1); }
  const parsed = JSON.parse(v);
  console.log('尺寸:', parsed.尺寸.join('×'));
  console.log('主要色块（按占比）:');
  for (const c of parsed.色块) console.log(' ', JSON.stringify(c));
  process.exit(0);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
