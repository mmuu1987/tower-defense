// 诊断探针：逐波统计每座塔的 fireCount / cooldown / target / aligned，
// 定位“打一两波后塔不攻击（有寻敌动作）”问题在纯逻辑层是否复现。
import * as THREE from 'three';
import { Battle } from '../js/game/battle.js';
import { FxLayer, makePathSampler } from '../js/game/entities.js';
import { buildLevel } from '../js/game/levelgen.js';
import { GRID } from '../js/game/config.js';

const DT = 1 / 30;
const [W = 0, L = 4] = process.argv.slice(2).map(Number);

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
  const upCand = battle.towers.filter((t) => t.canUpgrade()).sort((a, b) => a.upgradeCost() - b.upgradeCost())[0];
  if (upCand && (battle.gold >= upCand.upgradeCost() + 20 || battle.gold > 260)) battle.upgradeTower(upCand);
  if (battle.state === 'build' || (battle.state === 'intermission' && battle.intermission < 1.5)) battle.startWave();
}

// 拦截异常但不中断：记录每帧异常来源（模拟浏览器无 try/catch 时帧内断点行为）
let errCount = 0;
console.error = (() => { const orig = console.error; return (...a) => { orig('[captured]', ...a); }; })();

const level = buildLevel(W, L);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
const fx = new FxLayer(scene);
const { pts, pathCells } = pathData(level.map);
const battle = new Battle({ scene, level, sampler: makePathSampler(pts), pathCells, fx, hooks: { camera } });
battle.speed = 3;

console.log(`level ${W},${L} waves=${level.waves.length} sampler.total=${battle.sampler.total.toFixed(1)}`);

let t = 0, lastWave = -1, guard = 0;
while (battle.state !== 'won' && battle.state !== 'lost' && t < 600 && guard++ < 90000) {
  try {
    autoStep(battle);
    battle.update(DT);
  } catch (err) {
    if (errCount++ < 3) console.log(`[EXCEPTION @t=${t.toFixed(1)} wave=${battle.waveIdx + 1}]`, err.stack?.split('\n').slice(0, 4).join(' | '));
    else if (errCount === 3) console.log('[EXCEPTION] ...(后续同类不再打印)');
  }
  t += DT * battle.speed;

  // 新一波开始时打印上一波结束时的塔状态
  if (battle.waveIdx > lastWave) {
    lastWave = battle.waveIdx;
    const rows = battle.towers.map((tw) => {
      const s = tw.stats;
      return `${s.kind ?? '?'}#${tw.id} f=${tw.fireCount ?? 0} cd=${tw.cooldown.toFixed(2)} tgt=${tw.target ? (tw.target.alive ? 'Y' : 'dead') : 'null'} retgt=${tw.retarget.toFixed(2)}`;
    });
    console.log(`── wave ${battle.waveIdx + 1} start @t=${t.toFixed(0)}s gold=${battle.gold}`);
    if (rows.length) console.log('   ' + rows.join('\n   '));
  }
}

console.log(`\nfinal: state=${battle.state} t=${t.toFixed(0)}s kills=${battle.kills} leaks=${battle.leaks} lives=${battle.lives}`);
for (const tw of battle.towers) {
  console.log(`  ${tw.key}#${tw.id} lvl${tw.level} kind(stats)=${tw.stats.kind} def.kind=${tw.def.kind} fireCount=${tw.fireCount ?? 0} projList=${battle.projectiles.list.length}`);
}
