import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Battle, SIMULATION_STEP } from '../js/game/battle.js';
import { Tower, makePathSampler } from '../js/game/entities.js';
import { TOWER_DEFS, statsFor, towerCost } from '../js/game/towers.js';
import { skillFor } from '../js/game/skills.js';
import { applyPoison, updateEffects, poisonStacks, clearEffects } from '../js/game/effects.js';
import { enemyProfile } from '../js/game/enemy-stats.js';

const noop = () => {};
const fx = Object.fromEntries(['update', 'flash', 'ring', 'spark', 'burst', 'lightning', 'beam', 'decal', 'shockwave'].map((key) => [key, noop]));
function setup(t, overrides = {}) {
  const sampler = makePathSampler([new THREE.Vector3(-10, 0, 0), new THREE.Vector3(20, 0, 0)]);
  const level = { startGold: 100000, lives: 20, worldIdx: 1, lvlIdx: 0, hpMul: 1, rewardMul: 1, speedMul: 1,
    intermission: 3, waves: [{ groups: [] }, { groups: [] }], ...overrides };
  const battle = new Battle({ scene: new THREE.Scene(), level, sampler, pathCells: new Set(), fx, hooks: { camera: new THREE.PerspectiveCamera() } });
  t.after(() => battle.destroy());
  return battle;
}
function place(battle, key = 'arrow', cx = 21, cz = 15) {
  assert.equal(battle.selectBuild(key), true);
  assert.equal(battle.tryPlace(cx, cz), true);
  return battle.selectedTower;
}
function grow(battle, tower, displayLevel, branch = 'A') {
  while (tower.level + 1 < displayLevel) assert.equal(battle.upgradeTower(tower, tower.requiresSpecialization() ? branch : null), true);
}
function combat(battle) {
  battle.state = 'combat';
  battle.spawnQueue = [{ t: 10000, type: 'grunt', route: 0 }];
}
function enemy(battle, type = 'grunt', x = 1, hp = 10000) {
  const profile = enemyProfile(type, { enemyLevel: 1 });
  const ticket = { groupId: 'test:0', unit: 0, bounty: 0, route: 0 };
  const e = battle.spawnEnemy(profile, ticket);
  assert.ok(e);
  e.dist = x + 10;
  e.sampler.at(e.dist, e.pos);
  e.hp = e.maxHp = hp;
  e.baseSpeed = e.effectiveSpeed = 0;
  battle.enemyIndex.update(e);
  return e;
}
function advance(battle, seconds, speed = 1, raw = 1 / 60) {
  battle.speed = speed;
  for (let i = 0; i < Math.round(seconds / speed / raw); i++) battle.update(raw);
}

for (const key of Object.keys(TOWER_DEFS)) for (const branch of ['A', 'B']) {
  test(key + ' branch ' + branch + ': eight levels, exact fees, capped upgrades and refund', (t) => {
    const battle = setup(t);
    const tower = place(battle, key);
    const initial = battle.level.startGold;
    grow(battle, tower, 8, branch);
    const spent = Array.from({ length: 8 }, (_, i) => towerCost(key, i)).reduce((a, b) => a + b, 0);
    assert.equal(tower.level, 7);
    assert.equal(tower.maxLevel(), 8);
    assert.equal(tower.invested, spent);
    assert.equal(battle.gold, initial - spent);
    assert.equal(battle.upgradeTower(tower), false);
    assert.equal(battle.upgradeTower(tower, 'B'), false);
    assert.equal(battle.gold, initial - spent);
    assert.equal(tower.mesh.userData.tier4.visible, true);
    assert.equal(tower.mesh.userData.tier8.visible, true);
    assert.equal(tower.mesh.userData.pips.children.filter((p) => p.visible).length, 8);
    assert.equal(battle.sellSelected(), true);
    assert.equal(battle.gold, initial - spent + Math.round(spent * 0.7));
    assert.equal(battle.towerIndex.size, 0);
    assert.equal(battle.sellSelected(), false);
  });
}

