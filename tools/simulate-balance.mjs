// Deterministic 50-level balance regression using the real campaign economy.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { Battle } from '../js/game/battle.js';
import { buildLevel } from '../js/game/levelgen.js';
import { createMapLayout } from '../js/game/map-layout.js';
import { makePathSampler } from '../js/game/entities.js';
import { GRID } from '../js/game/config.js';
import { TOWER_KEYS, towerCost } from '../js/game/towers.js';

const fx = Object.fromEntries(
  ['update', 'flash', 'ring', 'spark', 'burst', 'lightning', 'beam', 'decal', 'shockwave'].map((key) => [key, () => {}]),
);
const BUILD_ORDER = ['arrow', 'frost', 'cannon', 'tesla', 'sniper', 'venom', 'beacon'];
const MAX_TOWERS = 7;

function seededRandom(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function placementCells(battle, layout, seed) {
  const random = seededRandom(seed);
  return Array.from({ length: GRID.w * GRID.h }, (_, index) => {
    const cx = index % GRID.w, cz = Math.floor(index / GRID.w);
    const point = battle.cellCenter(cx, cz);
    return {
      cx,
      cz,
      score: Math.abs(layout.distToPath(point.x, point.z) - 1.45) + Math.abs(point.x) * 0.002 + random() * 0.08,
    };
  }).filter(({ cx, cz }) => battle.isBuildable(cx, cz))
    .sort((a, b) => a.score - b.score || a.cx - b.cx || a.cz - b.cz);
}

// A deterministic competent-player fixture: obey unlocks and actual gold,
// keep a seven-tower cap, place near the road, then buy cheapest upgrades.
function autoInvest(battle, cells, seed) {
  const unlocked = BUILD_ORDER.filter((key) => battle.isTowerUnlocked(key));
  const desired = [...unlocked];
  for (let i = 0; desired.length < MAX_TOWERS; i++) desired.push(unlocked[i % unlocked.length]);

  const wantedByKey = new Map();
  for (const key of desired) {
    const wanted = (wantedByKey.get(key) || 0) + 1;
    wantedByKey.set(key, wanted);
    if (battle.towers.filter((tower) => tower.key === key).length >= wanted) continue;
    if (battle.gold < towerCost(key)) return;
    let cell = cells.find(({ cx, cz }) => battle.isBuildable(cx, cz) && battle.towers.every((tower) =>
      battle.cellCenter(cx, cz).distanceToSquared(tower.pos) >= 4));
    cell ||= cells.find(({ cx, cz }) => battle.isBuildable(cx, cz));
    assert.ok(cell, `no buildable cell for ${key}`);
    assert.equal(battle.selectBuild(key), true);
    assert.equal(battle.tryPlace(cell.cx, cell.cz), true);
  }

  while (true) {
    const candidate = battle.towers.filter((tower) => tower.canUpgrade() && tower.upgradeCost() <= battle.gold)
      .sort((a, b) => a.upgradeCost() - b.upgradeCost() || a.level - b.level || a.id - b.id)[0];
    if (!candidate) break;
    const index = battle.towers.indexOf(candidate);
    const branch = ((seed + index) & 1) ? 'A' : 'B';
    assert.equal(battle.upgradeTower(candidate, candidate.requiresSpecialization() ? branch : null), true,
      `cannot upgrade ${candidate.key} to Lv.${candidate.level + 2}`);
  }

  for (const key of TOWER_KEYS) {
    if (!unlocked.includes(key)) {
      assert.equal(battle.towers.some((tower) => tower.key === key), false, `locked tower ${key} was placed`);
    }
  }
}

async function runLevel(worldIdx, lvlIdx) {
  const level = buildLevel(worldIdx, lvlIdx);
  const layout = createMapLayout(level.map);
  const samplers = layout.routes.map(makePathSampler);
  const stats = { towers: {}, waves: 0, win: false, time: 0 };
  const battle = new Battle({
    scene: new THREE.Scene(),
    level,
    sampler: samplers[0],
    samplers,
    pathCells: layout.pathCells,
    blockedCells: layout.blockedCells,
    heightAt: layout.heightAt,
    fx,
    random: seededRandom(level.map.seed ^ 0x9e3779b9),
    hooks: { camera: new THREE.PerspectiveCamera() },
  });

  for (const key of TOWER_KEYS) stats.towers[key] = { sig: 0, ult: 0, sigDmg: 0, ultDmg: 0, casts: 0 };
  const skillDamage = {};
  const originalHit = battle.hitEnemy.bind(battle);
  battle.hitEnemy = (enemy, damage, opts) => {
    const result = originalHit(enemy, damage, opts);
    if (opts?.sourceTowerId && opts?.skillTier) {
      const tower = battle.towers.find((candidate) => candidate.id === opts.sourceTowerId);
      if (tower) {
        const key = tower.key + ':' + opts.skillTier;
        skillDamage[key] = (skillDamage[key] || 0) + (result?.totalDamage || 0);
      }
    }
    return result;
  };
  battle.hooks.onSkill = (tower, tier) => {
    const data = stats.towers[tower.key];
    if (tier === 'signature') data.sig++;
    else data.ult++;
    data.casts++;
  };

  const cells = placementCells(battle, layout, level.map.seed);
  let nextInvestment = 0;
  while (battle.state !== 'won' && battle.state !== 'lost' && battle.time < 1800) {
    if (battle.state === 'intermission') battle.callWaveEarly();
    if (battle.state === 'build' || battle.time >= nextInvestment) {
      autoInvest(battle, cells, level.map.seed);
      nextInvestment = battle.time + 1;
    }
    if (battle.state === 'build') battle.startWave();
    battle.update(0.05);
  }

  stats.win = battle.state === 'won';
  stats.waves = battle.waveIdx + 1;
  stats.time = battle.time;
  stats.kills = battle.kills;
  stats.leaks = battle.leaks;
  stats.startGold = level.startGold;
  stats.finalGold = battle.gold;
  stats.invested = battle.towers.reduce((sum, tower) => sum + tower.invested, 0);
  for (const [key, damage] of Object.entries(skillDamage)) {
    const [towerKey, tier] = key.split(':');
    if (tier === 'signature') stats.towers[towerKey].sigDmg = damage;
    else stats.towers[towerKey].ultDmg = damage;
  }
  battle.destroy();
  return stats;
}

async function runAll() {
  const results = [];
  for (let world = 0; world < 5; world++) {
    for (let level = 0; level < 10; level++) {
      process.stdout.write(`\r运行关卡 ${world * 10 + level + 1}/50: W${world + 1}-${level + 1} `);
      results.push({ world: world + 1, level: level + 1, ...await runLevel(world, level) });
    }
  }

  const summary = { total: 50, wins: 0, losses: 0, byTower: {} };
  for (const result of results) {
    if (result.win) summary.wins++;
    else summary.losses++;
    for (const [key, data] of Object.entries(result.towers)) {
      summary.byTower[key] ||= { sig: 0, ult: 0, sigDmg: 0, ultDmg: 0, total: 0, levels: 0 };
      summary.byTower[key].sig += data.sig;
      summary.byTower[key].ult += data.ult;
      summary.byTower[key].sigDmg += data.sigDmg;
      summary.byTower[key].ultDmg += data.ultDmg;
      summary.byTower[key].total += data.casts;
      summary.byTower[key].levels++;
    }
  }

  assert.equal(results.some((result) => result.time >= 1800), false, 'a balance simulation timed out');
  assert.ok(results.slice(0, 30).every((result) => result.win),
    'the fixed real-economy strategy must clear every early and mid-campaign level');
  assert.ok(summary.wins >= 40, `competent real-economy strategy wins too few levels: ${summary.wins}/50`);
  const late = results.slice(30);
  assert.ok(late.some((result) => result.leaks > 0 || !result.win),
    'late campaign is too weak: the fixed real-economy strategy perfect-cleared every level');

  console.log(`\n\n胜率: ${summary.wins}/50；失败: ${summary.losses}`);
  for (const [key, data] of Object.entries(summary.byTower)) {
    console.log(`${key.padEnd(8)} 招牌 ${(data.sig / data.levels).toFixed(1)}/关，终极 ${(data.ult / data.levels).toFixed(1)}/关`);
  }
  return { results, summary };
}

runAll().then((data) => {
  const report = JSON.stringify(data, null, 2);
  writeFileSync(new URL('./balance-report.json', import.meta.url), report);
  writeFileSync(new URL('../balance-report.json', import.meta.url), report);
  console.log('数据已保存到 balance-report.json 与 tools/balance-report.json');
}).catch((error) => {
  console.error('模拟失败:', error);
  process.exit(1);
});
