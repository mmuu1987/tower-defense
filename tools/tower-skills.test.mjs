import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Battle, SIMULATION_STEP } from '../js/game/battle.js';
import { Tower, makePathSampler } from '../js/game/entities.js';
import { TOWER_DEFS } from '../js/game/towers.js';
import { SKILL_DEFS, skillFor, specializationFor, canUseSkill } from '../js/game/skills.js';
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
  while (tower.level + 1 < displayLevel) {
    assert.equal(battle.upgradeTower(tower, tower.requiresSpecialization() ? branch : null), true);
  }
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

function combat(battle) {
  battle.state = 'combat';
  battle.spawnQueue = [{ t: 10000, type: 'grunt', route: 0 }];
}

test('四塔技能定义存在且结构正确', () => {
  for (const key of ['cannon', 'sniper', 'tesla', 'frost']) {
    const def = SKILL_DEFS[key];
    assert.ok(def, `${key} 应有技能定义`);
    assert.ok(def.signature, `${key} 应有招牌技能`);
    assert.ok(def.ultimate, `${key} 应有终极技能`);
    assert.equal(def.signature.unlockLevel, 4, `${key} 招牌技能应在 Lv.4 解锁`);
    assert.equal(def.ultimate.unlockLevel, 8, `${key} 终极技能应在 Lv.8 解锁`);
    assert.ok(def.signature.cooldown > 0, `${key} 招牌技能应有冷却时间`);
    assert.ok(def.ultimate.cooldown > 0, `${key} 终极技能应有冷却时间`);
    assert.ok(def.specializations, `${key} 应有专精定义`);
    assert.ok(def.specializations.A, `${key} 应有专精 A`);
    assert.ok(def.specializations.B, `${key} 应有专精 B`);
  }
});

test('四塔技能在正确等级解锁', (t) => {
  const battle = setup(t);
  for (const key of ['cannon', 'sniper', 'tesla', 'frost']) {
    const tower = place(battle, key, 21, 15);
    assert.equal(canUseSkill(tower, 'signature'), false, `${key} Lv.1 不应能用招牌技能`);
    assert.equal(canUseSkill(tower, 'ultimate'), false, `${key} Lv.1 不应能用终极技能`);
    grow(battle, tower, 4);
    tower.skillCooldowns = { signature: 0, ultimate: 0 };
    assert.equal(canUseSkill(tower, 'signature'), true, `${key} Lv.4 应能用招牌技能`);
    assert.equal(canUseSkill(tower, 'ultimate'), false, `${key} Lv.4 不应能用终极技能`);
    grow(battle, tower, 8);
    tower.skillCooldowns = { signature: 0, ultimate: 0 };
    assert.equal(canUseSkill(tower, 'signature'), true, `${key} Lv.8 应能用招牌技能`);
    assert.equal(canUseSkill(tower, 'ultimate'), true, `${key} Lv.8 应能用终极技能`);
    battle.sellSelected();
  }
});

test('四塔专精修改器格式正确', () => {
  for (const key of ['cannon', 'sniper', 'tesla', 'frost']) {
    const specA = specializationFor(key, 'A');
    const specB = specializationFor(key, 'B');
    assert.ok(specA, `${key} 专精 A 应存在`);
    assert.ok(specB, `${key} 专精 B 应存在`);
    assert.ok(specA.key, `${key} 专精 A 应有 key`);
    assert.ok(specA.name, `${key} 专精 A 应有 name`);
    assert.ok(specA.desc, `${key} 专精 A 应有 desc`);
    assert.ok(specA.modifiers, `${key} 专精 A 应有 modifiers`);
    assert.ok(typeof specA.modifiers === 'object', `${key} 专精 A modifiers 应是对象`);
  }
});

test('炮塔技能：集束炮击', (t) => {
  const battle = setup(t);
  const tower = place(battle, 'cannon');
  grow(battle, tower, 4);
  combat(battle);
  const target = enemy(battle);
  tower.skillCooldowns = { signature: 0 };
  const before = battle.projectiles.list.length;
  assert.equal(battle.useSelectedSkill('signature'), true, '应能释放集束炮击');
  const after = battle.projectiles.list.length;
  assert.ok(after > before, '应生成炮弹');
  assert.ok(battle.projectiles.list.every((p) => Number.isFinite(p.T) && p.T > 0), '炮弹飞行时间必须有效');
  const hp = target.hp;
  for (let i = 0; i < 300 && battle.projectiles.list.length; i++) battle.projectiles.update(1 / 60, battle._ctx());
  assert.ok(target.hp < hp, '集束炮击落地后必须造成伤害');
  assert.ok(tower.skillCooldowns.signature > 0, '应进入冷却');
});

