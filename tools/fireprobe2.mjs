// 增强诊断探针：逐帧统计每塔 有目标率/就绪未开火率/角度误差/离路距离，
// 区分“建塔位置够不着路径”vs“瞄准对齐卡死”vs“索敌失败”三类停射原因。
import * as THREE from 'three';
import { Battle } from '../js/game/battle.js';
import { Tower } from '../js/game/entities.js';
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

// 沿路径密集采样点（用于算塔到路径的最近距离）
function densePathPoints(sampler, n = 1200) {
  const arr = [];
  for (let i = 0; i <= n; i++) arr.push(sampler.at((sampler.total * i) / n));
  return arr;
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

const level = buildLevel(W, L);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
const fx = new FxLayer(scene);
const { pts, pathCells } = pathData(level.map);
const battle = new Battle({ scene, level, sampler: makePathSampler(pts), pathCells, fx, hooks: { camera } });
battle.speed = 3;
const pathPts = densePathPoints(battle.sampler);

// 每塔统计容器
const statOf = new Map();
function statFor(t) {
  let s = statOf.get(t);
  if (!s) {
    // 离路最近距离
    let dmin = Infinity;
    for (const p of pathPts) dmin = Math.min(dmin, Math.hypot(p.x - t.pos.x, p.z - t.pos.z));
    s = { dmin, frames: 0, withTgt: 0, readyNoFire: 0, alignedReady: 0, errSum: 0, errMax: 0, nanAim: 0, fires: 0 };
    statOf.set(t, s);
  }
  return s;
}

// 包一层 Tower.update 做逐帧采样
const origUpdate = Tower.prototype.update;
Tower.prototype.update = function (dt, ctx) {
  origUpdate.call(this, dt, ctx);
  const s = statFor(this);
  s.frames++;
  const tgt = this.target;
  if (!tgt) return;
  s.withTgt++;
  if (!Number.isFinite(this.aim)) s.nanAim++;
  const want = Math.atan2(tgt.pos.x - this.pos.x, tgt.pos.z - this.pos.z);
  let diff = ((want - this.aim + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  const err = Math.abs(diff);
  s.errSum += err; s.errMax = Math.max(s.errMax, err);
  const ready = this.cooldown <= 0;
  const aligned = err < 0.5 || this.stats.kind === 'pulse';
  if (ready && !aligned) s.readyNoFire++;       // 就绪却因未对齐不开火（含寻敌中）
  if (ready && aligned) s.alignedReady++;
};

let t = 0, lastWave = -1, waveOpenStat = null;
while (battle.state !== 'won' && battle.state !== 'lost' && t < 600) {
  autoStep(battle);
  battle.update(DT);
  t += DT * battle.speed;

  if (battle.waveIdx > lastWave) {
    lastWave = battle.waveIdx;
    console.log(`── wave ${battle.waveIdx + 1} open @t=${t.toFixed(0)}s`);
    for (const tw of battle.towers) {
      const s = statFor(tw);
      console.log(
        `   ${tw.key}#${tw.id} kind=${tw.stats.kind} dmin=${s.dmin.toFixed(2)} rng=${tw.stats.range.toFixed(1)} ` +
        `f=${tw.fireCount ?? 0} tgt%=${s.frames ? ((s.withTgt / s.frames) * 100).toFixed(0) : '-'} ` +
        `errAvg=${s.withTgt ? (s.errSum / s.withTgt).toFixed(2) : '-'} errMax=${s.withTgt ? s.errMax.toFixed(2) : '-'} ` +
        `readyNoFire=${s.readyNoFire} alignedReady=${s.alignedReady} nanAim=${s.nanAim}`,
      );
      // 重置窗口：只看上一波区间的行为
      s.frames = 0; s.withTgt = 0; s.readyNoFire = 0; s.alignedReady = 0; s.errSum = 0; s.errMax = 0; s.nanAim = 0;
    }
  }
}

console.log(`\nfinal: state=${battle.state} t=${t.toFixed(0)}s kills=${battle.kills} leaks=${battle.leaks} lives=${battle.lives}`);
for (const tw of battle.towers) {
  const s = statFor(tw);
  console.log(`  ${tw.key}#${tw.id} lvl${tw.level} dmin=${s.dmin.toFixed(2)} fireCount=${tw.fireCount ?? 0}`);
}
