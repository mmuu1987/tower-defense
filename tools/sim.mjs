#!/usr/bin/env node
// 纯逻辑平衡模拟器：在 Node 中完整跑战斗（不渲染、无 DOM），快速校准 30 关曲线。
// 用法: node tools/sim.mjs            # 全 30 关矩阵
//       node tools/sim.mjs 1 4        # 单关
import * as THREE from 'three';
import { Battle } from '../js/game/battle.js';
import { FxLayer, makePathSampler } from '../js/game/entities.js';
import { buildLevel } from '../js/game/levelgen.js';
import { GRID } from '../js/game/config.js';

const DT = 1 / 30;          // 模拟步长（原始秒）
const SPEED = 3;            // 与浏览器 auto 模式一致
const MAX_GAME_SECONDS = 600;

// 与 terrain.js 相同的世界坐标换算与路径格子栅格化
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

function autoStep(battle) {
  const n = Math.min(battle.towers.length, PLAN.length - 1);
  // 严格建造优先：先铺满 8 座，造不起下一座时才升级
  if (battle.towers.length < PLAN.length) {
    const key = PLAN[battle.towers.length];
    if (battle.gold >= COSTS[key]) {
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
      battle.clearSelection();
      return;
    }
  }
  const upCand = battle.towers
    .filter((t) => t.canUpgrade())
    .sort((a, b) => a.upgradeCost() - b.upgradeCost())[0];
  if (upCand && (battle.gold >= upCand.upgradeCost() + 20 || battle.gold > 260)) battle.upgradeTower(upCand);
  // 开波
  if (battle.state === 'build' || (battle.state === 'intermission' && battle.intermission < 1.5)) {
    battle.startWave();
  }
}

function simulate(w, l) {
  const level = buildLevel(w, l);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const fx = new FxLayer(scene);
  const { pts, pathCells } = pathData(level.map);
  const battle = new Battle({
    scene, level, sampler: makePathSampler(pts), pathCells, fx,
    hooks: { camera },
  });
  battle.speed = SPEED;

  let t = 0, guard = 0;
  while (battle.state !== 'won' && battle.state !== 'lost' && t < MAX_GAME_SECONDS && guard++ < 60000) {
    autoStep(battle);
    battle.update(DT);
    t += DT * SPEED;
  }
  return {
    w, l,
    result: battle.state === 'won' ? 'WIN' : battle.state === 'lost' ? 'LOSS' : 'TIMEOUT',
    lives: battle.lives,
    kills: battle.kills,
    waves: `${battle.waveIdx + 1}/${level.waves.length}`,
    towers: battle.towers.length,
    goldSpentProxy: battle.towers.reduce((s, x) => s + x.invested, 0),
  };
}

const args = process.argv.slice(2).map(Number);
const rows = [];
if (args.length >= 2 && Number.isFinite(args[0])) {
  rows.push(simulate(args[0], args[1]));
} else {
  for (let w = 0; w < 5; w++) for (let l = 0; l < 10; l++) rows.push(simulate(w, l));
}

console.log('w,l  结果    生命 击杀 波次   塔');
for (const r of rows) {
  console.log(
    `${r.w},${String(r.l).padStart(2)} ${r.result.padEnd(7)} ${String(r.lives).padStart(3)} ` +
    `${String(r.kills).padStart(4)} ${r.waves.padEnd(6)} ${r.towers}`,
  );
}
const wins = rows.filter((r) => r.result === 'WIN').length;
console.log(`\n胜率: ${wins}/${rows.length}`);
process.exit(0);
