#!/usr/bin/env node
// 提前开战探针：验证波间"提前开战拿奖励金"完整链路
//   ①下一波预览条显示敌人构成  ②开波按钮倒计时态(含奖励金文案+脉冲样式)
//   ③点击按钮=提前开战：金币精确入账+横幅+波次推进  ④空格键也能开波
//   ⑤波次爬坡倍率在预览条可见(⚔️×)
// 用法: node tools/rushprobe.mjs [--url=http://127.0.0.1:8137/?level=0,3]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
// 0,3 非教学关：全新档案也不会触发新手引导
const URL_TARGET = arg('url', 'http://127.0.0.1:8137/?level=0,3');

const BROWSERS = [
  process.env.TD_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const exe = BROWSERS.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!exe) { console.error('[rushprobe] no browser found'); process.exit(3); }

const PORT = 9358;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-rush-'));
const child = spawn(exe, [
  '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${PORT}`,
  '--window-size=1000,720', '--hide-scrollbars', URL_TARGET,
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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('cdp timeout ' + method)); } }, 20000);
  });
  return { ready, call };
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' —— ' + detail : ''}`);
};

try {
  const wsUrl = await findTarget();
  const { ready, call } = cdp(wsUrl);
  await ready;
  await call('Page.enable');
  await call('Runtime.enable');

  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const r = await call('Runtime.evaluate', { expression: '({ready: !!window.__TD_READY, fatal: window.__TD_FATAL || null})', returnByValue: true });
    if (r.result.value?.fatal) { console.error('[rushprobe] page fatal'); process.exit(2); }
    if (r.result.value?.ready) break;
    await sleep(400);
  }
  const get = (expr) => call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).then(r => {
    if (r.exceptionDetails) console.log('[eval-exception]', String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 240));
    return r.result?.value;
  });
  const waitFor = async (expr, timeoutMs = 15000, pollMs = 350) => {
    const t = Date.now();
    while (Date.now() - t < timeoutMs) {
      const v = await get(expr);
      if (v) return v;
      await sleep(pollMs);
    }
    return null;
  };

  // 等战斗就绪
  const tb = Date.now();
  while (Date.now() - tb < 20000) {
    if (await get(`!!(window.__TD_DEBUG && window.__TD_DEBUG.battle && window.__TD_DEBUG.battle())`)) break;
    await sleep(400);
  }
  await sleep(600);

  // ① 建造期：下一波预览条 + 开波按钮
  let s = await get(`({
    next: document.querySelector('#hud-next')?.textContent || '',
    nextHidden: document.querySelector('#hud-next')?.classList.contains('hidden'),
    btn: document.querySelector('#btn-wave')?.textContent || '',
    btnHidden: document.querySelector('#btn-wave')?.classList.contains('hidden'),
  })`);
  check('建造期显示下一波预览（含敌人构成）', !s.nextHidden && /×\d/.test(s.next), JSON.stringify(s));
  check('建造期显示开波按钮', !s.btnHidden, s.btn);

  // ② 开第一波（真实按钮点击），加速跑完
  await get(`document.querySelector('#btn-wave').click()`);
  s = await waitFor(`(()=>{const b=__TD_DEBUG.battle();return b.state==='combat'&&b.waveIdx===0?{st:b.state}:null})()`);
  check('点击开波按钮进入战斗', !!s, JSON.stringify(s));
  await get(`__TD_DEBUG.battle().speed = 3`);

  // ③ 等波间休整（无塔会漏怪，漏完也算清波）
  s = await waitFor(`(()=>{const b=__TD_DEBUG.battle();return b.state==='intermission'?{gold:b.gold,remain:+b.intermission.toFixed(2)}:null})()`, 90000, 300);
  check('进入波间休整', !!s, JSON.stringify(s));
  // 休整期降回 1 速便于断言（倒计时衰减慢下来）
  await get(`__TD_DEBUG.battle().speed = 1`);
  await sleep(500);

  s = await get(`({
    btn: document.querySelector('#btn-wave')?.textContent || '',
    rush: document.querySelector('#btn-wave')?.classList.contains('rush'),
    hidden: document.querySelector('#btn-wave')?.classList.contains('hidden'),
    gold: __TD_DEBUG.battle().gold,
    remain: +__TD_DEBUG.battle().intermission.toFixed(2),
    expect: __TD_DEBUG.battle().earlyCallBonus(Math.max(0,__TD_DEBUG.battle().intermission)),
  })`);
  check('休整期按钮变为提前开战文案（含奖励金）', !s.hidden && /提前开战 \+\d+💰/.test(s.btn), s.btn);
  check('按钮带 rush 脉冲样式', !!s.rush);

  // ④ 点击提前开战：金币精确入账 + 状态推进 + 横幅
  const before = s;
  await get(`document.querySelector('#btn-wave').click()`);
  await sleep(250);
  s = await get(`({
    gold: __TD_DEBUG.battle().gold,
    state: __TD_DEBUG.battle().state,
    wave: __TD_DEBUG.battle().waveIdx,
    banner: [...document.querySelectorAll('.banner')].map(b=>b.textContent).join('|'),
    btnHidden: document.querySelector('#btn-wave')?.classList.contains('hidden'),
    next: document.querySelector('#hud-next')?.textContent || '',
  })`);
  const delta = s.gold - before.gold;
  check('提前开战奖励金精确入账', delta === before.expect, `Δ${delta} == 预期${before.expect}`);
  check('提前开战后波次推进', s.state === 'combat' && s.wave === 1, `${s.state} wave=${s.wave}`);
  check('提前开战横幅出现', /提前开战/.test(s.banner), s.banner);
  check('开波后按钮收起', s.btnHidden);
  check('预览条更新且显示波次强化倍率', /⚔️×/.test(s.next), s.next);

  // ⑤ 下一轮休整用空格键提前开战
  await get(`__TD_DEBUG.battle().speed = 3`);
  s = await waitFor(`(()=>{const b=__TD_DEBUG.battle();return b.state==='intermission'?{gold:b.gold}:null})()`, 120000, 300);
  check('再次进入休整', !!s);
  await get(`__TD_DEBUG.battle().speed = 1`);
  await sleep(400);
  const g2 = await get(`__TD_DEBUG.battle().gold`);
  const exp2 = await get(`__TD_DEBUG.battle().earlyCallBonus(Math.max(0,__TD_DEBUG.battle().intermission))`);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
  await sleep(300);
  s = await get(`({gold: __TD_DEBUG.battle().gold, state: __TD_DEBUG.battle().state, wave: __TD_DEBUG.battle().waveIdx})`);
  check('空格键提前开战（金币+波次）', s.state === 'combat' && s.gold - g2 === exp2 && s.wave === 2,
    `Δ${s.gold - g2}/${exp2} ${s.state} wave=${s.wave}`);

  // 截图留档
  await call('Page.captureScreenshot', { format: 'png' }).then(r => {
    fs.writeFileSync('logs/rushprobe.png', Buffer.from(r.data, 'base64'));
    console.log('[rushprobe] 截图 logs/rushprobe.png');
  });

  const okAll = results.every(Boolean);
  console.log(okAll ? '[rushprobe] ALL PASS ✓' : '[rushprobe] SOME FAILED ✗');
  process.exit(okAll ? 0 : 1);
} catch (e) {
  console.error('[rushprobe] ' + e.message);
  process.exit(1);
}
