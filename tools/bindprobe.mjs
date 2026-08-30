#!/usr/bin/env node
// 动画绑定诊断：逐条检查 clip 轨道能否解析到场景对象（THREE 按名字绑定，
// 未命名节点/名字不匹配会导致轨道静默失效 → 模型定格在绑定姿态 = T-pose）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const URL_TARGET = process.argv[2] || 'http://127.0.0.1:8137/?level=0,0';
const exe = [
  process.env.TD_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean).find((p) => { try { return fs.existsSync(p); } catch { return false; } });
const PORT = 9361;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-bind-'));
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
  const deadline = Date.now() + 20000;
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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout ' + method)); } }, 60000);
  });
  return { ready, call };
}

const EVAL = `(async () => {
  const THREE = await import('three');
  const D = window.__TD_DEBUG;
  let b = null;
  for (let i = 0; i < 250 && !b; i++) { b = D.battle(); if (!b) await new Promise((r) => setTimeout(r, 300)); }
  await new Promise((r) => setTimeout(r, 2200));
  const REP = [['brainstem', 'dancer'], ['cesiumman', 'mummy'], ['soldier', 'healer']];
  const out = [];
  for (const [model, type] of REP) {
    b.spawnEnemy(type);
    const e = b.enemies[b.enemies.length - 1];
    if (!e?.mixer) { out.push({ model, err: 'no mixer' }); continue; }
    const root = e.mesh;
    const clip = e.actions?.walk?._clip;
    const names = [];
    root.traverse((o) => { if (o.name) names.push(o.name); });
    const tracks = (clip?.tracks || []).map((t) => t.name);
    // 解析测试：THREE.PropertyBinding.findNode(root, nodeName)
    const parse = (trackName) => {
      const m = /^([^.]*)\\./.exec(trackName);
      return m ? m[1] : '';
    };
    const unresolved = [];
    const resolved = [];
    for (const tn of tracks) {
      const nodeName = parse(tn);
      const found = THREE.PropertyBinding.findNode(root, nodeName);
      (found ? resolved : unresolved).push(tn);
    }
    // 骨骼名
    const bones = [];
    root.traverse((o) => { if (o.isBone) bones.push(o.name || '(空名)'); });
    e.alive = false; e.disposed = true;
    out.push({
      model, clip: clip?.name ?? null, duration: +(clip?.duration ?? 0).toFixed(2),
      trackCount: tracks.length,
      resolvedCount: resolved.length, unresolvedCount: unresolved.length,
      sampleTracks: tracks.slice(0, 6),
      sampleUnresolved: unresolved.slice(0, 6),
      boneCount: bones.length, sampleBones: bones.slice(0, 6),
      objNamesSample: names.slice(0, 8),
    });
  }
  return JSON.stringify(out);
})()`;

try {
  const { ready, call } = cdp(await findTarget());
  await ready;
  await call('Page.enable');
  await call('Runtime.enable');
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    const r = await call('Runtime.evaluate', { expression: '({ready: !!window.__TD_READY, fatal: window.__TD_FATAL || null})', returnByValue: true });
    if (r.result.value?.fatal) { console.error('fatal: ' + r.result.value.fatal); process.exit(2); }
    if (r.result.value?.ready) break;
    await sleep(400);
  }
  const r = await call('Runtime.evaluate', { expression: EVAL, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) { console.error('[bind-exception] ' + JSON.stringify(r.exceptionDetails).slice(0, 700)); process.exit(1); }
  for (const e of JSON.parse(r.result.value)) {
    console.log('=== ' + e.model + ' ===');
    if (e.err) { console.log('  ' + e.err); continue; }
    console.log(`  剪辑 ${e.clip} 时长 ${e.duration}s 轨道 ${e.trackCount} → 解析成功 ${e.resolvedCount} / 失败 ${e.unresolvedCount}`);
    console.log('  轨道样例:', e.sampleTracks.join(' | '));
    if (e.sampleUnresolved.length) console.log('  ★失败轨道:', e.sampleUnresolved.join(' | '));
    console.log(`  骨骼 ${e.boneCount} 个，样例:`, e.sampleBones.join(' | '));
    console.log('  对象名样例:', e.objNamesSample.join(' | '));
  }
  process.exit(0);
} catch (e) {
  console.error('[bind] ' + e.message);
  process.exit(1);
}
