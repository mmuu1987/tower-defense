#!/usr/bin/env node
// 朝向判定 v3（决定性几何法，不依赖动画统计）：用具名骨骼的解剖学前向向量
//   ①脚踝→脚趾（最可靠：人形/四足绑定姿态下脚趾一定朝前）
//   ②头/鼻 vs 髋 的 Z 差（辅助）
// 结论：前向 = +Z ⇒ 需 yaw=π；前向 = -Z ⇒ 需 yaw=0
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
const PORT = 9365;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-bone-'));
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
  const REP = [['robot','grunt'],['soldier','healer'],['xbot','splitter'],['fox','fox'],['cesiumman','mummy'],['brainstem','dancer'],['horse','runner']];
  const out = [];
  for (const [model, type] of REP) {
    b.spawnEnemy(type);
    const e = b.enemies[b.enemies.length - 1];
    if (!e?.mesh) { out.push({ model, err: 'spawn 失败' }); continue; }
    const g = e.mesh;
    g.position.set(0,0,0); g.rotation.set(0,0,0);
    // 关键：停在绑定姿态（不播动画），只看解剖结构
    if (e.actions?.walk) e.actions.walk.stop();
    if (e.mixer) { e.mixer.stopAllAction(); e.mixer.setTime(0); }
    g.updateMatrixWorld(true);

    const bones = [];
    g.traverse((o) => { if (o.isBone) bones.push(o); });
    const named = bones.filter((x) => x.name).map((x) => x.name);
    const wp = (o) => { const v = new THREE.Vector3(); o.getWorldPosition(v); return v; };
    const find = (re) => bones.find((x) => x.name && re.test(x.name));

    // ① 脚踝→脚趾
    const pairs = [];
    for (const side of ['Left', 'Right', 'L', 'R']) {
      const toe = find(new RegExp(side + '.*Toe', 'i')) || find(new RegExp('Toe.*' + side, 'i'));
      const foot = find(new RegExp(side + '.*(Foot|Ankle)', 'i')) || find(new RegExp('(Foot|Ankle).*' + side, 'i'));
      if (toe && foot) {
        const a = wp(foot), c = wp(toe);
        pairs.push({ side, foot: foot.name, toe: toe.name, dz: +(c.z - a.z).toFixed(4), dy: +(c.y - a.y).toFixed(4), len: +a.distanceTo(c).toFixed(4) });
      }
    }
    // 通用兜底：任何含 toe 的骨骼与其父骨骼
    if (!pairs.length) {
      for (const bo of bones) {
        if (bo.name && /toe/i.test(bo.name) && bo.parent?.isBone) {
          const a = wp(bo.parent), c = wp(bo);
          pairs.push({ side: 'auto', foot: bo.parent.name || '(空)', toe: bo.name, dz: +(c.z - a.z).toFixed(4), dy: +(c.y - a.y).toFixed(4), len: +a.distanceTo(c).toFixed(4) });
        }
      }
    }

    // ② 头 vs 髋
    const head = find(/head|skull|neck/i);
    const hips = find(/hips|pelvis|root|torso/i);
    let headDz = null;
    if (head && hips) headDz = +(wp(head).z - wp(hips).z).toFixed(4);

    e.alive = false; e.disposed = true;
    out.push({
      model, type,
      boneCount: bones.length, namedCount: named.length,
      toePairs: pairs,
      headBone: head?.name ?? null, hipsBone: hips?.name ?? null, headDz,
      currentYaw: +(e.def.model.yaw ?? 0).toFixed(2),
      boneSample: named.slice(0, 5),
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
  if (r.exceptionDetails) { console.error('[bone-exception] ' + JSON.stringify(r.exceptionDetails).slice(0, 700)); process.exit(1); }
  const rows = JSON.parse(r.result.value);
  const bad = [];
  for (const e of rows) {
    console.log('=== ' + e.model + ' (' + e.type + ') 骨骼 ' + e.boneCount + '（具名 ' + e.namedCount + '）当前 yaw=' + e.currentYaw);
    if (e.err) { console.log('  ✗ ' + e.err); continue; }
    if (!e.toePairs.length) console.log('  脚趾骨: 无（骨骼样例: ' + e.boneSample.join(', ') + '）');
    for (const p of e.toePairs) console.log(`  脚趾向量 ${p.side}: ${p.foot} → ${p.toe}  dz=${p.dz} dy=${p.dy} 长度=${p.len}`);
    if (e.headDz != null) console.log(`  头(${e.headBone}) - 髋(${e.hipsBone}) dz=${e.headDz}`);
    // 判定：脚趾 dz 主导
    const dzs = e.toePairs.map((p) => p.dz).filter((v) => Math.abs(v) > 1e-4);
    if (dzs.length) {
      const mean = dzs.reduce((a, b2) => a + b2, 0) / dzs.length;
      const consistent = dzs.every((v) => Math.sign(v) === Math.sign(mean));
      const native = mean > 0 ? '+Z' : '-Z';
      const need = native === '+Z' ? 3.14 : 0;
      const mismatch = Math.abs(e.currentYaw - need) > 0.1;
      console.log(`  → 脚趾均值 dz=${mean.toFixed(4)} 左右一致=${consistent} ⇒ 原生前向 ${native} ⇒ 应设 yaw=${need} ${mismatch ? '★与当前不一致' : '✓一致'}`);
      if (mismatch && consistent) bad.push({ model: e.model, need, cur: e.currentYaw, evidence: 'toe dz=' + mean.toFixed(4) });
    } else {
      console.log('  → 无脚趾骨信号，需其它方法');
    }
    console.log('');
  }
  console.log(bad.length ? '★ 决定性判定需修正: ' + JSON.stringify(bad) : '★ 有脚趾信号的模型全部一致');
  process.exit(0);
} catch (e) {
  console.error('[bone] ' + e.message);
  process.exit(1);
}
