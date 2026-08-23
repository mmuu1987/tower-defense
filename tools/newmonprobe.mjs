#!/usr/bin/env node
// 新怪物模型标定探针：对 fox/cesiumman/brainstem/bird_flamingo/bird_stork
//   1) 列出动画剪辑名（确认行走剪辑能否被 findClip 命中）
//   2) 骨骼初始化后实测天然身高（供 ENEMY_RAW_HEIGHT 标定）
//   3) rotation.y=0 侧视/正视截图 → 判定原生朝向（屏幕左 = +Z）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const URL_TARGET = process.argv[2] || 'http://127.0.0.1:8137/?level=0,0';
const OUT_SIDE = process.argv[3] || 'logs/newmon-side.png';
const OUT_FRONT = process.argv[4] || 'logs/newmon-front.png';

const BROWSERS = [
  process.env.TD_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const exe = BROWSERS.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!exe) { console.error('[newmon] no browser found'); process.exit(3); }

const PORT = 9351;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-newmon-'));
const child = spawn(exe, [
  '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${PORT}`,
  '--window-size=1280,720', '--hide-scrollbars', URL_TARGET,
], { stdio: 'ignore' });
const cleanup = () => { try { child.kill(); } catch {} try { fs.rmSync(prof, { recursive: true, force: true }) } catch {} };
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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('cdp timeout ' + method)); } }, 30000);
  });
  return { ready, call };
}

const EVAL = `(async () => {
  const D = window.__TD_DEBUG;
  let b = null;
  for (let i = 0; i < 200 && !b; i++) { b = D.battle(); if (!b) await new Promise((r) => setTimeout(r, 300)); }
  if (!b) return String(window.__TD_FATAL || 'no-battle');
  const lib = await import('./js/engine/modellib.js');
  const THREE = await import('three');
  const names = ['fox', 'cesiumman', 'brainstem', 'bird_flamingo', 'bird_stork'];
  const out = [];
  const insts = [];
  for (let i = 0; i < names.length; i++) {
    const nm = names[i];
    const tpl = await lib.loadEnemyTemplate(nm);
    if (!tpl) { out.push({ name: nm, fail: 'load' }); continue; }
    const clips = (tpl.animations || []).map((c) => c.name || '(unnamed)');
    const inst = lib.makeEnemyInstance(nm, 2.0);
    if (!inst) { out.push({ name: nm, fail: 'instance' }); continue; }
    inst.group.position.set(0, 0, (i - 2) * 2.8);
    inst.group.rotation.y = 0;
    D.scene.add(inst.group);
    insts.push({ nm, inst });
    out.push({ name: nm, clips, cachedHeight: +tpl.height.toFixed(2), walk: inst.actions.walk ? inst.actions.walk.getClip().name : null, death: inst.actions.death ? inst.actions.death.getClip().name : null });
  }
  // 等骨骼初始化（渲染若干帧）
  await new Promise((r) => setTimeout(r, 1200));
  // 实测天然身高：世界顶点包围盒 / 缩放
  const v = new THREE.Vector3();
  for (const { nm, inst } of insts) {
    inst.group.updateMatrixWorld(true);
    const box = new THREE.Box3();
    let any = false;
    inst.group.traverse((o) => {
      if (!o.isSkinnedMesh || !o.geometry) return;
      o.skeleton.update?.();
      const pos = o.geometry.attributes.position;
      if (!pos) return;
      const step = Math.max(1, Math.floor(pos.count / 300));
      for (let i = 0; i < pos.count; i += step) {
        o.getVertexPosition(i, v);
        v.applyMatrix4(o.matrixWorld);
        box.expandByPoint(v);
        any = true;
      }
    });
    if (!any) { out.find((x) => x.name === nm).naturalHeight = null; continue; }
    const size = box.getSize(new THREE.Vector3());
    const s = inst.group.scale.x;
    const rec = out.find((x) => x.name === nm);
    rec.naturalHeight = +(size.y / s).toFixed(2);
    rec.zCenter = +(((box.min.z + box.max.z) / 2) / s).toFixed(2);
    rec.renderedH = +size.y.toFixed(2);
  }
  window.__NM_INSTS = insts;
  // 侧视：相机 +X → 屏幕左 = +Z
  D.rig.pitch = 0.22; D.rig.yaw = Math.PI / 2; D.rig.dist = 15;
  D.rig.cur.yaw = Math.PI / 2; D.rig.cur.dist = 15;
  D.rig.cur.focus.set(0, 0, 0);
  await new Promise((r) => setTimeout(r, 700));
  return JSON.stringify(out);
})()`;

