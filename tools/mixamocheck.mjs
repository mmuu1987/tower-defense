#!/usr/bin/env node
// Mixamo 骨架朝向三重独立校验（soldier vs xbot）：绑定姿态下的解剖学前向
//   ①脚趾：踝→趾 指向前方
//   ②拇指：T-pose 掌心朝下、拇指朝前 → 拇指根→尖 的 Z 分量指向前方
//   ③膝盖：膝关节略前于 髋→踝 连线（人体绑定姿态微屈）
// 三者一致才下结论；用于判定 yaw 补偿（原生前向 +Z ⇒ yaw=π；-Z ⇒ yaw=0）
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
const PORT = 9367;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-mix-'));
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
  const REP = [['soldier','healer'],['xbot','splitter']];
  const out = [];
  for (const [model, type] of REP) {
    b.spawnEnemy(type);
    const e = b.enemies[b.enemies.length - 1];
    const g = e.mesh;
    g.position.set(0,0,0); g.rotation.set(0,0,0);
    if (e.mixer) { e.mixer.stopAllAction(); e.mixer.setTime(0); }  // 绑定姿态
    g.updateMatrixWorld(true);
    const bones = [];
    g.traverse((o) => { if (o.isBone) bones.push(o); });
    const B = (n) => bones.find((x) => x.name === n);
    const wp = (o) => { const v = new THREE.Vector3(); o.getWorldPosition(v); return v; };
    const seg = (a, c) => { const A = B(a), C = B(c); if (!A || !C) return null; const p = wp(A), q = wp(C); return { dx: +(q.x-p.x).toFixed(4), dy: +(q.y-p.y).toFixed(4), dz: +(q.z-p.z).toFixed(4) }; };

    const toeL = seg('mixamorigLeftFoot', 'mixamorigLeftToeBase');
    const toeR = seg('mixamorigRightFoot', 'mixamorigRightToeBase');
    const thumbL = seg('mixamorigLeftHandThumb1', 'mixamorigLeftHandThumb3')
                || seg('mixamorigLeftHandThumb1', 'mixamorigLeftHandThumb2');
    const thumbR = seg('mixamorigRightHandThumb1', 'mixamorigRightHandThumb3')
                || seg('mixamorigRightHandThumb1', 'mixamorigRightHandThumb2');
    // 膝前突：膝相对 髋→踝 直线的 Z 偏移
    const kneeOff = (side) => {
      const hip = B('mixamorig' + side + 'UpLeg'), knee = B('mixamorig' + side + 'Leg'), ankle = B('mixamorig' + side + 'Foot');
      if (!hip || !knee || !ankle) return null;
      const h = wp(hip), k = wp(knee), a = wp(ankle);
      const t = (k.y - h.y) / ((a.y - h.y) || 1);
      const lineZ = h.z + (a.z - h.z) * t;
      return +(k.z - lineZ).toFixed(4);
    };
    // 面部朝向：头骨与颈的 Z 差 + 头顶网格质心（辅助）
    const headSeg = seg('mixamorigNeck', 'mixamorigHead');
    e.alive = false; e.disposed = true;
    out.push({
      model, type, currentYaw: +(e.def.model.yaw ?? 0).toFixed(2),
      toeL, toeR, thumbL, thumbR,
      kneeL: kneeOff('Left'), kneeR: kneeOff('Right'),
      headSeg,
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
  if (r.exceptionDetails) { console.error('[mix-exception] ' + JSON.stringify(r.exceptionDetails).slice(0, 700)); process.exit(1); }
  for (const e of JSON.parse(r.result.value)) {
    console.log('=== ' + e.model + ' (当前 yaw=' + e.currentYaw + ') ===');
    console.log('  脚趾 L dz=' + (e.toeL?.dz ?? '-') + '  R dz=' + (e.toeR?.dz ?? '-'));
    console.log('  拇指 L dz=' + (e.thumbL?.dz ?? '-') + ' (dx=' + (e.thumbL?.dx ?? '-') + ')  R dz=' + (e.thumbR?.dz ?? '-') + ' (dx=' + (e.thumbR?.dx ?? '-') + ')');
    console.log('  膝前突 L=' + (e.kneeL ?? '-') + '  R=' + (e.kneeR ?? '-'));
    console.log('  颈→头 dz=' + (e.headSeg?.dz ?? '-'));
    const votes = [];
    const add = (name, v) => { if (v != null && Math.abs(v) > 1e-3) votes.push({ name, dir: v > 0 ? '+Z' : '-Z', v }); };
    add('toeL', e.toeL?.dz); add('toeR', e.toeR?.dz);
    add('thumbL', e.thumbL?.dz); add('thumbR', e.thumbR?.dz);
    add('kneeL', e.kneeL); add('kneeR', e.kneeR);
    const plus = votes.filter((v) => v.dir === '+Z').length;
    const minus = votes.length - plus;
    const native = plus > minus ? '+Z' : (minus > plus ? '-Z' : '?');
    const need = native === '+Z' ? 3.14 : native === '-Z' ? 0 : null;
    console.log('  投票: ' + votes.map((v) => v.name + '→' + v.dir).join(' ') + `  ⇒ 原生 ${native} ⇒ 应设 yaw=${need}` +
      (need != null && Math.abs(e.currentYaw - need) > 0.1 ? '  ★与当前不一致' : '  ✓'));
    console.log('');
  }
  process.exit(0);
} catch (e) {
  console.error('[mix] ' + e.message);
  process.exit(1);
}