test('specialization is explicit at Lv.6 and cannot be selected early or rerolled', (t) => {
  const b = setup(t), tower = place(b);
  assert.equal(b.upgradeTower(tower, 'A'), false);
  grow(b, tower, 5);
  const before = b.gold;
  for (const branch of [null, 'C', '', 1]) assert.equal(b.upgradeTower(tower, branch), false);
  assert.equal(b.gold, before);
  b.gold = tower.upgradeCost() - 1;
  assert.equal(b.upgradeTower(tower, 'B'), false);
  assert.equal(tower.specialization, null);
  b.gold = before;
  grow(b, tower, 6, 'B');
  assert.equal(tower.specialization, 'B');
  assert.equal(b.upgradeTower(tower, 'A'), false);
  const bonus6 = tower.combatStats().dmg / tower.stats.dmg;
  grow(b, tower, 7);
  assert.ok(tower.combatStats().dmg / tower.stats.dmg > bonus6);
});

test('cost and nested stat snapshots reject invalid input and never mutate registry', () => {
  const before = JSON.stringify(TOWER_DEFS);
  for (const lvl of [-1, 8, 1.5, NaN, Infinity]) {
    assert.equal(statsFor('arrow', lvl), null);
    assert.equal(towerCost('arrow', lvl), null);
  }
  statsFor('venom', 3).poison.damage = 999;
  statsFor('beacon', 2).aura.damagePct = 999;
  statsFor('frost', 1).slow.pct = 999;
  assert.equal(JSON.stringify(TOWER_DEFS), before);
});

test('frost slow progression stays within the reduced control budget', () => {
  assert.deepEqual(Array.from({ length: 8 }, (_, level) => statsFor('frost', level).slow.pct),
    [0.43, 0.5, 0.56, 0.59, 0.62, 0.64, 0.66, 0.68]);
});

test('unlock boundaries, pause and foreign tower commands do not spend gold', (t) => {
  const b = setup(t, { worldIdx: 0, lvlIdx: 5 });
  b.selectedType = 'venom';
  assert.equal(b.tryPlace(21, 15), 'locked');
  b.level.lvlIdx = 6;
  const tower = place(b, 'venom');
  assert.equal(b.isTowerUnlocked('beacon'), false);
  b.level.worldIdx = 1; b.level.lvlIdx = 0;
  assert.equal(b.isTowerUnlocked('beacon'), true);
  const gold = b.gold;
  const stranger = new Tower('arrow', 21, 15);
  assert.equal(b.upgradeTower(stranger), false);
  stranger.dispose(b.scene);
  b.setPaused(true);
  assert.equal(b.upgradeTower(tower), false);
  assert.equal(b.sellSelected(), false);
  b.startWave();
  assert.equal(b.state, 'build');
  assert.equal(b.gold, gold);
});

test('skills unlock with full cooldown and upgrades do not refresh existing cooldowns', (t) => {
  const b = setup(t), tower = place(b);
  assert.equal(tower.canUseSkill(), false);
  grow(b, tower, 4);
  assert.equal(tower.skillRemaining(), skillFor(tower).cooldown);
  advance(b, 2);
  const remaining = tower.skillRemaining();
  assert.ok(remaining < 12 && remaining > 9);
  grow(b, tower, 5);
  assert.equal(tower.skillRemaining(), remaining);
  assert.equal(b.useSelectedSkill('signature'), false);
  grow(b, tower, 8);
  assert.equal(tower.skillRemaining('ultimate'), 20);
});

