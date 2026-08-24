#!/usr/bin/env node
// 新手引导探针：全新档案模拟首次玩家，断言教学五步推进 + 取消建造体验
//   ①教学条出现  ②选箭塔(含✕取消/再选)  ③触摸建塔  ④开波  ⑤选中塔升级  ⑥完成→存档标记
// 用法: node tools/tutprobe.mjs [--url=http://127.0.0.1:8137/?level=0,0]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const URL_TARGET = arg('url', 'http://127.0.0.1:8137/?level=0,0');

const BROWSERS = [
  process.env.TD_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const exe = BROWSERS.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!exe) { console.error('[tutprobe] no browser found'); process.exit(3); }

const PORT = 9356;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-tut-')); // 全新档案：tutorialDone=false
const child = spawn(exe, [
  '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${PORT}`,
  '--window-size=900,700', '--hide-scrollbars', URL_TARGET,
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
    if (r.result.value?.fatal) { console.error('[tutprobe] page fatal'); process.exit(2); }
    if (r.result.value?.ready) break;
    await sleep(400);
  }
  const get = (expr) => call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).then(r => {
    if (r.exceptionDetails) console.log('[eval-exception]', String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 240));
    return r.result?.value;
  });
  // 轮询等待条件成立（软渲染主线程卡顿会让动作延迟数百毫秒落地，固定 sleep 会竞态）
  const waitFor = async (expr, timeoutMs = 10000, pollMs = 350) => {
    const t = Date.now();
    while (Date.now() - t < timeoutMs) {
      const v = await get(expr);
      if (v) return v;
      await sleep(pollMs);
    }
    return null;
  };
  const click = (sel) => get(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return 'missing';el.click();return 'ok'})()`);
  const touchTap = async (x, y) => {
    await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await sleep(80);
    await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };

  await sleep(300);
  // 等战斗真正建好（__TD_READY 早于 enterBattle 完成）
  const tb0 = Date.now();
  while (Date.now() - tb0 < 20000) {
    const b = await get(`!!(window.__TD_DEBUG && window.__TD_DEBUG.battle && window.__TD_DEBUG.battle())`);
    if (b) break;
    await sleep(400);
  }
  await sleep(1000); // 等教学条挂载
  let s = await get(`({tut: !!document.querySelector('#tutorial'), text: document.querySelector('#tut-text')?.textContent||'', done: window.__TD_SAVE.data.tutorialDone})`);
  check('首次进 1-1 自动开启教学', s.tut && !s.done, s.text.slice(0, 24) + '…');
  if (!s.tut) { console.log('[tutprobe] 教学未开启，终止'); process.exit(1); }

  // ① 选箭塔
  check('教学高亮箭塔卡', await get(`!!document.querySelector('.dock-card.tut-glow')`));
  await click('.dock-card');
  await sleep(300);
  s = await get(`({sel:__TD_DEBUG.battle().selectedType, cancel:!document.querySelector('#hud-cancel').classList.contains('hidden'), em:getComputedStyle(document.querySelector('.dock-card.sel em')).display})`);
  check('选中箭塔 + 取消芯片出现 + 卡片显示再点取消', s.sel === 'arrow' && s.cancel && s.em !== 'none', JSON.stringify(s));

  // ② 取消再重选（核心体验）
  await click('#btn-cancel');
  await sleep(250);
  s = await get(`({sel:__TD_DEBUG.battle().selectedType, cancelHidden:document.querySelector('#hud-cancel').classList.contains('hidden')})`);
  check('✕ 一键取消建造', s.sel === null && s.cancelHidden, JSON.stringify(s));
  await click('.dock-card');
  await sleep(250);
  check('再点塔卡重新选中', await get(`__TD_DEBUG.battle().selectedType`) === 'arrow');

  // ③ 触摸点地建塔
  const P = await get(`(async()=>{const THREE=await import('three');const D=__TD_DEBUG;const b=D.battle();
    let cell=null;outer:for(let r=0;r<10;r++)for(let dx=-r;dx<=r;dx++)for(let dz=-r;dz<=r;dz++){
      const cx=11+dx,cz=7+dz;if(b.isBuildable(cx,cz)){cell={cx,cz};break outer;}}
    const v=new THREE.Vector3(cell.cx-11+.5,0,cell.cz-7.5+.5).project(D.camera);
    return {x:(v.x*.5+.5)*innerWidth, y:(-v.y*.5+.5)*innerHeight}})()`);
  await touchTap(P.x, P.y);
  s = await waitFor(`(()=>{const b=__TD_DEBUG.battle();return b.towers.length>=1 && document.querySelector('#tut-text').textContent.includes('开始下一波') ? {towers:b.towers.length} : null})()`);
  check('建塔后教学推进到开波步骤（并自动退出建造模式）', !!s, JSON.stringify(s));
  check('建造模式已自动退出', await get(`__TD_DEBUG.battle().selectedType`) === null);

  // ④ 开波
  await click('#btn-wave');
  s = await waitFor(`(()=>{const b=__TD_DEBUG.battle();return b.waveIdx>=0 && document.querySelector('#tut-text').textContent.includes('升级') ? {w:b.waveIdx} : null})()`);
  check('开波后推进到升级步骤', !!s, JSON.stringify(s));

  // ⑤ 点建成的塔（触摸）
  const TP = await get(`(async()=>{const THREE=await import('three');const D=__TD_DEBUG;
    const t=D.battle().towers[0];const v=new THREE.Vector3(t.pos.x,0,t.pos.z).project(D.camera);
    return {x:(v.x*.5+.5)*innerWidth, y:(-v.y*.5+.5)*innerHeight}})()`);
  await touchTap(TP.x, TP.y);
  s = await waitFor(`(()=>{const b=__TD_DEBUG.battle();return !!b.selectedTower && !document.querySelector('#tut-next').classList.contains('hidden') ? {sel:true} : null})()`);
  check('选中塔后出现「开战！」完成按钮', !!s);

  // ⑥ 完成 → 存档标记
  await click('#tut-next');
  await sleep(300);
  s = await get(`({gone:!document.querySelector('#tutorial'), done:window.__TD_SAVE.data.tutorialDone})`);
  check('完成教学 + 存档标记 tutorialDone', s.gone && s.done, JSON.stringify(s));

  const okAll = results.every(Boolean);
  console.log(okAll ? '[tutprobe] ALL PASS ✓' : '[tutprobe] SOME FAILED ✗');
  process.exit(okAll ? 0 : 1);
} catch (e) {
  console.error('[tutprobe] ' + e.message);
  process.exit(1);
}
