#!/usr/bin/env node
// 步态朝向判定 v2（双足分离 + 相关性法，比阈值法稳健）：
//   摆动腿抬高时向前迈、支撑腿落地时向后蹬 → 对每只脚单独计算「脚高度」与「脚 Z 速度」的相关性。
//   相关性 > 0 ⇒ 抬起的脚朝 +Z 迈 ⇒ 模型原生前进方向 = +Z ⇒ 需 yaw=π（公式基础值 ±π）。
// 已在 robot/soldier/xbot/fox 四个人工校准过的模型上验证方法有效性（4/4 吻合）。
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
const PORT = 9363;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-gait2-'));
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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout ' + method)); } }, 90000);
  });
  return { ready, call };
}

const EVAL = `(async () => {
  const THREE = await import('three');
  const D = window.__TD_DEBUG;
  let b = null;
  for (let i = 0; i < 250 && !b; i++) { b = D.battle(); if (!b) await new Promise((r) => setTimeout(r, 300)); }
  await new Promise((r) => setTimeout(r, 2200));
  const REP = [['robot','grunt'],['soldier','healer'],['xbot','splitter'],['fox','fox'],['cesiumman','mummy'],['brainstem','dancer']];
  const FRAMES = 48;
  const out = [];
  for (const [model, type] of REP) {
    b.spawnEnemy(type);
    const e = b.enemies[b.enemies.length - 1];
    if (!e?.mixer) { out.push({ model, err: 'no mixer' }); if (e) { e.alive = false; e.disposed = true; } continue; }
    const g = e.mesh;
    g.position.set(0,0,0); g.rotation.set(0,0,0); g.updateMatrixWorld(true);
    const walk = e.actions?.walk;
    const dur = walk?._clip?.duration ?? 1;
    const skins = [];
    g.traverse((o) => { if (o.isSkinnedMesh && o.geometry?.attributes?.position) skins.push(o); });
    if (!skins.length) { out.push({ model, err: 'morph-only(无蒙皮)' }); e.alive=false; e.disposed=true; continue; }

    if (walk) { walk.reset(); walk.play(); walk.setEffectiveTimeScale(1); }
    e.mixer.setTime(0);
    // 只取一个步态周期（fox 的 Walk 0.708s / soldier 1.03s 等）
    const dt = dur / FRAMES;
    const frames = [];
    const v = new THREE.Vector3();
    for (let f = 0; f < FRAMES; f++) {
      e.mixer.update(dt);
      g.updateMatrixWorld(true);
      const pts = [];
      for (const s of skins) {
        s.skeleton?.update?.();
        const pos = s.geometry.attributes.position;
        const step = Math.max(1, Math.floor(pos.count / 240));
        for (let i = 0; i < pos.count; i += step) { s.getVertexPosition(i, v); pts.push([v.x, v.y, v.z]); }
      }
      frames.push(pts);
    }
    e.alive = false; e.disposed = true;

    // 全周期 y/x 范围
    let yMin = Infinity, yMax = -Infinity, xSum = 0, xN = 0;
    for (const fr of frames) for (const p of fr) {
      if (p[1] < yMin) yMin = p[1];
      if (p[1] > yMax) yMax = p[1];
      xSum += p[0]; xN++;
    }
    const yR = (yMax - yMin) || 1;
    const xMid = xSum / (xN || 1);

    // 每帧：左右脚（最低 20% 高度区按 x 分侧）与躯干（35%~65%）的 z/y
    const series = frames.map((fr) => {
      let lz=0, ly=0, ln=0, rz=0, ry=0, rn=0, bz=0, bn=0;
      for (const p of fr) {
        const t = (p[1] - yMin) / yR;
        if (t < 0.20) {
          if (p[0] < xMid) { lz += p[2]; ly += p[1]; ln++; } else { rz += p[2]; ry += p[1]; rn++; }
        } else if (t > 0.35 && t < 0.65) { bz += p[2]; bn++; }
      }
      return { L: ln ? { z: lz/ln, y: ly/ln } : null, R: rn ? { z: rz/rn, y: ry/rn } : null, bz: bn ? bz/bn : null };
    });

    // 相关性：脚高度(去均值) × 脚相对躯干 Z 的速度
    const corrFor = (side) => {
      const rows = [];
      for (let i = 1; i < series.length; i++) {
        const a = series[i-1], c = series[i];
        if (!a[side] || !c[side] || a.bz == null || c.bz == null) continue;
        const relPrev = a[side].z - a.bz;
        const relCur  = c[side].z - c.bz;
        rows.push({ y: (a[side].y + c[side].y) / 2, dz: relCur - relPrev });
      }
      if (rows.length < 8) return null;
      const mY = rows.reduce((s, r) => s + r.y, 0) / rows.length;
      const mD = rows.reduce((s, r) => s + r.dz, 0) / rows.length;
      let num = 0, dy = 0, dd = 0;
      for (const r of rows) {
        const a = r.y - mY, c = r.dz - mD;
        num += a * c; dy += a * a; dd += c * c;
      }
      const denom = Math.sqrt(dy * dd);
      return denom > 0 ? +(num / denom).toFixed(3) : null;
    };
    const cL = corrFor('L'), cR = corrFor('R');
    const avg = (cL != null && cR != null) ? (cL + cR) / 2 : (cL ?? cR);
    out.push({
      model, type, dur: +dur.toFixed(3), frames: FRAMES,
      corrL: cL, corrR: cR, corrAvg: avg == null ? null : +avg.toFixed(3),
      currentYaw: +(e.def.model.yaw ?? 0).toFixed(2),
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
  if (r.exceptionDetails) { console.error('[gait2-exception] ' + JSON.stringify(r.exceptionDetails).slice(0, 700)); process.exit(1); }
  const rows = JSON.parse(r.result.value);
  console.log('模型            周期   左脚相关 右脚相关 均值    原生朝向  应设yaw  当前yaw  判定');
  const bad = [];
  for (const e of rows) {
    if (e.err) { console.log(`${e.model.padEnd(15)} ✗ ${e.err}`); continue; }
    if (e.corrAvg == null) { console.log(`${e.model.padEnd(15)} 数据不足`); continue; }
    const native = e.corrAvg > 0 ? '+Z' : '-Z';
    const need = native === '+Z' ? 3.14 : 0;
    const mismatch = Math.abs(e.currentYaw - need) > 0.1;
    const weak = Math.abs(e.corrAvg) < 0.15;
    if (mismatch && !weak) bad.push({ model: e.model, need, cur: e.currentYaw, corr: e.corrAvg });
    console.log(
      `${e.model.padEnd(15)} ${String(e.dur).padEnd(6)} ${String(e.corrL ?? '-').padEnd(8)} ${String(e.corrR ?? '-').padEnd(8)} ` +
      `${String(e.corrAvg).padEnd(7)} ${native.padEnd(9)} ${String(need).padEnd(8)} ${String(e.currentYaw).padEnd(8)} ` +
      `${weak ? '信号弱(需人工)' : (mismatch ? '★倒着走' : 'ok')}`,
    );
  }
  console.log('');
  console.log(bad.length ? '★ 需修正: ' + JSON.stringify(bad) : '未发现倒走（强信号模型全部一致）');
  process.exit(0);
} catch (e) {
  console.error('[gait2] ' + e.message);
  process.exit(1);
}