test('arrow skills respect cooldown, combat, target range, manual mode and four-target cap', (t) => {
  const b = setup(t), tower = place(b);
  grow(b, tower, 8, 'B');
  tower.skillCooldowns = { signature: 0, ultimate: 0 };
  assert.equal(b.useSelectedSkill(), false);
  combat(b);
  assert.equal(b.useSelectedSkill(), false);
  enemy(b, 'grunt', 15);
  assert.equal(b.useSelectedSkill(), false);
  const targets = Array.from({ length: 8 }, (_, i) => enemy(b, 'grunt', 1 + i * 0.1));
  let casts = 0;
  b.hooks.onSkill = () => casts++;
  assert.equal(b.useSelectedSkill('bad'), false);
  b.toggleSelectedUltimateMode();
  assert.equal(tower.manualUltimate, true);
  tower.skillCooldowns.signature = 100;
  b.update(SIMULATION_STEP);
  assert.equal(tower.skillCasts.ultimate, 0);
  b.projectiles.list.forEach((p) => b.scene.remove(p.mesh));
  b.projectiles.list = [];
  assert.equal(b.useSelectedSkill('ultimate'), true);
  assert.equal(b.projectiles.list.length, 4);
  assert.ok(b.projectiles.list.every((p) => targets.includes(p.target)));
  assert.equal(b.useSelectedSkill('ultimate'), false);
  assert.equal(casts, 1);
  tower.skillCooldowns.signature = 0;
  b.setPaused(true);
  assert.equal(b.useSelectedSkill(), false);
  b.setPaused(false);
  assert.equal(b.useSelectedSkill(), true);
  assert.equal(tower.skillCasts.signature, 1);
});

test('automatic skills prefer ultimate, and failed casts retain readiness', (t) => {
  const b = setup(t), tower = place(b);
  grow(b, tower, 8); combat(b);
  tower.skillCooldowns = { signature: 0, ultimate: 0 };
  b.update(SIMULATION_STEP);
  assert.deepEqual(tower.skillCasts, { signature: 0, ultimate: 0 });
  enemy(b);
  b.update(SIMULATION_STEP);
  assert.deepEqual(tower.skillCasts, { signature: 0, ultimate: 1 });
  b.update(SIMULATION_STEP);
  assert.equal(tower.skillCasts.signature, 1);
});

test('poison layers have independent expiry, bounded stacks and cannot refresh stronger poison', () => {
  const e = { alive: true, hp: 100, def: {}, effects: {} };
  const ctx = { hitEnemy: (_e, damage) => { e.hp -= damage; } };
  applyPoison(e, { damage: 10, duration: 1.5, maxStacks: 1 });
  updateEffects(e, 0.5, ctx);
  applyPoison(e, { damage: 1, duration: 10, maxStacks: 1 });
  assert.equal(e.effects.poison.layers[0].remaining, 1);
  assert.equal(e.effects.poison.layers[0].damage, 10);
  updateEffects(e, 1, ctx);
  assert.equal(e.hp, 80);
  assert.equal(poisonStacks(e), 0);
  applyPoison(e, { damage: 1, duration: 3, stacks: 100, maxStacks: 100 });
  assert.equal(poisonStacks(e), 8);
  for (const bad of [NaN, Infinity, -1]) assert.equal(applyPoison(e, { damage: bad }), false);
  e.def.fly = true;
  assert.equal(applyPoison(e, { damage: 5 }), false);
  clearEffects(e);
  assert.equal(poisonStacks(e), 0);
});

test('poison snapshots expire separately and resistances allow fractional or zero damage', (t) => {
  const b = setup(t), e = enemy(b);
  e.resistance = 1;
  applyPoison(e, { damage: 0.5, duration: 0.75, maxStacks: 4 });
  applyPoison(e, { damage: 2, duration: 1.5, maxStacks: 4 });
  const before = e.hp;
  updateEffects(e, 0.75, b._ctx());
  assert.equal(e.hp, before);
  assert.equal(poisonStacks(e), 1);
  e.resistance = 0.75;
  updateEffects(e, 0.75, b._ctx());
  assert.equal(e.hp, before - 0.5);
  assert.equal(poisonStacks(e), 0);
});

