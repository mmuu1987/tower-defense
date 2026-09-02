#!/usr/bin/env node
// 经济与压力量化探针：跑全 50 关，报告「金币富余」「塔是否封顶」「后期漏怪」三项硬指标
// 用于验证用户反馈：①中后期无压力 ②金钱大量剩余
// 用法: node tools/econprobe.mjs [--smart] [--rows]
import * as THREE from 'three';
import { Battle } from '../js/game/battle.js';
import { FxLayer, makePathSampler } from '../js/game/entities.js';
import { buildLevel, BALANCE } from '../js/game/levelgen.js';
import { TOWER_DEFS } from '../js/game/towers.js';
import { GRID } from '../js/game/config.js';

const ARG_ALIAS = {
  hp: 'hpBase', lateK: 'hpLateK', late: 'hpLateK', latePow: 'hpLatePow', lateFrom: 'hpLateFrom',
  gold: 'startGoldBase', perWorld: 'startGoldPerWorld',
  wbBase: 'waveBonusBase', wbPer: 'waveBonusPerWave',
  rw: 'rewardBase', rwLate: 'rewardLateK',
  cntLateK: 'countLateK', speedCap: 'speedCap',
};
const overrides = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([\w]+)=(.+)$/.exec(a);
  if (m) {
    const key = ARG_ALIAS[m[1]] ?? m[1];
    const v = Number(m[2]);
    if (Number.isFinite(v) && key in BALANCE) overrides[key] = v;
  }
}
for (const [k, v] of Object.entries(overrides)) BALANCE[k] = v;
if (Object.keys(overrides).length) console.error('[econ] overrides: ' + JSON.stringify(overrides));

const SMART = process.argv.includes('--smart');
const ROWS = process.argv.includes('--rows');
const DT = 1 / 30, SPEED = 3, MAX_SEC = 900;

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
// 更贴近人类的阵容循环：主力箭塔+狙击，辅以炮/冰/电
const PLAN = ['arrow', 'frost', 'arrow', 'cannon', 'tesla', 'sniper', 'arrow', 'sniper', 'tesla', 'arrow', 'cannon', 'frost'];
// 塔位上限：人类有钱就会继续铺塔（地图 330 格去掉路径仍很宽裕），
// 固定 12 座会让富余金币无处可去，从而低估玩家火力、高估"钱花不完"
const MAX_TOWERS = Number((/--maxTowers=(\d+)/.exec(process.argv.join(' ')) || [])[1] || 26);

function makeSamples(sampler, step = 0.3) {
  const out = [];
  for (let d = 0; d <= sampler.total; d += step) out.push(sampler.at(d, new THREE.Vector3()));
  return out;
}
function smartCell(battle, key, samples) {
  const range = TOWER_DEFS[key].range;
  const covered = new Set();
  for (const t of battle.towers) {
    samples.forEach((s, i) => {
      if ((s.x - t.pos.x) ** 2 + (s.z - t.pos.z) ** 2 <= t.stats.range ** 2) covered.add(i);
    });
  }
  let best = null, bestScore = -1;
  for (let cx = 0; cx < GRID.w; cx++) for (let cz = 0; cz < GRID.h; cz++) {
    if (!battle.isBuildable(cx, cz)) continue;
    const wx = cx - GRID.w / 2 + 0.5, wz = cz - GRID.h / 2 + 0.5;
    let score = 0;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      if ((s.x - wx) ** 2 + (s.z - wz) ** 2 > range * range) continue;
      score += covered.has(i) ? 0.6 : 1;
    }
    if (score > bestScore) { bestScore = score; best = [cx, cz]; }
  }
  return best;
}

