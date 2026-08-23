// 诊断：单关逐步打印战斗内部状态，定位模拟器与浏览器行为差异
import * as THREE from 'three';
import { Battle } from '../js/game/battle.js';
import { FxLayer, makePathSampler } from '../js/game/entities.js';
import { buildLevel } from '../js/game/levelgen.js';
import { GRID } from '../js/game/config.js';

const DT = 1 / 30;
function pathData(map) {
  const cw = (cx) => cx - GRID.w / 2 + 0.5;
  const pts = map.waypoints.map(([cx, cz]) => ({ x: cw(cx), z: (cz - GRID.h / 2 + 0.5) }));
  return { pts };
}

const level = buildLevel(0, 0);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
const fx = new FxLayer(scene);
const { pts } = pathData(level.map);
const battle = new Battle({
  scene, level, sampler: makePathSampler(pts), pathCells: new Set(),
  fx, hooks: { camera },
});
battle.speed = 3;

console.log('waves:', level.waves.length, 'wave0 groups:', JSON.stringify(level.waves[0].groups));
console.log('sampler.total:', battle.sampler.total.toFixed(2));

let t = 0;
for (let f = 0; f < 30 * 120 && t < 90; f++) { // 最多90游戏秒
  // 简易自动：有钱就造箭塔
  if (battle.towers.length < 3 && battle.gold > 200) {
    battle.selectedType = 'arrow';
    const mid = battle.sampler.at(battle.sampler.total * 0.4);
    battle.tryPlace(Math.floor(mid.x + GRID.w / 2 + 1), Math.floor(mid.z + GRID.h / 2));
    battle.clearSelection();
  }
  if (battle.state === 'build' || (battle.state === 'intermission' && battle.intermission < 1.5)) battle.startWave();
  battle.update(DT);
  t += DT * battle.speed;

  if (f % (30 * 5) === 0) {
    const es = battle.enemies.filter((e) => e.alive);
    console.log(
      `t=${t.toFixed(0)}s state=${battle.state} im=${battle.intermission} wave=${battle.waveIdx + 1} q=${battle.spawnQueue.length} ` +
      `enemies=${es.length} [${es.slice(0, 3).map((e) => `${e.def.key}@${e.dist.toFixed(1)} hp${e.hp}`).join(', ')}] ` +
      `kills=${battle.kills} leaks=${battle.leaks} gold=${battle.gold} towers=${battle.towers.length}`,
    );
  }
  if (battle.state === 'won' || battle.state === 'lost') break;
}
