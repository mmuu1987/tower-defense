import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MAPS, mapForLevel } from '../js/game/maps.js';
import { createMapLayout } from '../js/game/map-layout.js';
import { makePathSampler, Tower } from '../js/game/entities.js';
import { Battle } from '../js/game/battle.js';
import { buildLevel } from '../js/game/levelgen.js';
import { GRID, MAP_AREA_SCALE, cellToWorldX, cellToWorldZ } from '../js/game/config.js';
import { enemyProfile } from '../js/game/enemy-stats.js';

function battleFor(w = 0, l = 3) {
  const level = buildLevel(w, l), layout = createMapLayout(level.map);
  const samplers = layout.routes.map(makePathSampler);
  const battle = new Battle({ scene: new THREE.Scene(), level, ...layout,
    sampler: samplers[0], samplers, fx: { update() {}, burst() {} },
    hooks: { camera: new THREE.PerspectiveCamera() } });
  return { battle, layout };
}

test('all fifty battlefields have unique authored routes and stable seeds', () => {
  assert.deepEqual(GRID, { w: 42, h: 28, cell: 1 });
  assert.ok(MAP_AREA_SCALE >= 3 && MAP_AREA_SCALE <= 4);
  assert.equal(MAPS.length, 50);
  assert.equal(new Set(MAPS.map((m) => m.id)).size, 50);
  assert.equal(new Set(MAPS.map((m) => JSON.stringify(m.waypoints))).size, 50);
  assert.equal(MAPS.filter((m) => m.routes.length === 2).length, 20);
  for (const map of MAPS) {
    assert.equal(mapForLevel(map.worldIdx, map.lvlIdx), map);
    const a = createMapLayout(map), b = createMapLayout(map);
    assert.deepEqual(a.routes, b.routes);
    assert.deepEqual(a.landmarks, b.landmarks);
    assert.deepEqual(a.blockedCells, b.blockedCells);
  }
});

for (const map of MAPS) test(map.id + ': lanes, bridges, terrain and tower space remain consistent', () => {
  const layout = createMapLayout(map);
  const unavailable = new Set([...layout.pathCells, ...layout.blockedCells]);
  assert.ok(GRID.w * GRID.h - unavailable.size >= 450, 'expanded battlefield has at least 450 buildable cells');
  assert.ok(layout.landmarks.length >= 8, 'landmark density grows with the map');
  const allPoints = layout.routes.flat();
  assert.ok(Math.min(...allPoints.map((p) => p.x)) < -GRID.w * 0.3);
  assert.ok(Math.max(...allPoints.map((p) => p.x)) > GRID.w * 0.25);
  assert.ok(Math.min(...allPoints.map((p) => p.z)) < -GRID.h * 0.25);
  assert.ok(Math.max(...allPoints.map((p) => p.z)) > GRID.h * 0.25);
  const lengths = [];
  for (const [routeIndex, points] of layout.routes.entries()) {
    const sampler = makePathSampler(points);
    lengths.push(sampler.total);
    assert.ok(sampler.total >= 70 && sampler.total <= 125);
    const start = sampler.at(0), end = sampler.at(sampler.total);
    const raw = map.routes[routeIndex];
    assert.ok(start.distanceTo(new THREE.Vector3(cellToWorldX(raw[0][0]), 0, cellToWorldZ(raw[0][1]))) < 1e-6);
    assert.ok(end.distanceTo(new THREE.Vector3(cellToWorldX(raw.at(-1)[0]), 0, cellToWorldZ(raw.at(-1)[1]))) < 1e-6);
    assert.deepEqual(sampler.at(sampler.total + 1), end);
    assert.deepEqual(sampler.at(-1), start);
    for (let d = 0; d <= sampler.total; d += 0.13) {
      const p = sampler.at(d), tangent = sampler.tangentAt(d);
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
      assert.ok(Math.abs(tangent.length() - 1) < 1e-5);
      const cx = Math.floor(p.x + GRID.w / 2), cz = Math.floor(p.z + GRID.h / 2);
      assert.ok(cx >= 0 && cx < GRID.w && cz >= 0 && cz < GRID.h, 'route stays inside the map');
      assert.ok(layout.pathCells.has(cx + ',' + cz), 'every marching cell forbids construction');
      if (layout.waterDistance(p.x, p.z) > 0.9) assert.ok(layout.heightAt(p.x, p.z) < 0.001, 'road stays level');
    }
  }
  if (lengths.length === 2) assert.ok(Math.max(...lengths) / Math.min(...lengths) < 1.2, 'no unfair shortcut');
  for (let cx = 0; cx < GRID.w; cx++) for (let cz = 0; cz < GRID.h; cz++) {
    const x = cellToWorldX(cx), z = cellToWorldZ(cz);
    if (layout.waterDistance(x, z) < 0.6) assert.ok(unavailable.has(cx + ',' + cz), 'riverbanks cannot hold towers');
  }
});

