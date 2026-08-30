#!/usr/bin/env node
// 模型原生朝向客观判定（无需人眼）：解析绑定姿态顶点云，用三路几何信号推断模型面向 +Z 还是 -Z
//   ①脚尖信号（双足）：最低 12% 高度区的 Z 质心 vs 躯干 Z 质心——脚尖朝前
//   ②窄端信号（四足/鸟）：Z 两端各取 12% 切片比较 X 宽度——口鼻/喙端更窄
//   ③头部信号：最高 20% 高度区的 Z 质心 vs 躯干——头在前方
// 结论换算：native +Z → 需要 yaw=π；native -Z → 需要 yaw=0
//   （公式 rotation.y = atan2(-tan.x,-tan.z) + yaw，切线+Z 时基础值为 ±π）
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
if (!exe) { console.error('[facing] no browser'); process.exit(3); }

const PORT = 9357;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-face-'));
const child = spawn(exe, [
  '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${PORT}`,
  '--window-size=1000,700', '--hide-scrollbars', URL_TARGET,
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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('cdp timeout ' + method)); } }, 40000);
  });
  return { ready, call };
}

const EVAL = `(async () => {
  const THREE = await import('three');
  const D = window.__TD_DEBUG;
  let b = null;
  for (let i = 0; i < 250 && !b; i++) { b = D.battle(); if (!b) await new Promise((r) => setTimeout(r, 300)); }
  if (!b) return JSON.stringify({ fatal: String(window.__TD_FATAL || 'no-battle') });
  await new Promise((r) => setTimeout(r, 2200)); // 模型预载

  // 每个模型取一个代表敌人类型
  const REP = {
    robot: 'grunt', horse: 'runner', bird_parrot: 'flyer', soldier: 'healer', xbot: 'splitter',
    fox: 'fox', bird_flamingo: 'flamingo', cesiumman: 'mummy', bird_stork: 'stork', brainstem: 'dancer',
  };
  const out = [];
  for (const [model, type] of Object.entries(REP)) {
    b.spawnEnemy(type);
    const e = b.enemies[b.enemies.length - 1];
    if (!e || !e.mixer) { out.push({ model, err: '无GLB实例' }); if (e) { e.alive = false; e.disposed = true; } continue; }
    const g = e.mesh;
    // 归零变换：只看模型原生朝向
    g.position.set(0, 0, 0); g.rotation.set(0, 0, 0);
    g.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    const pts = [];
    g.traverse((m) => {
      if (!m.isMesh || !m.geometry?.attributes?.position) return;
      const pos = m.geometry.attributes.position;
      const mw = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
      const step = Math.max(1, Math.floor(pos.count / 1200));
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mw);
        pts.push([v.x, v.y, v.z]);
      }
    });
    e.alive = false; e.disposed = true;
    if (pts.length < 50) { out.push({ model, err: '顶点不足 ' + pts.length }); continue; }

    const ys = pts.map((p) => p[1]);
    const zs = pts.map((p) => p[2]);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const zMin = Math.min(...zs), zMax = Math.max(...zs);
    const yR = yMax - yMin || 1, zR = zMax - zMin || 1;
    const mean = (arr, f) => arr.reduce((a, p) => a + f(p), 0) / (arr.length || 1);

    // 躯干参考：高度 35%~65% 区间
    const body = pts.filter((p) => { const t = (p[1] - yMin) / yR; return t > 0.35 && t < 0.65; });
    const zBody = body.length ? mean(body, (p) => p[2]) : mean(pts, (p) => p[2]);

    // ① 脚尖信号：最低 12%
    const feet = pts.filter((p) => (p[1] - yMin) / yR < 0.12);
    const zFeet = feet.length ? mean(feet, (p) => p[2]) : null;

    // ③ 头部信号：最高 20%
    const head = pts.filter((p) => (p[1] - yMin) / yR > 0.80);
    const zHead = head.length ? mean(head, (p) => p[2]) : null;

    // ② 窄端信号：Z 两端 12% 切片的 X 宽度
    const nearMax = pts.filter((p) => (zMax - p[2]) / zR < 0.12);
    const nearMin = pts.filter((p) => (p[2] - zMin) / zR < 0.12);
    const width = (arr) => { if (!arr.length) return null; const xs = arr.map((p) => p[0]); return Math.max(...xs) - Math.min(...xs); };
    const wMax = width(nearMax), wMin = width(nearMin);

    out.push({
      model, type,
      bbox: { y: [+yMin.toFixed(2), +yMax.toFixed(2)], z: [+zMin.toFixed(2), +zMax.toFixed(2)] },
      zBody: +zBody.toFixed(3),
      zFeet: zFeet == null ? null : +zFeet.toFixed(3),
      zHead: zHead == null ? null : +zHead.toFixed(3),
      feetSignal: zFeet == null ? null : +(zFeet - zBody).toFixed(3),   // >0 → 脚尖朝 +Z
      headSignal: zHead == null ? null : +(zHead - zBody).toFixed(3),   // >0 → 头朝 +Z
      widthPlusZ: wMax == null ? null : +wMax.toFixed(3),               // +Z 端宽度
      widthMinusZ: wMin == null ? null : +wMin.toFixed(3),              // -Z 端宽度
      narrowEnd: (wMax != null && wMin != null) ? (wMax < wMin ? '+Z' : '-Z') : null,
      currentYaw: +(e.def.model.yaw ?? 0).toFixed(2),
      verts: pts.length,
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
    const v = r.result.value || {};
    if (v.fatal) { console.error('[facing] page fatal:\n' + v.fatal); process.exit(2); }
    if (v.ready) break;
    await sleep(400);
  }
  const r = await call('Runtime.evaluate', { expression: EVAL, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) { console.error('[facing-exception] ' + JSON.stringify(r.exceptionDetails).slice(0, 600)); process.exit(1); }
  const rows = JSON.parse(r.result.value);

  console.log('模型            顶点  脚尖信号  头部信号  窄端  +Z宽/-Z宽        当前yaw  几何判定  应设yaw');
  const verdicts = [];
  for (const e of rows) {
    if (e.err) { console.log(`${e.model.padEnd(15)} ✗ ${e.err}`); continue; }
    // 综合判定：脚尖信号权重最高（双足绑定姿态脚尖朝前），窄端信号次之（四足/鸟口鼻在前）
    const votes = [];
    if (e.feetSignal != null && Math.abs(e.feetSignal) > 0.02) votes.push({ dir: e.feetSignal > 0 ? '+Z' : '-Z', w: 2, src: '脚尖' });
    if (e.narrowEnd && e.widthPlusZ != null && Math.abs(e.widthPlusZ - e.widthMinusZ) > 0.05) {
      votes.push({ dir: e.narrowEnd, w: 1.5, src: '窄端' });
    }
    if (e.headSignal != null && Math.abs(e.headSignal) > 0.03) votes.push({ dir: e.headSignal > 0 ? '+Z' : '-Z', w: 1, src: '头部' });
    let plus = 0, minus = 0;
    for (const v of votes) (v.dir === '+Z' ? plus += v.w : minus += v.w);
    const native = plus === minus ? '?' : (plus > minus ? '+Z' : '-Z');
    const shouldYaw = native === '+Z' ? 3.14 : native === '-Z' ? 0 : null;
    const mismatch = shouldYaw != null && Math.abs(e.currentYaw - shouldYaw) > 0.1;
    verdicts.push({ model: e.model, type: e.type, native, shouldYaw, currentYaw: e.currentYaw, mismatch, votes });
    console.log(
      `${e.model.padEnd(15)} ${String(e.verts).padEnd(5)} ${String(e.feetSignal ?? '-').padEnd(9)} ${String(e.headSignal ?? '-').padEnd(9)} ` +
      `${String(e.narrowEnd ?? '-').padEnd(5)} ${(e.widthPlusZ + '/' + e.widthMinusZ).padEnd(16)} ${String(e.currentYaw).padEnd(8)} ` +
      `${native.padEnd(9)} ${shouldYaw ?? '?'}${mismatch ? '  ★不一致' : ''}`,
    );
  }
  console.log('\n投票明细:');
  for (const v of verdicts) console.log(`  ${v.model.padEnd(15)} ${v.votes.map((x) => x.src + '→' + x.dir + '(w' + x.w + ')').join(' ')}`);
  const bad = verdicts.filter((v) => v.mismatch);
  console.log(bad.length ? `\n★ 朝向配置与几何不一致: ${bad.map((v) => `${v.model}(应${v.shouldYaw})`).join(', ')}` : '\n全部朝向配置与几何一致');
  process.exit(0);
} catch (e) {
  console.error('[facing] ' + e.message);
  process.exit(1);
}