test('狙击塔技能：弱点狙击', (t) => {
  const battle = setup(t);
  const tower = place(battle, 'sniper');
  grow(battle, tower, 4);
  combat(battle);
  const target = enemy(battle);
  tower.skillCooldowns = { signature: 0 };
  assert.equal(battle.useSelectedSkill('signature'), true, '应能释放弱点狙击');
  assert.ok(tower.skillCooldowns.signature > 0, '应进入冷却');
});

test('电塔技能：过载', (t) => {
  const battle = setup(t);
  const tower = place(battle, 'tesla');
  grow(battle, tower, 4);
  combat(battle);
  const target = enemy(battle);
  tower.skillCooldowns = { signature: 0 };
  const before = tower.combatStats().rate;
  assert.equal(battle.useSelectedSkill('signature'), true, '应能释放过载');
  tower._refreshCombatStats(battle._ctx());
  assert.ok(tower.combatStats().rate > before * 1.5, '过载期间攻速应有明显提高');
  assert.ok(tower.combatStats().rate <= before * 1.7, '过载不应再次把攻速推到失控区间');
  battle.time = tower.overloadUntil + 0.01;
  tower._refreshCombatStats(battle._ctx());
  assert.equal(tower.combatStats().rate, before, '过载结束后攻速应恢复');
  assert.ok(tower.skillCooldowns.signature > 0, '应进入冷却');
});

test('EMP 与冰霜技能通过统一效果协议施加减速', (t) => {
  for (const key of ['tesla', 'frost']) {
    const battle = setup(t), tower = place(battle, key);
    grow(battle, tower, key === 'tesla' ? 8 : 4);
    combat(battle);
    const target = enemy(battle);
    const tier = key === 'tesla' ? 'ultimate' : 'signature';
    tower.skillCooldowns[tier] = 0;
    assert.equal(battle.useSelectedSkill(tier), true);
    assert.ok(target.slowPct > 0 && target.slowT > 0, `${key} 技能必须真正减速目标`);
    if (key === 'frost') assert.ok(target.slowPct <= 0.66, '冰环新星减速不应超出收敛后的预算');
    battle.destroy();
  }
});

test('狙击穿甲与 Tesla 减速专精进入实际命中链路', (t) => {
  const sniperBattle = setup(t), sniper = place(sniperBattle, 'sniper');
  combat(sniperBattle);
  const armored = enemy(sniperBattle);
  armored.armor = 20;
  const hp = armored.hp;
  assert.equal(sniper.fire(armored, sniperBattle._ctx()), true);
  for (let i = 0; i < 120 && sniperBattle.projectiles.list.length; i++) {
    sniperBattle.projectiles.update(1 / 60, sniperBattle._ctx());
  }
  assert.equal(hp - armored.hp, sniper.combatStats().dmg, '狙击塔应无视护甲');

  const teslaBattle = setup(t), tesla = place(teslaBattle, 'tesla');
  grow(teslaBattle, tesla, 6, 'B');
  combat(teslaBattle);
  const target = enemy(teslaBattle);
  assert.equal(tesla.fire(target, teslaBattle._ctx()), true);
  assert.ok(target.slowPct > 0 && target.slowT > 0, 'Tesla B 普攻应附带减速');
});

test('寒冰塔技能：冰环新星', (t) => {
  const battle = setup(t);
  const tower = place(battle, 'frost');
  grow(battle, tower, 4);
  combat(battle);
  const target = enemy(battle);
  tower.skillCooldowns = { signature: 0 };
  assert.equal(battle.useSelectedSkill('signature'), true, '应能释放冰环新星');
  assert.ok(tower.skillCooldowns.signature > 0, '应进入冷却');
});