test('healing suppression blocks shaman healing and expires independently', (t) => {
  const b = setup(t), target = enemy(b), healer = enemy(b, 'healer');
  target.hp -= 100;
  applyPoison(target, { damage: 1, duration: 0.1, healBlock: 2 });
  updateEffects(target, 0.2, b._ctx());
  const hp = target.hp;
  healer.healCd = 0;
  healer.update(0.01, b._ctx());
  assert.equal(target.hp, hp);
  updateEffects(target, 2, b._ctx());
  healer.healCd = 0;
  healer.update(0.01, b._ctx());
  assert.ok(target.hp > hp);
});

test('poison death near exit settles only one bounty and never leaks or reindexes', (t) => {
  const b = setup(t); combat(b);
  const e = enemy(b, 'grunt', 19.999, 1);
  e.baseSpeed = 100;
  const gold = b.gold;
  const bounty = e.ticket.bounty;
  applyPoison(e, { damage: 5, duration: 1 });
  e.effects.poison.layers[0].tick = SIMULATION_STEP;
  b.update(SIMULATION_STEP);
  assert.equal(e.alive, false);
  assert.equal(b.kills, 1);
  assert.equal(b.leaks, 0);
  assert.equal(b.lives, 20);
  assert.equal(b.enemyIndex.size, 0);
  assert.equal(b.gold, gold + bounty);
  b.update(SIMULATION_STEP);
  assert.equal(b.kills, 1);
});

test('venom burst impacts at most four ground targets and still lands after target death', (t) => {
  const b = setup(t), tower = place(b, 'venom');
  grow(b, tower, 4); combat(b);
  const targets = Array.from({ length: 9 }, (_, i) => enemy(b, 'grunt', 1 + i * 0.05));
  const air = enemy(b, 'flyer');
  tower.skillCooldowns.signature = 0;
  assert.equal(b.useSelectedSkill(), true);
  const shot = b.projectiles.list[0];
  const impact = shot.target.pos.clone();
  b.kill(shot.target);
  shot.last.copy(impact); shot.mesh.position.copy(impact);
  b.projectiles.update(SIMULATION_STEP, b._ctx());
  assert.equal(targets.filter((e) => poisonStacks(e) > 0).length, 4);
  assert.equal(poisonStacks(air), 0);
});

test('toxic cloud persists, affects ground only, has a bounded population and frees resources', (t) => {
  const b = setup(t), tower = place(b, 'venom');
  grow(b, tower, 8); combat(b);
  const targets = Array.from({ length: 15 }, (_, i) => enemy(b, 'grunt', 1 + i * 0.01));
  const air = enemy(b, 'flyer');
  tower.skillCooldowns.ultimate = 0;
  assert.equal(b.useSelectedSkill('ultimate'), true);
  assert.equal(b.fields.length, 1);
  assert.equal(targets.filter((e) => poisonStacks(e)).length, 8);
  assert.equal(poisonStacks(air), 0);
  const field = b.fields[0];
  let disposed = 0;
  for (const mesh of field.mesh.children) {
    mesh.geometry.addEventListener('dispose', () => disposed++);
    mesh.material.addEventListener('dispose', () => disposed++);
  }
  b.setPaused(true); b.update(0.25);
  assert.equal(field.remaining, 5);
  b.setPaused(false);
  assert.equal(b.sellSelected(), true);
  assert.equal(b.fields.length, 0);
  assert.equal(field.mesh.parent, null);
  assert.equal(disposed, 4);
});

test('poison fields expire without a sale and are removed on battle destroy', (t) => {
  const b = setup(t), tower = place(b, 'venom'); combat(b);
  const spec = { radius: 2, duration: 0.25, poison: tower.poisonSpec() };
  assert.equal(b.createPoisonField(tower, tower.pos, spec), true);
  advance(b, 0.3);
  assert.equal(b.fields.length, 0);
  assert.equal(b.createPoisonField(tower, tower.pos, spec), true);
  b.destroy();
  assert.equal(b.fields.length, 0);
  assert.equal(b.towerIndex.size, 0);
  assert.equal(b.enemyIndex.size, 0);
  assert.equal(b.scene.children.length, 0);
});

