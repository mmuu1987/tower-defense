import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SpatialIndex } from '../js/game/spatial-index.js';
import { compareScores, estimatedExitTime, resolveDamage, targetMatches } from '../js/game/combat.js';
import { Battle } from '../js/game/battle.js';
import { Enemy, Tower, makePathSampler } from '../js/game/entities.js';
import { TOWER_DEFS, towerCost } from '../js/game/towers.js';
import { buildLevel } from '../js/game/levelgen.js';
import { createMapLayout } from '../js/game/map-layout.js';
import { enemyProfile } from '../js/game/enemy-stats.js';
import { formatDamage } from '../js/ui/floaters.js';

function fakeEnemy({ id, x = 0, z = 0, total = 40, dist = 0, speed = 1, fly = false, alive = true, hp = 100, shield = 0, def = {} } = {}) {
  return {
    id, alive, hp, shield, pos: new THREE.Vector3(x, 0, z),
    sampler: { total }, dist, baseSpeed: speed, effectiveSpeed: speed,
    def: { fly, ...def },
  };
}

test('damage floaters display positive damage as whole numbers', () => {
  assert.equal(formatDamage(17.49), '17');
  assert.equal(formatDamage(17.5), '18');
  assert.equal(formatDamage(0.25), '1');
  assert.equal(formatDamage(0), null);
  assert.equal(formatDamage(NaN), null);
});

test('spatial index inserts, moves, filters and removes', () => {
  const index = new SpatialIndex(4);
  const near = fakeEnemy({ id: 1, x: 1, z: 1 });
  const moved = fakeEnemy({ id: 2, x: 7, z: 0 });
  const far = fakeEnemy({ id: 3, x: 20, z: 0 });
  index.insert(near); index.insert(moved); index.insert(far);
  assert.equal(index.size, 3);
  assert.deepEqual(index.queryRadius(0, 0, 3).map((e) => e.id), [1]);
  moved.pos.set(2, 0, 0); index.update(moved);
  assert.deepEqual(index.queryRadius(0, 0, 3).map((e) => e.id).sort(), [1, 2]);
  assert.deepEqual(index.queryRadius(0, 0, 3, (e) => e.id === 2).map((e) => e.id), [2]);
  assert.equal(index.remove(near), true);
  assert.equal(index.remove(near), false);
  assert.equal(index.size, 2);
});

test('target masks separate air and ground enemies', () => {
  const ground = fakeEnemy({ id: 1, fly: false });
  const air = fakeEnemy({ id: 2, fly: true });
  assert.equal(targetMatches('ground', ground), true);
  assert.equal(targetMatches('ground', air), false);
  assert.equal(targetMatches('air', ground), false);
  assert.equal(targetMatches('air', air), true);
  ground.alive = false;
  assert.equal(targetMatches('both', ground), false);
});

test('threat targeting compares estimated exit time across routes', () => {
  const tower = Object.create(Tower.prototype);
  tower.pos = new THREE.Vector3(0, 0, 0);
  tower.stats = { range: 5, targets: 'both', targeting: 'threat' };
  const late = fakeEnemy({ id: 1, x: 1, total: 80, dist: 70, speed: 1 });
  const fastExit = fakeEnemy({ id: 2, x: 1, total: 45, dist: 35, speed: 2 });
  assert.equal(Math.round(estimatedExitTime(fastExit) * 100), 500);
  assert.equal(tower.acquire([late, fastExit]), fastExit);
  assert.equal(compareScores([5, 10, 2], [6, 9, 1]) < 0, true);
});

test('tower target acquisition applies ground filter through indexed query', () => {
  const tower = Object.create(Tower.prototype);
  tower.pos = new THREE.Vector3(0, 0, 0);
  tower.stats = { range: 5, targets: 'ground', targeting: 'threat' };
  const index = new SpatialIndex(4);
  const ground = fakeEnemy({ id: 1, x: 1, total: 30, dist: 20 });
  const air = fakeEnemy({ id: 2, x: 1, total: 20, dist: 19, speed: 2, fly: true });
  index.insert(ground); index.insert(air);
  const ctx = { queryEnemiesRadius: (x, z, r, predicate) => index.queryRadius(x, z, r, predicate) };
  assert.equal(tower.acquire([ground, air], ctx), ground);
});

