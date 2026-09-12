#!/usr/bin/env node
// 纯逻辑平衡模拟器：在 Node 中完整跑战斗（不渲染、无 DOM），快速校准 50 关曲线。
// 用法: node tools/sim.mjs            # 全 50 关矩阵
//       node tools/sim.mjs 1 4        # 单关
//       node tools/sim.mjs 1 8 --g2 --branch=B --seconds=900
import * as THREE from 'three';
import { Battle } from '../js/game/battle.js';
import { FxLayer, makePathSampler } from '../js/game/entities.js';
import { buildLevel } from '../js/game/levelgen.js';
import { GRID } from '../js/game/config.js';
import { createMapLayout } from '../js/game/map-layout.js';

const DT = 1 / 30;          // 模拟步长（原始秒）
const SPEED = 3;            // 与浏览器 auto 模式一致
const MAX_GAME_SECONDS = Number(/--seconds=(\d+)/.exec(process.argv.join(' '))?.[1]) || 600;

// 与 terrain.js 相同的世界坐标换算与路径格子栅格化

const G2 = process.argv.includes('--g2');
const BRANCH = process.argv.includes('--branch=B') ? 'B' : 'A';
const PLAN = G2
  ? ['arrow', 'frost', 'venom', 'cannon', 'arrow', 'beacon', 'sniper', 'tesla']
  : ['arrow', 'frost', 'arrow', 'cannon', 'arrow', 'tesla', 'sniper', 'arrow'];

function autoStep(battle) {
  // 严格建造优先：先铺满 8 座，造不起下一座时才升级
  if (battle.towers.length < PLAN.length) {
    const planned = PLAN[battle.towers.length];
    const key = battle.isTowerUnlocked(planned) ? planned : 'arrow';
    if (battle.gold >= battle.costOf(key)) {
      const sampler = G2 ? battle.samplers[battle.towers.length % battle.samplers.length] : battle.sampler;
      const mid = key === 'beacon' ? battle.towers[2].pos
        : sampler.at(sampler.total * (0.22 + 0.07 * battle.towers.length));
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
  if (upCand && (battle.gold >= upCand.upgradeCost() + 20 || battle.gold > 260)) battle.upgradeTower(upCand, upCand.requiresSpecialization() ? BRANCH : null);
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
  const layout = createMapLayout(level.map);
  const samplers = layout.routes.map(makePathSampler);
  const battle = new Battle({
    scene, level, ...layout, sampler: samplers[0], samplers, fx,
    hooks: { camera },
  });
  battle.speed = SPEED;

  let t = 0, guard = 0;
  while (battle.state !== 'won' && battle.state !== 'lost' && t < MAX_GAME_SECONDS && guard++ < 60000) {
    autoStep(battle);
    battle.update(DT);
    t += DT * SPEED;
  }
  const result = {
    w, l,
    result: battle.state === 'won' ? 'WIN' : battle.state === 'lost' ? 'LOSS' : 'TIMEOUT',
    lives: battle.lives,
    kills: battle.kills,
    waves: `${battle.waveIdx + 1}/${level.waves.length}`,
    towers: battle.towers.length,
    goldSpentProxy: battle.towers.reduce((s, x) => s + x.invested, 0),
    composition: battle.towers.map((tower) => tower.key + ':' + (tower.level + 1) + (tower.specialization || '')).join(' '),
    skillCasts: battle.towers.reduce((total, tower) => total + tower.skillCasts.signature + tower.skillCasts.ultimate, 0),
    simulatedSeconds: Math.round(battle.time),
    activeEnemies: battle.enemies.filter((e) => e.alive).length,
    pendingSpawns: battle.spawnQueue.length,
  };
  battle.destroy();
  return result;
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
  if (G2) console.log('  ' + r.composition + ' | casts=' + r.skillCasts);
  if (r.result === 'TIMEOUT') console.log('  time=' + r.simulatedSeconds + ' enemies=' + r.activeEnemies + ' pending=' + r.pendingSpawns);
}
const wins = rows.filter((r) => r.result === 'WIN').length;
console.log(`\n胜率: ${wins}/${rows.length}`);
process.exit(0);