test('满级主动技能的爆发与增伤预算保持受控', (t) => {
  const cannonBattle = setup(t), cannon = place(cannonBattle, 'cannon');
  grow(cannonBattle, cannon, 8, 'B'); combat(cannonBattle); enemy(cannonBattle);
  cannon.skillCooldowns.ultimate = 0;
  assert.equal(cannonBattle.useSelectedSkill('ultimate'), true);
  assert.equal(cannonBattle.projectiles.list.length, 6, '地毯轰炸只应投放六枚炮弹');
  const shellDamage = cannonBattle.projectiles.list.reduce((sum, projectile) => sum + projectile.dmg, 0);
  assert.ok(shellDamage <= cannon.combatStats().dmg * 3.4, '地毯轰炸总基础伤害不应超过 3.4 次普攻');
  assert.ok(cannonBattle.projectiles.list.every((projectile) => projectile.splash <= 2.2),
    '地毯轰炸不应覆盖过大的区域');

  const sniperBattle = setup(t), sniper = place(sniperBattle, 'sniper');
  grow(sniperBattle, sniper, 8, 'A'); combat(sniperBattle);
  const marked = enemy(sniperBattle);
  sniper.skillCooldowns.ultimate = 0;
  assert.equal(sniperBattle.useSelectedSkill('ultimate'), true);
  assert.equal(marked.effects.marked.allDamagePct, 0.108);
  assert.ok(Math.abs(marked.effects.marked.sniperDamagePct - 0.072) < 1e-12);
  assert.equal(marked.effects.marked.until - sniperBattle.time, 5.4);

  for (const [key, multiplier] of [['tesla', 1.4], ['frost', 1.5]]) {
    const battle = setup(t), tower = place(battle, key);
    grow(battle, tower, 8, 'A'); combat(battle);
    const target = enemy(battle);
    target.resistance = 0;
    const hp = target.hp;
    tower.skillCooldowns.ultimate = 0;
    assert.equal(battle.useSelectedSkill('ultimate'), true);
    assert.ok(hp - target.hp <= Math.round(tower.combatStats().dmg * multiplier),
      `${key} 终极技能对单体的瞬时伤害不应超过设定预算`);
    if (key === 'frost') assert.ok(Math.abs(target.slowPct - 0.4374) < 1e-12,
      '极寒领域应采用二次下调后的减速强度');
  }
});

test('四塔专精在 Lv.6 生效', (t) => {
  const battle = setup(t);
  for (const key of ['cannon', 'sniper', 'tesla', 'frost']) {
    const tower = place(battle, key, 21, 15);
    grow(battle, tower, 5);
    const before = tower.combatStats();
    assert.equal(battle.upgradeTower(tower, 'A'), true, `${key} 应能选择专精 A`);
    assert.equal(tower.specialization, 'A', `${key} 应记录专精 A`);
    const after = tower.combatStats();
    assert.ok(JSON.stringify(before) !== JSON.stringify(after) || key === 'beacon', `${key} 专精应改变属性`);
    battle.sellSelected();
  }
});

test('四塔不能在未达到 Lv.6 时选择专精', (t) => {
  const battle = setup(t);
  for (const key of ['cannon', 'sniper', 'tesla', 'frost']) {
    const tower = place(battle, key, 21, 15);
    grow(battle, tower, 4);
    assert.equal(battle.upgradeTower(tower, 'A'), false, `${key} Lv.4 不应能选择专精`);
    assert.equal(tower.specialization, null, `${key} 不应有专精`);
    battle.sellSelected();
  }
});

test('四塔终极技能需要 Lv.8', (t) => {
  const battle = setup(t);
  for (const key of ['cannon', 'sniper', 'tesla', 'frost']) {
    const tower = place(battle, key, 21, 15);
    grow(battle, tower, 7);
    combat(battle);
    enemy(battle);
    tower.skillCooldowns = { ultimate: 0 };
    assert.equal(battle.useSelectedSkill('ultimate'), false, `${key} Lv.7 不应能用终极技能`);
    grow(battle, tower, 8, 'A');
    tower.skillCooldowns = { ultimate: 0 };
    assert.equal(battle.useSelectedSkill('ultimate'), true, `${key} Lv.8 应能用终极技能`);
    battle.sellSelected();
  }
});

test('四塔技能冷却时间在合理范围内', () => {
  for (const key of ['cannon', 'sniper', 'tesla', 'frost']) {
    const sig = skillFor(key, 'signature');
    const ult = skillFor(key, 'ultimate');
    assert.ok(sig.cooldown >= 10 && sig.cooldown <= 20, `${key} 招牌技能冷却应在 10-20 秒`);
    assert.ok(ult.cooldown >= 20 && ult.cooldown <= 35, `${key} 终极技能冷却应在 20-35 秒`);
  }
});