test('tower rejects a target that leaves range at fire time', () => {
  const tower = Object.create(Tower.prototype);
  tower.pos = new THREE.Vector3(0, 0, 0);
  tower.stats = { range: 2, targets: 'both', targeting: 'threat' };
  const target = fakeEnemy({ id: 1, x: 1 });
  target.pos.x = 4;
  assert.equal(tower.fire(target, {}), false);
});

test('damage protocol handles physical, magic, true, shields, zero and overkill', () => {
  assert.deepEqual(resolveDamage({ hp: 100, raw: 20, armor: 5 }), {
    rawDamage: 20, shieldDamage: 0, hpDamage: 15, totalDamage: 15,
    overkill: 0, killed: false, damageType: 'physical',
  });
  assert.equal(resolveDamage({ hp: 100, raw: 20, resistance: 0.25, damageType: 'magic' }).hpDamage, 15);
  assert.equal(resolveDamage({ hp: 100, shield: 5, raw: 20, armor: 999, resistance: 1, damageType: 'true' }).shieldDamage, 5);
  assert.equal(resolveDamage({ hp: 10, raw: 0 }).totalDamage, 0);
  const overkill = resolveDamage({ hp: 10, raw: 100 });
  assert.equal(overkill.hpDamage, 10);
  assert.equal(overkill.overkill, 90);
  assert.equal(overkill.killed, true);
});

test('enemy hurt returns actual shield and hp loss and rejects repeat damage after death', () => {
  const enemy = Object.create(Enemy.prototype);
  enemy.alive = true; enemy.hp = 12; enemy.shield = 5; enemy.def = { armor: 0 }; enemy.flash = 0;
  const first = enemy.hurt(10);
  assert.equal(first, 10);
  assert.equal(enemy.shield, 0);
  assert.equal(enemy.hp, 7);
  const second = enemy.hurt(100);
  assert.equal(second, 7);
  assert.equal(enemy.hp, 0);
  enemy.alive = false;
  assert.equal(enemy.hurt(100), 0);
});

test('battle kill is idempotent and death removes enemy from the index', () => {
  const level = buildLevel(0, 0);
  const layout = createMapLayout(level.map);
  const samplers = layout.routes.map((route) => makePathSampler(route));
  const battle = new Battle({
    scene: new THREE.Scene(), level, ...layout, sampler: samplers[0], samplers,
    fx: { burst() {}, beam() {} }, hooks: { camera: new THREE.PerspectiveCamera() },
  });
  const profile = enemyProfile('grunt', { enemyLevel: 1 });
  const ticket = { groupId: 'test:0', unit: 0, bounty: 10, route: 0 };
  const enemy = battle.spawnEnemy(profile, ticket);
  assert.equal(battle.enemyIndex.size, 1);
  const hpBefore = enemy.hp;
  battle.hitEnemy(enemy, 0.25, { damageType: 'true' });
  assert.equal(enemy.hp, hpBefore - 0.25, 'battle must preserve fractional damage');
  assert.equal(battle.kill(enemy), true);
  assert.equal(battle.kills, 1);
  assert.equal(battle.enemyIndex.size, 0);
  assert.equal(battle.kill(enemy), false);
  assert.equal(battle.hitEnemy(enemy, 100), null);
  assert.equal(battle.kills, 1);
  battle.destroy();
});

test('tower costs and upgrade costs come from the tower registry', () => {
  for (const [key, def] of Object.entries(TOWER_DEFS)) {
    const tower = Object.create(Tower.prototype);
    tower.key = key; tower.def = def; tower.level = 0;
    assert.equal(towerCost(key), def.cost);
    assert.equal(tower.upgradeCost(), def.lvls[1].cost);
  }
});

test('battle rejects unknown tower keys instead of treating them as free', () => {
  const level = buildLevel(0, 0);
  const layout = createMapLayout(level.map);
  const samplers = layout.routes.map((route) => makePathSampler(route));
  const battle = new Battle({
    scene: new THREE.Scene(), level, ...layout, sampler: samplers[0], samplers,
    fx: { burst() {}, beam() {} }, hooks: { camera: new THREE.PerspectiveCamera() },
  });
  battle.selectedType = 'not-a-tower';
  assert.equal(battle.tryPlace(0, 0), 'invalid');
  assert.equal(battle.gold, level.startGold);
  battle.destroy();
});
