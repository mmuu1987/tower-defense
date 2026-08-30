#!/usr/bin/env node
// 步态/骨骼客观体检（无需人眼）：对每个陆行模型采样一整个 walk 周期的真实蒙皮顶点，
//   ① 形变量 deform：顶点相对首帧的平均位移 —— 接近 0 = 动画没生效（T-pose/僵直）★本工具核心价值
//   ② 骨骼旋转量 boneRot：骨骼四元数相对首帧的变化 —— 区分"蒙皮没更新"与"动画本身无旋转"
//   ③ 支撑脚拖拽 stanceDrag：⚠️已废弃，仅供参考——阈值法对不同单位制/绑定姿态极不稳健
//      （实测 soldier 得到 6.48 这类离谱量级，且与解剖学判定矛盾）。
//      朝向判定请用 tools/mixamocheck.mjs（解剖学三重投票，决定性）或 tools/gaitprobe2.mjs（相关性法）。
// 用法: node tools/gaitprobe.mjs
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
if (!exe) { console.error('[gait] no browser'); process.exit(3); }

const PORT = 9359;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-gait-'));
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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('cdp timeout ' + method)); } }, 90000);
  });
  return { ready, call };
}

const EVAL = `(async () => {
  const THREE = await import('three');
  const D = window.__TD_DEBUG;
  let b = null;
  for (let i = 0; i < 250 && !b; i++) { b = D.battle(); if (!b) await new Promise((r) => setTimeout(r, 300)); }
  if (!b) return JSON.stringify({ fatal: String(window.__TD_FATAL || 'no-battle') });
  await new Promise((r) => setTimeout(r, 2200));

  // 陆行模型代表（飞行/morph-only 模型没有支撑脚，另行判定）
  const REP = [
    ['robot', 'grunt'], ['horse', 'runner'], ['soldier', 'healer'], ['xbot', 'splitter'],
    ['fox', 'fox'], ['cesiumman', 'mummy'], ['brainstem', 'dancer'],
    ['bird_parrot', 'flyer'], ['bird_flamingo', 'flamingo'], ['bird_stork', 'stork'],
  ];
  const FRAMES = 28;
  const out = [];

  for (const [model, type] of REP) {
    b.spawnEnemy(type);
    const e = b.enemies[b.enemies.length - 1];
    if (!e) { out.push({ model, err: 'spawn 失败' }); continue; }
    if (!e.mixer) { out.push({ model, err: '无GLB(程序化替身)' }); e.alive = false; e.disposed = true; continue; }
    const g = e.mesh;
    g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); g.updateMatrixWorld(true);

    const walk = e.actions?.walk;
    const clipName = walk?._clip?.name ?? null;
    const dur = walk?._clip?.duration ?? 0;
    const morphOnly = (() => {
      let hasBones = false;
      g.traverse((o) => { if (o.isBone) hasBones = true; });
      return !hasBones;
    })();

    // 采样目标：蒙皮网格顶点（getVertexPosition 与最终渲染一致）
    const skins = [];
    g.traverse((o) => { if (o.isSkinnedMesh && o.geometry?.attributes?.position) skins.push(o); });
    const plainMeshes = [];
    g.traverse((o) => { if (o.isMesh && !o.isSkinnedMesh && o.geometry?.attributes?.position) plainMeshes.push(o); });
    const bones = [];
    g.traverse((o) => { if (o.isBone) bones.push(o); });

    const sampleVerts = () => {
      const pts = [];
      const v = new THREE.Vector3();
      for (const s of skins) {
        s.skeleton?.update?.();
        const pos = s.geometry.attributes.position;
        const step = Math.max(1, Math.floor(pos.count / 160));
        for (let i = 0; i < pos.count; i += step) { s.getVertexPosition(i, v); pts.push([v.x, v.y, v.z]); }
      }
      if (!pts.length) {
        // morph-only：顶点由 GPU 形变，CPU 侧读不到；退化为读 morph 权重向量
        for (const m of plainMeshes) {
          const infl = m.morphTargetInfluences;
          if (infl) for (let i = 0; i < infl.length; i++) pts.push([infl[i], 0, 0]);
        }
      }
      return pts;
    };
    const sampleBones = () => bones.map((bo) => [bo.quaternion.x, bo.quaternion.y, bo.quaternion.z, bo.quaternion.w]);

    // 推进整周期，逐帧采样
    if (walk) { walk.reset(); walk.play(); walk.setEffectiveTimeScale(1); }
    e.mixer.setTime(0);
    g.updateMatrixWorld(true);
    const frames = [];
    const boneFrames = [];
    const dt = (dur > 0 ? dur : 1) / FRAMES;
    for (let f = 0; f < FRAMES; f++) {
      e.mixer.update(dt);
      g.updateMatrixWorld(true);
      frames.push(sampleVerts());
      boneFrames.push(sampleBones());
    }
    e.alive = false; e.disposed = true;

    const n0 = frames[0].length;
    if (!n0) { out.push({ model, err: '无可采样顶点/权重' }); continue; }

    // ① 形变量：各帧相对首帧的平均位移（morph-only 时是权重变化量）
    let deform = 0, cmp = 0;
    for (let f = 1; f < frames.length; f++) {
      const A = frames[0], B = frames[f];
      if (B.length !== n0) continue;
      for (let i = 0; i < n0; i++) {
        deform += Math.hypot(B[i][0] - A[i][0], B[i][1] - A[i][1], B[i][2] - A[i][2]);
        cmp++;
      }
    }
    deform = cmp ? deform / cmp : 0;

    // ② 骨骼旋转量
    let boneRot = 0, bcmp = 0;
    if (boneFrames[0].length) {
      for (let f = 1; f < boneFrames.length; f++) {
        for (let i = 0; i < boneFrames[0].length; i++) {
          const a = boneFrames[0][i], c = boneFrames[f][i];
          const dot = Math.abs(a[0]*c[0] + a[1]*c[1] + a[2]*c[2] + a[3]*c[3]);
          boneRot += Math.acos(Math.min(1, dot)) * 2; // 四元数夹角
          bcmp++;
        }
      }
      boneRot = bcmp ? boneRot / bcmp : 0;
    }

    // ③ 支撑脚拖拽（仅蒙皮模型且非 morph-only）
    let stanceDrag = null, dragSamples = 0;
    if (skins.length && !morphOnly) {
      // 用全周期确定 y 范围与躯干参考（注意：顶点数可达数万，禁用 Math.min(...arr) 会爆栈）
      let yMin = Infinity, yMax = -Infinity;
      for (const fr of frames) for (const p of fr) { if (p[1] < yMin) yMin = p[1]; if (p[1] > yMax) yMax = p[1]; }
      const yR = (yMax - yMin) || 1;
      // 每帧：脚区(最低18%)与躯干区(35%~65%)的 Z 质心
      const series = frames.map((fr) => {
        let fz = 0, fn = 0, bz = 0, bn = 0, fy = 0;
        for (const p of fr) {
          const t = (p[1] - yMin) / yR;
          if (t < 0.18) { fz += p[2]; fy += p[1]; fn++; }
          else if (t > 0.35 && t < 0.65) { bz += p[2]; bn++; }
        }
        return fn && bn ? { fz: fz / fn, fy: fy / fn, bz: bz / bn } : null;
      }).filter(Boolean);
      if (series.length > 6) {
        let fyMin = Infinity, fyMax = -Infinity;
        for (const s of series) { if (s.fy < fyMin) fyMin = s.fy; if (s.fy > fyMax) fyMax = s.fy; }
        const fyR = (fyMax - fyMin) || 1;
        // 触地期：脚高度处于自身最低 35%
        let sum = 0;
        for (let i = 1; i < series.length; i++) {
          const planted = ((series[i].fy - fyMin) / fyR) < 0.35 && ((series[i-1].fy - fyMin) / fyR) < 0.35;
          if (!planted) continue;
          const relPrev = series[i-1].fz - series[i-1].bz;
          const relCur = series[i].fz - series[i].bz;
          let d = relCur - relPrev;
          // 跨步瞬间（另一只脚接管）会出现大跳变，剔除离群
          if (Math.abs(d) > 0.5 * (yR)) continue;
          sum += d; dragSamples++;
        }
        if (dragSamples >= 3) stanceDrag = sum / dragSamples;
      }
    }

    out.push({
      model, type, clip: clipName, dur: +dur.toFixed(3),
      morphOnly, skins: skins.length, bones: bones.length,
      deform: +deform.toFixed(5),
      boneRot: +boneRot.toFixed(5),
      stanceDrag: stanceDrag == null ? null : +stanceDrag.toFixed(5),
      dragSamples,
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
    const v = r.result.value || {};
    if (v.fatal) { console.error('[gait] page fatal:\n' + v.fatal); process.exit(2); }
    if (v.ready) break;
    await sleep(400);
  }
  const r = await call('Runtime.evaluate', { expression: EVAL, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) { console.error('[gait-exception] ' + JSON.stringify(r.exceptionDetails).slice(0, 700)); process.exit(1); }
  const rows = JSON.parse(r.result.value);
  if (rows.fatal) { console.error('[gait] ' + rows.fatal); process.exit(2); }

  console.log('模型            剪辑             时长   骨骼 形变量     骨旋转量  支撑脚拖拽  样本 当前yaw 动画判定      朝向判定');
  const issues = [];
  for (const e of rows) {
    if (e.err) { console.log(`${e.model.padEnd(15)} ✗ ${e.err}`); issues.push({ model: e.model, kind: 'ERR', detail: e.err }); continue; }
    // 动画判定：形变量与骨旋转量都接近 0 → 静止（T-pose）
    const animDead = e.deform < 1e-4 && (e.bones === 0 ? true : e.boneRot < 1e-3);
    const animWeak = !animDead && e.deform < 2e-3;
    const animVerdict = animDead ? '★静止(T-pose)' : (animWeak ? '幅度极小' : 'ok');
    // 朝向判定：⚠️阈值法不可靠，仅作参考显示，不再计入 issues
    let faceVerdict = '-';
    if (e.stanceDrag != null) {
      const native = e.stanceDrag < 0 ? '+Z' : '-Z';
      faceVerdict = `参考:原生${native}(不可信)`;
    }
    if (animDead) issues.push({ model: e.model, kind: 'TPOSE', clip: e.clip });
    console.log(
      `${e.model.padEnd(15)} ${String(e.clip).padEnd(16)} ${String(e.dur).padEnd(6)} ${String(e.bones).padEnd(4)} ` +
      `${String(e.deform).padEnd(11)} ${String(e.boneRot).padEnd(9)} ${String(e.stanceDrag ?? '-').padEnd(11)} ${String(e.dragSamples).padEnd(4)} ` +
      `${String(e.currentYaw).padEnd(7)} ${animVerdict.padEnd(13)} ${faceVerdict}`,
    );
  }
  console.log('');
  if (!issues.length) console.log('未发现问题');
  else for (const i of issues) console.log('★ ' + JSON.stringify(i));
  process.exit(0);
} catch (e) {
  console.error('[gait] ' + e.message);
  process.exit(1);
}
