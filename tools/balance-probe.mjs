#!/usr/bin/env node
// 逐波平衡探针：复用 sim.mjs 的机器人策略，统计每一关"漏怪发生在第几波"，
// 用于定位难度曲线倒挂（开局漏怪、中后期全歼）。
// 用法: node tools/balance-probe.mjs                 # 全 40 关（当前 BALANCE 值）
//       node tools/balance-probe.mjs 0 3             # 单关详细
//       node tools/balance-probe.mjs --hp=0.06 --rw=0.03 --gold=240
//         （运行时覆盖 BALANCE 参数做扫描，不改源码）
import * as THREE from 'three';
import { Battle } from '../js/game/battle.js';
import { FxLayer, makePathSampler } from '../js/game/entities.js';
import { buildLevel, BALANCE } from '../js/game/levelgen.js';
import { TOWER_DEFS } from '../js/game/towers.js';
import { GRID } from '../js/game/config.js';

// —— CLI 参数覆盖（短名 → BALANCE 键 / buildLevel 覆盖映射）——
const ARG_ALIAS = {
  hp: 'waveHpRamp', rw: 'waveRewardRamp', gold: 'startGoldBase',
  cnt: 'earlyCountRamp', gap: 'earlyGapBonus',
  hpramp: 'waveHpRamp', rwramp: 'waveRewardRamp',
  surplus: 'waveSurplusBase', halfD: 'waveSurplusHalfD', rwfrac: 'waveRewardFraction',
};
const overrides = {};      // BALANCE 键覆盖
const rampOverrides = {};  // buildLevel(w,l,ov) 覆盖（waveHpRamp / waveRewardRamp）
for (const a of process.argv.slice(2)) {
  const m = /^--(\w+)=(.+)$/.exec(a);
  if (m) {
    const key = ARG_ALIAS[m[1]] ?? m[1];
    const v = Number(m[2]);
    if (!Number.isFinite(v)) continue;
    if (key === 'waveHpRamp' || key === 'waveRewardRamp') rampOverrides[key] = v;
    else if (key in BALANCE) overrides[key] = v;
  }
}
const applyOverrides = () => {
  for (const [k, v] of Object.entries(overrides)) BALANCE[k] = v;
};
applyOverrides();
const ovrDesc = [
  ...Object.entries(overrides).map(([k, v]) => `${k}=${v}`),
  ...Object.entries(rampOverrides).map(([k, v]) => `${k}=${v}`),
];
if (ovrDesc.length) console.error(`[probe] overrides: ${ovrDesc.join(' ')}`);

const DT = 1 / 30;
const SPEED = 3;
const MAX_GAME_SECONDS = 600;

function pathData(map) {
  const cw = (cx) => cx - GRID.w / 2 + 0.5;
  const pts = map.waypoints.map(([cx, cz]) => ({ x: cw(cx), z: (cz - GRID.h / 2 + 0.5) }));
  const pathCells = new Set();
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.22);
    for (let s = 0; s <= steps; s++) {
      const x = a.x + (b.x - a.x) * (s / steps);
      const z = a.z + (b.z - a.z) * (s / steps);
      pathCells.add(`${Math.floor(x + GRID.w / 2)},${Math.floor(z + GRID.h / 2)}`);
    }
  }
  return { pts, pathCells };
}

const COSTS = { arrow: 70, cannon: 110, frost: 90, tesla: 130, sniper: 150 };
const PLAN = ['arrow', 'frost', 'arrow', 'cannon', 'arrow', 'tesla', 'sniper', 'arrow'];
const SMART = process.argv.includes('--smart');
// --rush：休整一开始就全奖提前开战（测提前开战经济的最坏情况通胀）
const RUSH = process.argv.includes('--rush');
// --stack=0.75：已覆盖路径样本的折价权重（1=完全允许堆叠卡口，0.45=强烈偏好铺开）
const STACK = (() => {
  const m = /--stack=([\d.]+)/.exec(process.argv.join(' '));
  return m ? Number(m[1]) : 0.45;
})();

