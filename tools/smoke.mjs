#!/usr/bin/env node
// 冒烟测试：无头浏览器加载游戏 → 自动战斗 30s → 断言无致命错误/无客户端报错/战斗在推进
// 用法: node tools/smoke.mjs   （退出码 0=通过）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const URL_TARGET = process.argv[2] || 'http://127.0.0.1:8137/?auto=1&level=0,0';
const SETTLE_MS = Number(process.argv[3] || 30000);
const PORT = 9339;

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter((p) => { try { return fs.existsSync(p); } catch { return false; } });
const exe = BROWSERS[0];
if (!exe) { console.error('[smoke] FAIL: no browser'); process.exit(3); }

const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-smoke-'));
const child = spawn(exe, [
  '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${PORT}`,
  '--window-size=1280,720', '--hide-scrollbars', URL_TARGET,
], { stdio: 'ignore' });
const cleanup = () => { try { child.kill(); } catch {} try { fs.rmSync(prof, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanup);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpConnect() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
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
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
        return {
          call(method, params = {}) {
            return new Promise((resolve, reject) => {
              const id = ++seq;
              pending.set(id, { resolve, reject });
              ws.send(JSON.stringify({ id, method, params }));
              setTimeout(() => reject(new Error('cdp timeout')), 15000);
            });
          },
        };
      }
    } catch {}
    await sleep(300);
  }
  throw new Error('devtools unreachable');
}

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' —— ' + detail : ''}`);
  if (!ok) failures++;
};

try {
  // 记录起始日志位置（之后新增的才算本次运行的错误）
  const logBefore = ((await (await fetch('http://127.0.0.1:8137/api/logs?n=1000')).json()).lines).length;

  const dev = await cdpConnect();
  await dev.call('Page.enable');
  await dev.call('Runtime.enable');

  // 1) 页面就绪
  let ready = false, fatalMsg = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    const r = await dev.call('Runtime.evaluate', {
      expression: '({ready: !!window.__TD_READY, fatal: window.__TD_FATAL || null})', returnByValue: true,
    });
    if (r.result.value.fatal) { fatalMsg = r.result.value.fatal; break; }
    if (r.result.value.ready) { ready = true; break; }
    await sleep(400);
  }
  check('页面首帧渲染 (__TD_READY)', ready && !fatalMsg, fatalMsg ? String(fatalMsg).slice(0, 200) : '');

  // 2) 自动战斗运行
  await sleep(SETTLE_MS);

  const snap = (await dev.call('Runtime.evaluate', {
    expression: 'window.__TD_SNAP ? JSON.stringify(window.__TD_SNAP()) : "no-snap"', returnByValue: true,
  })).result.value;
  let snapObj = {};
  try { snapObj = JSON.parse(snap); } catch {}
  check('战斗状态推进', snapObj.state === 'combat' || snapObj.state === 'intermission' ||
    snapObj.state === 'won' || snapObj.state === 'build',
    `state=${snapObj.state} wave=${snapObj.wave}/${snapObj.totalWaves} towers=${snapObj.towers} kills=${snapObj.kills}`);
  check('已建造防御塔', (snapObj.towers || 0) >= 2, `towers=${snapObj.towers}`);
  check('波次已推进', (snapObj.wave || 0) >= 1, `wave=${snapObj.wave}`);

  // 3) 客户端零报错（本次运行新增日志中不得有 error/fatal）
  const logsAfter = (await (await fetch(`http://127.0.0.1:8137/api/logs?n=1000`)).json()).lines;
  const fresh = logsAfter.slice(logBefore);
  const errs = fresh.filter((l) => l.includes('[td-error]') || l.includes('main-fatal') ||
    l.includes('html-error') || l.includes('td-rejection'));
  check('客户端零报错', errs.length === 0, errs.length ? errs[0].slice(0, 160) : `${fresh.length} 条新日志全部正常`);

  console.log(failures === 0 ? '\n[smoke] PASS ✓' : `\n[smoke] FAIL ✗ (${failures} 项未通过)`);
  process.exit(failures === 0 ? 0 : 1);
} catch (e) {
  console.error('[smoke] FAIL ✗:', e.message);
  process.exit(1);
}
