// 微观探针2：只在“有目标但未对齐”时打印，抓 aim 卡死瞬间
import * as THREE from 'three';
import { Battle } from '../js/game/battle.js';
import { Tower, FxLayer, makePathSampler } from '../js/game/entities.js';
import { buildLevel } from '../js/game/levelgen.js';
import { GRID } from '../js/game/config.js';

const DT = 1 / 30;
const WATCH_N = Number(process.argv[2] ?? 3);

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

const level = buildLevel(0, 4);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
const fx = new FxLayer(scene);
const { pts, pathCells } = pathData(level.map);
const battle = new Battle({ scene, level, sampler: makePathSampler(pts), pathCells, fx, hooks: { camera } });
battle.speed = 3;

const origUpdate = Tower.prototype.update;
let frame = 0, anomalies = 0;
Tower.prototype.update = function (dt, ctx) {
  const idx = battle.towers.indexOf(this) + 1;
  origUpdate.call(this, dt, ctx);
  if (idx === WATCH_N && this.target) {
    const w = Math.atan2(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z);
    let diff = ((w - this.aim + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    if (Math.abs(diff) > 0.55 && anomalies < 25) {
      anomalies++;
      console.log(`f${frame} w=${battle.waveIdx + 1} tgt#${this.target.id} aim=${this.aim.toFixed(5)} want=${w.toFixed(5)} rawDiff/π=${((w - this.aim) / Math.PI).toFixed(3)} wrapErr=${diff.toFixed(4)} cd=${this.cooldown.toFixed(2)} retgt=${this.retarget.toFixed(3)} tpos=(${this.target.pos.x.toFixed(2)},${this.target.pos.z.toFixed(2)}) mypos=(${this.pos.x.toFixed(2)},${this.pos.z.toFixed(2)})`);
    }
  }
  frame++;
};

let t = 0, lastWave = -1;
while (battle.state !== 'won' && battle.state !== 'lost' && t < 600) {
  autoStep(battle);
  battle.update(DT);
  t += DT * battle.speed;
  if (battle.waveIdx > lastWave) { lastWave = battle.waveIdx; console.log(`════ wave ${battle.waveIdx + 1} @t=${t.toFixed(0)}s ════`); }
}
console.log(`final ${battle.state} kills=${battle.kills} anomalies=${anomalies}`);