// —— 智能机器人：贪心覆盖选址（模拟人类"沿路布阵、优先卡双覆盖拐角"）——
function makePathSamples(sampler, step = 0.3) {
  const out = [];
  for (let d = 0; d <= sampler.total; d += step) out.push(sampler.at(d, new THREE.Vector3()));
  return out;
}
function smartCell(battle, key, pathSamples) {
  const range = TOWER_DEFS[key].range;
  const covered = new Set(); // 已有塔覆盖的路径样本下标
  for (const t of battle.towers) {
    pathSamples.forEach((s, i) => {
      if ((s.x - t.pos.x) ** 2 + (s.z - t.pos.z) ** 2 <= t.stats.range ** 2) covered.add(i);
    });
  }
  let best = null, bestScore = -1;
  for (let cx = 0; cx < GRID.w; cx++) {
    for (let cz = 0; cz < GRID.h; cz++) {
      if (!battle.isBuildable(cx, cz)) continue;
      const wx = cx - GRID.w / 2 + 0.5, wz = cz - GRID.h / 2 + 0.5;
      let score = 0;
      for (let i = 0; i < pathSamples.length; i++) {
        const s = pathSamples[i];
        if ((s.x - wx) ** 2 + (s.z - wz) ** 2 > range * range) continue;
        score += covered.has(i) ? STACK : 1;   // 冗余覆盖折价：低=铺开，高=堆叠卡口
      }
      if (score > bestScore) { bestScore = score; best = [cx, cz]; }
    }
  }
  return best;
}

function autoStep(battle, pathSamples) {
  if (battle.towers.length < PLAN.length) {
    const key = PLAN[battle.towers.length];
    if (battle.gold >= COSTS[key]) {
      let placed = false;
      if (SMART && pathSamples) {
        const cell = smartCell(battle, key, pathSamples);
        if (cell) {
          battle.selectedType = key;
          placed = battle.tryPlace(cell[0], cell[1]) === true;
        }
      } else {
        const mid = battle.sampler.at(battle.sampler.total * (0.22 + 0.07 * battle.towers.length));
        outer:
        for (let r = 1; r <= 4; r++) {
          for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
            const cx = Math.floor(mid.x + GRID.w / 2 + dx);
            const cz = Math.floor(mid.z + GRID.h / 2 + dz);
            if (battle.isBuildable(cx, cz)) {
              battle.selectedType = key;
              if (battle.tryPlace(cx, cz) === true) break outer;
            }
          }
        }
        placed = true;
      }
      battle.clearSelection();
      if (placed) return;
    }
  }
  const upCand = battle.towers
    .filter((t) => t.canUpgrade())
    .sort((a, b) => a.upgradeCost() - b.upgradeCost())[0];
  if (upCand && (battle.gold >= upCand.upgradeCost() + 20 || battle.gold > 260)) battle.upgradeTower(upCand);
  // 开波：build 开战；休整期 rush=立刻提前开战（全奖），否则等倒计时尾段
  if (battle.state === 'build') {
    battle.startWave();
  } else if (battle.state === 'intermission' && (RUSH || battle.intermission < 1.5)) {
    if (RUSH) battle.callWaveEarly();
    else battle.startWave();
  }
}

function simulate(w, l) {
  const level = buildLevel(w, l, rampOverrides);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const fx = new FxLayer(scene);
  const { pts, pathCells } = pathData(level.map);

  const leakByWave = [];   // 该关每波漏怪数（1-based 波号 → leaks）
  let lastLeaks = 0;
  let lastWave = 0;
  const hooks = {
    camera,
    onLeak: () => { leakByWave[lastWave] = (leakByWave[lastWave] || 0) + 1; },
    onWave: (idx) => { lastWave = idx; },
  };

  const battle = new Battle({ scene, level, sampler: makePathSampler(pts), pathCells, fx, hooks });
  battle.speed = SPEED;
  const pathSamples = SMART ? makePathSamples(battle.sampler) : null;

  let t = 0, guard = 0;
  while (battle.state !== 'won' && battle.state !== 'lost' && t < MAX_GAME_SECONDS && guard++ < 60000) {
    autoStep(battle, pathSamples);
    battle.update(DT);
    t += DT * SPEED;
  }
  return {
    w, l,
    result: battle.state === 'won' ? 'WIN' : battle.state === 'lost' ? 'LOSS' : 'TIMEOUT',
    lives: battle.lives,
    leaks: battle.leaks,
    wavesReached: battle.waveIdx + 1,
    totalWaves: level.waves.length,
    leakByWave,
    startGold: level.startGold,
  };
}

