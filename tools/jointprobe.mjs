#!/usr/bin/env node
// 无脚趾骨模型的朝向判定：列出全部骨骼名+绑定姿态坐标，并对腿/脚链做膝前突判定
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
const PORT = 9369;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-joint-'));
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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout')); } }, 60000);
  });
  return { ready, call };
}

const EVAL = `(async () => {
  const THREE = await import('three');
  const D = window.__TD_DEBUG;
  let b = null;
  for (let i = 0; i < 250 && !b; i++) { b = D.battle(); if (!b) await new Promise((r) => setTimeout(r, 300)); }
  await new Promise((r) => setTimeout(r, 2200));
  const REP = [['cesiumman','mummy'],['brainstem','dancer'],['robot','grunt'],['fox','fox']];
  const out = [];
  for (const [model, type] of REP) {
    b.spawnEnemy(type);
    const e = b.enemies[b.enemies.length - 1];
    const g = e.mesh;
    g.position.set(0,0,0); g.rotation.set(0,0,0);
    if (e.mixer) { e.mixer.stopAllAction(); e.mixer.setTime(0); }
    g.updateMatrixWorld(true);
    const bones = [];
    g.traverse((o) => { if (o.isBone) bones.push(o); });
    const wp = (o) => { const v = new THREE.Vector3(); o.getWorldPosition(v); return v; };
    const list = bones.map((bo) => {
      const p = wp(bo);
      return { name: bo.name || '(空)', x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3),
               parent: bo.parent?.isBone ? (bo.parent.name || '(空)') : '(root)' };
    });
    e.alive = false; e.disposed = true;
    out.push({ model, type, currentYaw: +(e.def.model.yaw ?? 0).toFixed(2), bones: list });
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
    if (r.result.value?.fatal) { console.error('fatal'); process.exit(2); }
    if (r.result.value?.ready) break;
    await sleep(400);
  }
  const r = await call('Runtime.evaluate', { expression: EVAL, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) { console.error('[joint-exception] ' + JSON.stringify(r.exceptionDetails).slice(0, 600)); process.exit(1); }
  for (const e of JSON.parse(r.result.value)) {
    console.log(`=== ${e.model} (yaw=${e.currentYaw}) 骨骼 ${e.bones.length} ===`);
    // 按 y 排序：最低的是脚
    const byY = [...e.bones].sort((a, b2) => a.y - b2.y);
    console.log('  最低 6 个骨骼（脚部候选）:');
    for (const bo of byY.slice(0, 6)) console.log(`    ${bo.name.padEnd(26)} y=${String(bo.y).padStart(7)} z=${String(bo.z).padStart(8)} x=${String(bo.x).padStart(7)}  父=${bo.parent}`);
    console.log('  最高 3 个骨骼（头部候选）:');
    for (const bo of byY.slice(-3)) console.log(`    ${bo.name.padEnd(26)} y=${String(bo.y).padStart(7)} z=${String(bo.z).padStart(8)} x=${String(bo.x).padStart(7)}  父=${bo.parent}`);
    // 末端骨骼（无子骨骼）中最低者 = 脚尖/蹄
    const parents = new Set(e.bones.map((x) => x.parent));
    const leaves = e.bones.filter((x) => !parents.has(x.name));
    const leavesLow = [...leaves].sort((a, b2) => a.y - b2.y).slice(0, 6);
    console.log('  末端骨骼中最低 6 个（脚尖/蹄候选）:');
    for (const bo of leavesLow) console.log(`    ${bo.name.padEnd(26)} y=${String(bo.y).padStart(7)} z=${String(bo.z).padStart(8)}  父=${bo.parent}`);
    // 脚尖相对其父的 dz
    const byName = new Map(e.bones.map((x) => [x.name, x]));
    const dzs = [];
    for (const bo of leavesLow) {
      const p = byName.get(bo.parent);
      if (p) dzs.push({ leaf: bo.name, dz: +(bo.z - p.z).toFixed(4), dy: +(bo.y - p.y).toFixed(4) });
    }
    console.log('  末端相对父骨 dz:', dzs.map((d) => `${d.leaf}:${d.dz}`).join(' '));
    const valid = dzs.filter((d) => Math.abs(d.dz) > 1e-3);
    if (valid.length) {
      const mean = valid.reduce((s, d) => s + d.dz, 0) / valid.length;
      const native = mean > 0 ? '+Z' : '-Z';
      const need = native === '+Z' ? 3.14 : 0;
      console.log(`  → 末端 dz 均值 ${mean.toFixed(4)} ⇒ 原生 ${native} ⇒ 应 yaw=${need}` + (Math.abs(e.currentYaw - need) > 0.1 ? ' ★不一致' : ' ✓'));
    }
    console.log('');
  }
  process.exit(0);
} catch (e) {
  console.error('[joint] ' + e.message);
  process.exit(1);
}