test('beacon auras take strongest contribution, exclude support towers and stop on sale', (t) => {
  const b = setup(t), arrow = place(b), first = place(b, 'beacon', 22, 15);
  const single = { ...arrow.combatStats() };
  const second = place(b, 'beacon', 23, 15);
  assert.equal(arrow.combatStats().dmg, single.dmg);
  assert.equal(arrow.combatStats().rate, single.rate);
  assert.equal(first.combatStats().dmg, 0);
  assert.equal(second.combatStats().rate, second.stats.rate);
  grow(b, second, 8, 'A');
  assert.ok(arrow.combatStats().dmg > single.dmg);
  b.sellSelected();
  assert.equal(arrow.combatStats().dmg, single.dmg);
  b.selectTower(first); b.sellSelected();
  assert.equal(arrow.combatStats().dmg, arrow.stats.dmg);
  assert.equal(arrow.combatStats().rate, arrow.stats.rate);
});

test('beacon skills require active allies; timed buffs cap, expire and stop out of range', (t) => {
  const b = setup(t), arrow = place(b), beacon = place(b, 'beacon', 22, 15);
  grow(b, beacon, 8, 'B'); combat(b);
  beacon.skillCooldowns = { signature: 0, ultimate: 0 };
  assert.equal(b.useSelectedSkill(), false);
  enemy(b);
  assert.equal(b.useSelectedSkill('ultimate'), true);
  assert.equal(beacon.timedBuffs.length, 0);
  b.refreshTowerStats();
  assert.equal(arrow.timedBuffs.length, 1);
  assert.deepEqual(arrow.timedBuffs[0].modifiers,
    { damagePct: 0.25, ratePct: 0.18, skillCooldownPct: 0.12 });
  assert.ok(arrow.combatStats().rate > arrow.stats.rate);
  arrow.addTimedBuff(beacon.id, b.time, 1, { damagePct: 99, ratePct: 99, skillCooldownPct: 99 });
  b.refreshTowerStats();
  assert.ok(arrow.combatStats().dmg <= arrow.stats.dmg * 2);
  assert.ok(arrow.combatStats().rate <= arrow.stats.rate * 1.8);
  assert.ok(arrow._skillCooldownPct <= 0.5);
  b.time += 9; b.refreshTowerStats();
  assert.equal(arrow.timedBuffs.length, 0);
  arrow.addTimedBuff(beacon.id, b.time, 5, { damagePct: 0.4 });
  beacon.pos.x += 30;
  b.refreshTowerStats();
  assert.equal(arrow.timedBuffs.length, 0);
  assert.equal(arrow.combatStats().dmg, arrow.stats.dmg);
});

test('effective attack interval uses the beacon attack-speed bonus', (t) => {
  const b = setup(t), arrow = place(b); place(b, 'beacon', 22, 15);
  combat(b); const target = enemy(b);
  arrow.mesh.userData.yaw = null;
  arrow.target = target; arrow.cooldown = 0;
  arrow.update(SIMULATION_STEP, b._ctx());
  assert.equal(arrow.fireCount, 1);
  assert.ok(Math.abs(arrow.cooldown - 1 / arrow.combatStats().rate) < 1e-9);
});

test('1x/2x/3x and different frame rates produce the same combat result; pause freezes everything', (t) => {
  const run = (speed, raw) => {
    const b = setup(t), tower = place(b, 'venom');
    grow(b, tower, 8); combat(b);
    const e = enemy(b); e.baseSpeed = 0.1;
    tower.skillCooldowns = { signature: 0, ultimate: 0 };
    advance(b, 6, speed, raw);
    const result = [b.time, e.hp, e.dist, tower.skillRemaining(), tower.skillRemaining('ultimate'), b.gold, b.projectiles.list.length, poisonStacks(e), ...Object.values(tower.skillCasts)];
    b.setPaused(true);
    for (let i = 0; i < 100; i++) b.update(0.05);
    assert.equal(b.time, result[0]);
    assert.equal(e.hp, result[1]);
    assert.equal(tower.skillRemaining(), result[3]);
    return result;
  };
  const baseline = run(1, 1 / 60);
  assert.deepEqual(run(2, 1 / 30), baseline);
  assert.deepEqual(run(3, 1 / 20), baseline);
});