function simulate(w, l) {
  const level = buildLevel(w, l);
  const scene = new THREE.Scene();
  const fx = new FxLayer(scene);
  const { pts, pathCells } = pathData(level.map);

  let income = 0;      // 所有进账（初始金不计）
  const hooks = {
    camera: new THREE.PerspectiveCamera(),
    onGold: () => {},
  };
  const battle = new Battle({ scene, level, sampler: makePathSampler(pts), pathCells, fx, hooks });
  battle.speed = SPEED;
  const samples = SMART ? makeSamples(battle.sampler) : null;

  let prevGold = battle.gold;
  let peakGold = battle.gold;
  let spent = 0;
  let allMaxedAtWave = null;

  let t = 0, guard = 0;
  while (battle.state !== 'won' && battle.state !== 'lost' && t < MAX_SEC && guard++ < 90000) {
    // —— 机器人：升级优先于铺新塔（人类同样偏好，且钱多时两者都做）——
    const upCand = battle.towers.filter((x) => x.canUpgrade()).sort((a, b) => a.upgradeCost() - b.upgradeCost())[0];
    if (upCand && battle.gold >= upCand.upgradeCost()) {
      battle.upgradeTower(upCand);
    } else if (battle.towers.length < MAX_TOWERS) {
      const key = PLAN[battle.towers.length % PLAN.length];
      if (battle.gold >= COSTS[key]) {
        if (SMART) {
          const c = smartCell(battle, key, samples);
          if (c) { battle.selectedType = key; battle.tryPlace(c[0], c[1]); }
        } else {
          const mid = battle.sampler.at(battle.sampler.total * (0.10 + 0.032 * battle.towers.length) % battle.sampler.total);
          outer:
          for (let r = 1; r <= 5; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
            const cx = Math.floor(mid.x + GRID.w / 2 + dx), cz = Math.floor(mid.z + GRID.h / 2 + dz);
            if (battle.isBuildable(cx, cz)) {
              battle.selectedType = key;
              if (battle.tryPlace(cx, cz) === true) break outer;
            }
          }
        }
        battle.clearSelection();
      }
    } else if (!upCand && allMaxedAtWave == null) {
      allMaxedAtWave = battle.waveIdx + 1;
    }
    if (battle.state === 'build' || (battle.state === 'intermission' && battle.intermission < 1.5)) battle.startWave();

    battle.update(DT);
    t += DT * SPEED;
    // 记账：金币上升=进账，下降=支出
    const g = battle.gold;
    if (g > prevGold) income += g - prevGold;
    else if (g < prevGold) spent += prevGold - g;
    prevGold = g;
    if (g > peakGold) peakGold = g;
  }

  const invested = battle.towers.reduce((s, x) => s + x.invested, 0);
  const maxedCount = battle.towers.filter((x) => !x.canUpgrade()).length;
  return {
    w, l, d: w * 10 + l,
    result: battle.state === 'won' ? 'WIN' : battle.state === 'lost' ? 'LOSS' : 'TIMEOUT',
    lives: battle.lives, leaks: battle.leaks,
    waves: `${battle.waveIdx + 1}/${level.waves.length}`,
    towers: battle.towers.length, maxed: maxedCount,
    startGold: level.startGold,
    endGold: battle.gold, peakGold, income, spent, invested,
    allMaxedAtWave,
    hpMul: +level.hpMul.toFixed(2),
  };
}

const rows = [];
for (let w = 0; w < 5; w++) for (let l = 0; l < 10; l++) rows.push(simulate(w, l));

if (ROWS) {
  console.log('关卡  结果  生命 漏怪 波次    塔/满级  HP倍率 开局金 结束金 峰值金 进账  支出  封顶波');
  for (const r of rows) {
    console.log(
      `${r.w + 1}-${String(r.l + 1).padEnd(2)} ${r.result.padEnd(5)} ${String(r.lives).padStart(3)} ${String(r.leaks).padStart(4)} ` +
      `${r.waves.padEnd(7)} ${(r.towers + '/' + r.maxed).padEnd(8)} ${String(r.hpMul).padEnd(6)} ` +
      `${String(r.startGold).padStart(5)} ${String(r.endGold).padStart(6)} ${String(r.peakGold).padStart(6)} ` +
      `${String(r.income).padStart(5)} ${String(r.spent).padStart(5)} ${String(r.allMaxedAtWave ?? '-').padStart(5)}`,
    );
  }
  console.log('');
}

const wins = rows.filter((r) => r.result === 'WIN');
const seg = (name, list) => {
  if (!list.length) return;
  const w = list.filter((r) => r.result === 'WIN');
  const avgEnd = Math.round(list.reduce((s, r) => s + r.endGold, 0) / list.length);
  const avgPeak = Math.round(list.reduce((s, r) => s + r.peakGold, 0) / list.length);
  const avgLives = (list.reduce((s, r) => s + Math.max(0, r.lives), 0) / list.length).toFixed(1);
  const maxedFull = list.filter((r) => r.allMaxedAtWave != null).length;
  const surplusRatio = (list.reduce((s, r) => s + r.endGold / Math.max(1, r.income + r.startGold), 0) / list.length * 100).toFixed(0);
  console.log(
    `${name.padEnd(12)} 胜 ${String(w.length).padStart(2)}/${String(list.length).padEnd(2)}  ` +
    `均剩生命 ${avgLives.padStart(5)}  均剩金 ${String(avgEnd).padStart(5)}  峰值金 ${String(avgPeak).padStart(5)}  ` +
    `剩金/总收入 ${surplusRatio.padStart(3)}%  全塔封顶 ${maxedFull}/${list.length}`,
  );
};
console.log('=== 分段汇总（关键：剩金比例越高=钱越花不完；均剩生命越高=越无压力）===');
seg('世界1 (d0-9)', rows.filter((r) => r.w === 0));
seg('世界2 (d10-19)', rows.filter((r) => r.w === 1));
seg('世界3 (d20-29)', rows.filter((r) => r.w === 2));
seg('世界4 (d30-39)', rows.filter((r) => r.w === 3));
seg('世界5 (d40-49)', rows.filter((r) => r.w === 4));
console.log('');
seg('全部', rows);
console.log(`\n参数: bot=${SMART ? 'smart' : 'base'} 塔位上限=${MAX_TOWERS} hpBase=${BALANCE.hpBase} hpLateK=${BALANCE.hpLateK} ` +
  `hpLateFrom=${BALANCE.hpLateFrom} rewardLateK=${BALANCE.rewardLateK} gold=${BALANCE.startGoldBase}+${BALANCE.startGoldPerWorld}/world ` +
  `waveBonus=${BALANCE.waveBonusBase}+${BALANCE.waveBonusPerWave}/wave`);
process.exit(0);