try {
  const wsUrl = await findTarget();
  const { ready, call } = cdp(wsUrl);
  await ready;
  await call('Page.enable');
  await call('Runtime.enable');

  const t0 = Date.now();
  let okState = null;
  while (Date.now() - t0 < 30000) {
    const r = await call('Runtime.evaluate', { expression: '({ready: !!window.__TD_READY, fatal: window.__TD_FATAL || null})', returnByValue: true });
    const v = r.result.value || {};
    if (v.fatal) { console.error('[newmon] page fatal:\n' + v.fatal); process.exit(2); }
    if (v.ready) { okState = 'ready'; break; }
    await sleep(400);
  }
  if (!okState) { console.error('[newmon] timeout waiting __TD_READY'); process.exit(4); }

  await sleep(1200);
  const r = await call('Runtime.evaluate', { expression: EVAL, returnByValue: true, awaitPromise: true });
  console.log('[newmon] ' + JSON.stringify(r.result?.value ?? r.result ?? null));
  if (r.exceptionDetails) console.log('[newmon-exception] ' + JSON.stringify(r.exceptionDetails).slice(0, 900));

  const shot1 = await call('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(path.dirname(OUT_SIDE), { recursive: true });
  fs.writeFileSync(OUT_SIDE, Buffer.from(shot1.data, 'base64'));
  console.log(`[newmon] saved ${OUT_SIDE}`);

  await call('Runtime.evaluate', { expression: `(async () => {
    const D = window.__TD_DEBUG;
    const list = window.__NM_INSTS;
    // 其余全部藏到地下，只留当前模型在原点 → 特写侧视
    for (let i = 0; i < list.length; i++) {
      const { inst } = list[i];
      inst.group.position.set(0, -50, 0);
    }
    window.__NM_SHOTS = [];
    for (let i = 0; i < list.length; i++) {
      const { nm, inst } = list[i];
      for (const { inst: other } of list) if (other !== inst) other.group.position.y = -50;
      inst.group.position.set(0, 0, 0);
      inst.group.rotation.y = 0;
      inst.group.updateMatrixWorld(true);
      D.rig.pitch = 0.16; D.rig.yaw = Math.PI / 2; D.rig.dist = 6.5;
      D.rig.cur.yaw = Math.PI / 2; D.rig.cur.dist = 6.5;
      D.rig.cur.focus.set(0, 0.8, 0);
      await new Promise((r2) => setTimeout(r2, 500));
      window.__NM_SHOTS.push(nm);
    }
    return 'closeups-done';
  })()`, returnByValue: true, awaitPromise: true });
  // 逐模型近距双视角：侧视(yaw=π/2，屏幕左=+Z) + 正视(yaw=0，面向镜头=+Z)
  const CLOSE = [
    ['brainstem', 4.2],
    ['bird_flamingo', 4.2],
    ['bird_stork', 4.2],
  ];
  for (const [nm, dist] of CLOSE) {
    for (const [view, yawExpr] of [['side', 'Math.PI / 2'], ['front', '0']]) {
      const expr2 = `(async () => {
        const D = window.__TD_DEBUG;
        const list = window.__NM_INSTS;
        const cur = list.find((x) => x.nm === '${nm}');
        if (!cur) return 'no-${nm}';
        for (const { inst } of list) inst.group.position.y = -50;
        cur.inst.group.position.set(0, 0, 0);
        cur.inst.group.rotation.y = 0;
        cur.inst.group.updateMatrixWorld(true);
        D.rig.pitch = 0.14; D.rig.dist = ${dist}; D.rig.cur.dist = ${dist};
        D.rig.yaw = ${yawExpr}; D.rig.cur.yaw = ${yawExpr};
        D.rig.cur.focus.set(0, 1.0, 0);
        await new Promise((r2) => setTimeout(r2, 450));
        return 'ok';
      })()`;
      const res = await call('Runtime.evaluate', { expression: expr2, returnByValue: true, awaitPromise: true });
      if (res?.exceptionDetails) console.log(`[newmon][${nm}-${view}-exception] ` + JSON.stringify(res.exceptionDetails).slice(0, 500));
      const shot = await call('Page.captureScreenshot', { format: 'png' });
      const out = path.join(OUT_SIDE, '..', `zoom-${nm}-${view}.png`);
      fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
      console.log(`[newmon] saved zoom-${nm}-${view}.png`);
    }
  }
  process.exit(0);
} catch (e) {
  console.error('[newmon] ' + e.message);
  process.exit(1);
}