test('last life loss takes priority over clearing the final wave', (t) => {
  const b = setup(t, { lives: 1 });
  b.state = 'combat'; b.waveIdx = 1;
  const e = enemy(b, 'grunt', 20); e.baseSpeed = 1;
  const outcomes = [];
  b.hooks.onEnd = (result) => outcomes.push(result.win);
  b.update(SIMULATION_STEP);
  assert.equal(b.state, 'lost');
  assert.deepEqual(outcomes, [false]);
});

test('growth materials are instance-owned and each is released once on sale', (t) => {
  const b = setup(t), tower = place(b, 'venom');
  grow(b, tower, 8);
  const materials = new Set();
  tower.mesh.traverse((mesh) => {
    if (mesh.isMesh && !mesh.material.userData.shared) materials.add(mesh.material);
  });
  assert.ok(materials.has(tower.mesh.userData.pips.children[0].material));
  assert.ok(materials.has(tower.mesh.userData.tier4.children[0].material));
  const counts = new Map();
  for (const mat of materials) mat.addEventListener('dispose', () => counts.set(mat, (counts.get(mat) || 0) + 1));
  b.sellSelected();
  tower.dispose(b.scene);
  assert.equal(counts.size, materials.size);
  assert.ok([...counts.values()].every((count) => count === 1));
});

test('timed vulnerability effects amplify damage and expire on simulation time', (t) => {
  const b = setup(t), e = enemy(b);
  combat(b); b.time = 1;
  e.effects.marked = { until: 9, allDamagePct: 0.25, sniperDamagePct: 0.2 };
  let hp = e.hp;
  b.hitEnemy(e, 100, { damageType: 'true', sourceTowerKey: 'sniper' });
  assert.equal(hp - e.hp, 145);
  e.effects.frostVulnerable = { until: 7, allDamagePct: 0.15 };
  hp = e.hp;
  b.hitEnemy(e, 100, { damageType: 'true', sourceTowerKey: 'arrow' });
  assert.equal(hp - e.hp, 140);
  b.time = 9;
  hp = e.hp;
  b.hitEnemy(e, 100, { damageType: 'true', sourceTowerKey: 'sniper' });
  assert.equal(hp - e.hp, 100);
  assert.equal(e.effects.marked, undefined);
  assert.equal(e.effects.frostVulnerable, undefined);
});

test('control resistance shortens slows and shield recharge resets its cooldown', (t) => {
  const b = setup(t), slowed = enemy(b);
  slowed.controlResistance = 0.4;
  assert.equal(slowed.applySlow(0.7, 10), true);
  assert.equal(slowed.slowPct, 0.7);
  assert.ok(Math.abs(slowed.slowT - 6) < 1e-9);

  const boss = enemy(b, 'frost');
  boss.shield = 0; boss.shieldT = 0;
  boss.update(SIMULATION_STEP, b._ctx());
  assert.equal(boss.shield, boss.shieldMax);
  assert.equal(boss.shieldT, boss.shieldCooldown);
  boss.hurt(boss.shieldMax, { damageType: 'true' });
  boss.update(SIMULATION_STEP, b._ctx());
  assert.equal(boss.shield, 0, '第二次破盾后必须重新等待冷却');
});