const args = process.argv.slice(2).map(Number);
const verbose = args.length >= 2 && Number.isFinite(args[0]);
const rows = [];
if (verbose) {
  rows.push(simulate(args[0], args[1]));
} else {
  for (let w = 0; w < 4; w++) for (let l = 0; l < 10; l++) rows.push(simulate(w, l));
}

// —— 汇总：漏怪按"波序位置比例"分桶（每关波数不同，取 waveIdx/totalWaves）——
const buckets = Array.from({ length: 10 }, () => 0);   // 0~0.1, 0.1~0.2, ... 0.9~1.0
const bucketLevels = Array.from({ length: 10 }, () => new Set());
for (const r of rows) {
  if (r.result !== 'WIN') continue;                 // 只统计通关局（对应人类玩家体验）
  r.leakByWave.forEach((n, wi) => {
    if (!n) return;
    const frac = Math.min(0.99, wi / r.totalWaves);
    const b = Math.floor(frac * 10);
    buckets[b] += n;
    bucketLevels[b].add(`${r.w}-${r.l}`);
  });
}

console.log('=== 漏怪分布（仅统计通关局，按波次进度分桶）===');
buckets.forEach((n, i) => {
  const bar = '#'.repeat(Math.min(60, n));
  console.log(`${(i * 10).toString().padStart(3)}%~${((i + 1) * 10).toString().padStart(3)}%  ${String(n).padStart(4)} 只  ${bar}  [${bucketLevels[i].size}关]`);
});

const winRows = rows.filter((r) => r.result === 'WIN');
const noLeak = winRows.filter((r) => r.leaks === 0).length;
const fewLeaks = winRows.filter((r) => r.leaks > 0 && r.leaks <= 2).length;
const livesSorted = winRows.map((r) => r.lives).sort((a, b) => a - b);
const med = livesSorted.length ? livesSorted[Math.floor(livesSorted.length / 2)] : '-';
console.log(`\n通关 ${winRows.length}/${rows.length}；其中满血(0漏) ${noLeak} 关、漏1-2只 ${fewLeaks} 关；通关局剩余生命中位数 ${med}`);
console.log(`参数: bot=${SMART ? 'smart' : 'base'}${RUSH ? '+rush' : ''} stack=${STACK} surplus=${BALANCE.waveSurplusBase} halfD=${BALANCE.waveSurplusHalfD} rwFrac=${BALANCE.waveRewardFraction} gold=${BALANCE.startGoldBase} earlyCnt=${BALANCE.earlyCountRamp} earlyGap=${BALANCE.earlyGapBonus}${rampOverrides.waveHpRamp != null ? ` [硬覆盖 hp=${rampOverrides.waveHpRamp} rw=${rampOverrides.waveRewardRamp}]` : ''}`);

if (verbose) {
  const r = rows[0];
  console.log(`\n第${r.w + 1}世界第${r.l + 1}关详细：`);
  r.leakByWave.forEach((n, wi) => console.log(`  第${wi}波: 漏 ${n || 0} 只`));
} else if (process.argv.includes('--rows')) {
  console.log('\n=== 逐关明细（W=通关 L=败 | 每波漏怪数）===');
  for (const r of rows) {
    const lb = r.leakByWave.map((n, wi) => (wi > 0 ? `${wi}:${n || 0}` : '')).filter(Boolean).join(' ');
    console.log(`${r.w},${String(r.l).padStart(2)} ${r.result === 'WIN' ? 'W' : 'L'} 生命${String(r.lives).padStart(3)} 波${r.wavesReached}/${r.totalWaves} 漏怪[${lb}]`);
  }
}
process.exit(0);