test('wave spawns use both lanes without changing group counts', () => {
  const { battle } = battleFor();
  battle.startWave();
  assert.equal(battle.spawnQueue.length, battle.level.waves[0].groups.reduce((s, g) => s + g.count, 0));
  const routes = [...new Set(battle.spawnQueue.map((e) => e.ticket.route))].sort((a, b) => a - b);
  assert.deepEqual(routes, [0, 1]);
  battle.destroy();
});

test('splitters and boss death summons inherit the parent route and position', () => {
  for (const type of ['splitter', 'lava', 'sand', 'graveyard']) {
    const { battle } = battleFor();
    const profile = enemyProfile(type, { enemyLevel: 1 });
    const ticket = { groupId: 'test:0', unit: 0, bounty: 0, route: 1 };
    const parent = battle.spawnEnemy(profile, ticket);
    assert.ok(parent, 'valid enemy ' + type);
    parent.dist = 18;
    parent.sampler.at(parent.dist, parent.pos);
    battle.kill(parent);
    const children = battle.enemies.filter((e) => e !== parent);
    assert.ok(children.length > 0);
    for (const child of children) {
      assert.equal(child.sampler, parent.sampler);
      assert.ok(child.pos.distanceTo(child.sampler.at(child.dist)) < 1e-8);
      assert.ok(child.pos.distanceTo(parent.pos) < 4);
    }
    battle.destroy();
  }
});

test('leaks use the individual lane length, not the primary lane length', () => {
  const { battle } = battleFor();
  battle.waveIdx = 0;
  battle.state = 'combat';
  const profile = enemyProfile('grunt', { enemyLevel: 1 });
  const ticket = { groupId: 'test:0', unit: 0, bounty: 0, route: 1 };
  const enemy = battle.spawnEnemy(profile, ticket);
  enemy.dist = enemy.sampler.total - 0.001;
  const lives = battle.lives;
  battle.update(0.02);
  assert.equal(battle.lives, lives - 1);
  assert.equal(battle.leaks, 1);
  assert.equal(battle.enemies.length, 0);
  battle.destroy();
});

test('tower priority is remaining distance to the exit across lanes', () => {
  const tower = new Tower('arrow', 10, 7);
  const a = { alive: true, def: {}, pos: tower.pos.clone(), sampler: { total: 50 }, dist: 40 };
  const b = { alive: true, def: {}, pos: tower.pos.clone(), sampler: { total: 40 }, dist: 35 };
  assert.equal(tower.acquire([a, b]), b);
  tower.dispose(new THREE.Scene());
});

test('construction rejects blocked terrain and towers sit on the ground', () => {
  const { battle, layout } = battleFor(0, 0);
  battle.selectBuild('arrow');
  const gold = battle.gold;
  for (const key of new Set([...layout.blockedCells, ...layout.pathCells])) {
    const [x, z] = key.split(',').map(Number);
    assert.equal(battle.tryPlace(x, z), 'blocked');
  }
  assert.equal(battle.gold, gold);
  let placed = false;
  for (let x = 0; x < GRID.w && !placed; x++) for (let z = 0; z < GRID.h && !placed; z++) {
    if (!battle.isBuildable(x, z)) continue;
    assert.equal(battle.tryPlace(x, z), true);
    const tower = battle.towers[0];
    assert.equal(tower.pos.y, layout.heightAt(tower.pos.x, tower.pos.z));
    assert.equal(battle.isBuildable(x, z), false);
    battle.sellSelected();
    assert.equal(battle.isBuildable(x, z), true);
    placed = true;
  }
  assert.ok(placed);
  battle.destroy();
});

test('path sampler ignores duplicate points and rejects zero-length routes', () => {
  const sampler = makePathSampler([{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 3, z: 4 }]);
  assert.equal(sampler.total, 5);
  assert.deepEqual(sampler.at(5), new THREE.Vector3(3, 0, 4));
  assert.throws(() => makePathSampler([{ x: 0, z: 0 }, { x: 0, z: 0 }]));
});