test('summoned children cannot steal another family member bounty', (t) => {
  const b = setup(t); b.waveIdx = 0;
  const family = 'split-family';
  assert.equal(b.ledger.registerFamily(family, 20, [
    { id: family + ':0', amount: 10 }, { id: family + ':1', amount: 10 },
  ]), true);
  const profile = enemyProfile('splitter', { enemyLevel: 1 });
  const first = b.spawnEnemy(profile, { groupId: family, unit: 0, bounty: 10, route: 0 });
  const second = b.spawnEnemy(profile, { groupId: family, unit: 1, bounty: 10, route: 0 });
  const opening = b.gold;
  assert.equal(second.reward, 10);
  b.kill(second);
  assert.equal(b.gold, opening + 10);
  const child = b.enemies.find((e) => e !== first && e !== second);
  assert.equal(child.ticket.claimable, false);
  assert.equal(child.reward, 0);
  b.kill(child);
  assert.equal(b.gold, opening + 10);
  b.kill(first);
  assert.equal(b.gold, opening + 20);
});

test('specialization modifiers are reflected in effective combat stats', (t) => {
  const b = setup(t);
  const check = (key, branch, verify) => {
    const tower = place(b, key);
    grow(b, tower, 6, branch);
    verify(tower.combatStats(), tower.stats, tower);
    b.sellSelected();
  };
  check('cannon', 'A', (s, base) => assert.ok(s.armorPenetration > base.armorPenetration));
  check('cannon', 'B', (s, base) => assert.ok(s.splash > base.splash));
  check('sniper', 'A', (s) => assert.equal(s.damageType, 'true'));
  check('tesla', 'A', (s, base) => {
    assert.ok(s.chains > base.chains);
    assert.ok(s.chainRange > base.chainRange);
  });
  check('frost', 'A', (s, base) => {
    assert.ok(s.slow.pct > base.slow.pct);
    assert.ok(s.slow.dur > base.slow.dur);
  });
});

test('enemy durability keeps early levels stable and ramps up in late campaign', () => {
  const early = enemyProfile('grunt', { enemyLevel: 18 }).hp;
  const mid = enemyProfile('grunt', { enemyLevel: 60 }).hp;
  const late = enemyProfile('grunt', { enemyLevel: 100 }).hp;
  assert.equal(early, 97, 'early campaign curve should remain unchanged');
  assert.ok(mid >= 380, `mid-campaign durability is too low: ${mid}`);
  assert.ok(late >= 1190, `late-campaign durability is too low: ${late}`);
  assert.ok(late > mid * 3, 'late growth must outpace the linear tower power curve');

  const lateTypes = ['grunt', 'runner', 'tank', 'flyer', 'healer', 'splitter', 'fox', 'flamingo', 'mummy', 'stork', 'dancer'];
  const lateProfiles = lateTypes.map((type) => enemyProfile(type, { enemyLevel: 100 }));
  const strongestNonSniperHit = Math.max(...['arrow', 'cannon', 'frost', 'tesla', 'venom']
    .map((key) => statsFor(key, 7).dmg));
  assert.ok(lateProfiles.every((profile) => profile.hp > strongestNonSniperHit),
    'no late common enemy should be erased by one non-sniper basic hit');
  const sniperHit = statsFor('sniper', 7).dmg;
  assert.ok(lateProfiles.filter((profile) => profile.hp <= sniperHit).length <= 3,
    'the dedicated sniper may one-shot only the lightest late enemies');
  assert.ok(enemyProfile('meadow', { enemyLevel: 100 }).hp > sniperHit * 10,
    'even the weakest late boss must survive sustained max-sniper fire');

  const gruntHp = enemyProfile('grunt', { enemyLevel: 100 }).hp;
  for (const key of ['arrow', 'cannon', 'frost', 'tesla', 'sniper', 'venom']) {
    const stats = statsFor(key, 7);
    const basicTtk = gruntHp / (stats.dmg * stats.rate);
    assert.ok(basicTtk >= 2, `${key} max-level basic TTK is too short: ${basicTtk.toFixed(2)}s`);
  }
});
