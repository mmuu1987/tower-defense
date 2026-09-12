// Tower skills share one entry point for the client and offline simulators.
import * as THREE from 'three';
import { compareScores, targetMatches, targetScore, xzDistanceSq } from './combat.js';

export const SKILL_DEFS = {
  arrow: {
    signature: { key: 'arrowVolley', name: '连射', unlockLevel: 4, cooldown: 12 },
    ultimate: { key: 'arrowRain', name: '箭雨', unlockLevel: 8, cooldown: 24 },
    specializations: {
      A: { key: 'rapid', name: '快速清杂', desc: '攻速提高，连射冷却缩短', modifiers: { ratePct: 0.16, signatureCooldownPct: -0.2 } },
      B: { key: 'mark', name: '单点压制', desc: '对高威胁目标造成更高伤害', modifiers: { damagePct: 0.18, ultimateDamagePct: 0.25 } },
    },
  },
  cannon: {
    signature: { key: 'barrage', name: '集束炮击', unlockLevel: 4, cooldown: 14 },
    ultimate: { key: 'carpetBombing', name: '地毯轰炸', unlockLevel: 8, cooldown: 28 },
    specializations: {
      A: { key: 'armorBreaker', name: '破甲穿透', desc: '穿透护甲，对精英和Boss更有效', modifiers: { armorPenetration: 8, eliteDamagePct: 0.15, bossDamagePct: 0.2 } },
      B: { key: 'blastRadius', name: '范围增强', desc: '溅射范围扩大，影响更多目标', modifiers: { splashPct: 0.25, damagePct: 0.12, signatureCooldownPct: -0.15 } },
    },
  },
  sniper: {
    signature: { key: 'weakSpot', name: '弱点狙击', unlockLevel: 4, cooldown: 15 },
    ultimate: { key: 'markedForDeath', name: '狙击标记', unlockLevel: 8, cooldown: 25 },
    specializations: {
      A: { key: 'apRounds', name: '穿甲弹', desc: '更强的护甲穿透和真实伤害', modifiers: { trueDamage: true, signatureDamagePct: 0.5 } },
      B: { key: 'headshot', name: '爆头', desc: '有概率造成暴击伤害', modifiers: { critChance: 0.25, critMultiplier: 2.0, ratePct: 0.18, signatureCooldownPct: -0.2 } },
    },
  },
  tesla: {
    signature: { key: 'overload', name: '过载', unlockLevel: 4, cooldown: 13 },
    ultimate: { key: 'empBlast', name: '电磁脉冲', unlockLevel: 8, cooldown: 27 },
    specializations: {
      A: { key: 'chainMaster', name: '连锁增强', desc: '更多弹跳目标，更远弹跳距离', modifiers: { chains: 4, chainRangePct: 0.3, signatureDuration: 1 } },
      B: { key: 'paralyze', name: '瘫痪', desc: '电击附带减速效果', modifiers: { slow: { pct: 0.35, dur: 1.5 }, damagePct: 0.15, slowedDamagePct: 0.12 } },
    },
  },
  frost: {
    signature: { key: 'frostNova', name: '冰环新星', unlockLevel: 4, cooldown: 12 },
    ultimate: { key: 'blizzardField', name: '极寒领域', unlockLevel: 8, cooldown: 30 },
    specializations: {
      A: { key: 'deepFreeze', name: '深度冻结', desc: '更强的减速效果', modifiers: { slowPct: 0.12, slowDurationPct: 0.3, signatureSlowPct: 0.1 } },
      B: { key: 'frozenCycle', name: '冰冻循环', desc: '更频繁的冰环释放', modifiers: { ratePct: 0.2, signatureCooldownPct: -0.25, slowedDamagePct: 0.18 } },
    },
  },
  venom: {
    signature: { key: 'toxicBurst', name: '毒液爆破', unlockLevel: 4, cooldown: 13 },
    ultimate: { key: 'plagueCloud', name: '毒云区', unlockLevel: 8, cooldown: 26 },
    specializations: {
      A: { key: 'spread', name: '有限传播', desc: '毒液爆破范围更大，毒层更易传播', modifiers: { signatureRadius: 1.2, poisonMaxStacks: 1 } },
      B: { key: 'toxin', name: '单体叠层', desc: '毒伤更高，治疗抑制更久', modifiers: { poisonDamagePct: 0.35, healBlockPct: 0.35 } },
    },
  },
  beacon: {
    signature: { key: 'rally', name: '集结号令', unlockLevel: 4, cooldown: 16 },
    ultimate: { key: 'overdrive', name: '超载指令', unlockLevel: 8, cooldown: 30 },
    specializations: {
      A: { key: 'command', name: '火力增益', desc: '光环提高伤害与攻速', modifiers: { auraDamagePct: 0.12, auraRatePct: 0.08 } },
      B: { key: 'tactics', name: '技能循环', desc: '光环内技能冷却更快', modifiers: { auraSkillCooldownPct: 0.18, signatureCooldownPct: -0.12 } },
    },
  },
};

export function skillFor(towerOrKey, tier = 'signature') {
  if (tier !== 'signature' && tier !== 'ultimate') return null;
  const key = typeof towerOrKey === 'string' ? towerOrKey : towerOrKey?.key;
  return SKILL_DEFS[key]?.[tier] || null;
}

export function specializationFor(towerOrKey, branch) {
  if (branch !== 'A' && branch !== 'B') return null;
  const key = typeof towerOrKey === 'string' ? towerOrKey : towerOrKey?.key;
  return SKILL_DEFS[key]?.specializations?.[branch] || null;
}

export function specializationModifiers(tower) {
  const values = { ...specializationFor(tower, tower.specialization)?.modifiers };
  if (tower.level >= 6) {
    for (const key of Object.keys(values)) {
      if (key.endsWith('Pct')) values[key] *= 1.2;
      if (key === 'signatureRadius') values[key] = 1 + (values[key] - 1) * 1.2;
    }
  }
  return values;
}

export function canUseSkill(tower, tier = 'signature') {
  const skill = skillFor(tower, tier);
  return !tower.disposed && !!skill && (tower.level + 1) >= skill.unlockLevel && (tower.skillCooldowns?.[tier] || 0) <= 1e-6;
}

export function skillCooldown(tower, tier = 'signature') {
  return Math.max(0, tower?.skillCooldowns?.[tier] || 0);
}

function muzzleOf(tower) {
  return tower.mesh.userData.muzzle
    ? tower.mesh.userData.muzzle.getWorldPosition(new THREE.Vector3())
    : tower.pos.clone().setY(0.6);
}

function damageOpts(tower, extra = {}) {
  const s = tower.combatStats();
  return {
    damageType: s.damageType,
    armorPenetration: s.armorPenetration,
    ignoreArmor: s.ignoreArmor,
    minimumDamage: s.minimumDamage,
    allowZero: s.allowZero,
    targetMask: s.targets,
    sourceTowerId: tower.id,
    ...extra,
  };
}

function targetsInRange(tower, ctx, radius = tower.combatStats().range) {
  const predicate = (e) => targetMatches(tower.combatStats().targets, e);
  return ctx.queryEnemiesRadius
    ? ctx.queryEnemiesRadius(tower.pos.x, tower.pos.z, radius, predicate)
    : ctx.enemies.filter((e) => predicate(e) && xzDistanceSq(e.pos, tower.pos) <= radius ** 2);
}

function castArrow(tower, tier, ctx) {
  const s = tower.combatStats();
  const target = tower.acquire(ctx.enemies, ctx);
  if (!target) return false;
  const from = muzzleOf(tower);
  if (tier === 'signature') {
    for (let i = 0; i < 3; i++) {
      ctx.projectiles.spawnHoming(from, target, Math.round(s.dmg * (0.7 + i * 0.08)), s.projSpeed, {
        ...damageOpts(tower), kind: tower.def.proj, pierce: false,
      });
    }
    ctx.fx.flash(from, 0xd8e8ff, 7, 0.1);
    return true;
  }
  const chosen = targetsInRange(tower, ctx)
    .sort((a, b) => compareScores(targetScore(a), targetScore(b))).slice(0, 5);
  if (!chosen.length) return false;
  const damageMul = 1.25 * (1 + (specializationModifiers(tower).ultimateDamagePct || 0));
  for (const e of chosen) ctx.projectiles.spawnHoming(from, e, Math.round(s.dmg * damageMul), s.projSpeed, {
    ...damageOpts(tower, { damageType: 'physical' }), kind: tower.def.proj,
  });
  ctx.fx.ring(tower.pos, 1.2, 0xffd36a, 0.3);
  return true;
}

function castVenom(tower, tier, ctx) {
  const s = tower.combatStats();
  const target = tower.acquire(ctx.enemies, ctx);
  if (!target) return false;
  const from = muzzleOf(tower);
  const poison = tower.poisonSpec(tier === 'ultimate' ? 2 : 1);
  if (tier === 'signature') {
    ctx.projectiles.spawnHoming(from, target, Math.round(s.dmg * 1.5), s.projSpeed, {
      ...damageOpts(tower, { effects: { poison }, splash: tower.skillRadius(), targetLimit: 6 }), kind: 'venom',
    });
    ctx.fx.flash(from, 0x8dff79, 8, 0.1);
    return true;
  }
  const radius = tower.skillRadius(tier);
  if (!ctx.createPoisonField?.(tower, target.pos, { radius, duration: 6, poison, targetLimit: 12 })) return false;
  ctx.fx.ring(target.pos, radius, 0x75e66f, 0.55);
  return true;
}

function castBeacon(tower, tier, ctx) {
  const affected = (ctx.queryTowersRadius?.(tower.pos.x, tower.pos.z, tower.combatStats().range) || ctx.towers)
    .filter((other) => !other.disposed && other !== tower && other.key !== 'beacon' &&
      xzDistanceSq(other.pos, tower.pos) <= tower.combatStats().range ** 2);
  if (!affected.length || !affected.some((other) => other.acquire(ctx.enemies, ctx))) return false;
  const duration = tier === 'signature' ? 5 : 8;
  const boost = tier === 'signature'
    ? { damagePct: 0.28, ratePct: 0.22, skillCooldownPct: 0.1 }
    : { damagePct: 0.55, ratePct: 0.42, skillCooldownPct: 0.28 };
  for (const target of affected) target.addTimedBuff(tower.id, ctx.time, duration, boost, tier);
  ctx.fx.ring(tower.pos, tower.combatStats().range, tier === 'signature' ? 0x62d7ff : 0xffd36a, 0.65);
  return true;
}

function castCannon(tower, tier, ctx) {
  const s = tower.combatStats();
  const target = tower.acquire(ctx.enemies, ctx);
  if (!target) return false;
  const from = muzzleOf(tower);
  if (tier === 'signature') {
    // 集束炮击：立即发射 4 枚炮弹
    const dmg = Math.round(s.dmg * 0.6);
    const targetPos = target.pos.clone();
    for (let i = 0; i < 4; i++) {
      ctx.projectiles.spawnMortar(from, targetPos, dmg, s.projSpeed * (1 + i * 0.15), {
        ...damageOpts(tower), splash: s.splash,
      });
    }
    ctx.fx.flash(from, 0xff9a4a, 8, 0.12);
    return true;
  }
  // 地毯轰炸：立即发射多枚炮弹到目标区域
  const bombingSite = target.pos.clone();
  const radius = 3.5;
  for (let i = 0; i < 8; i++) {
    const offset = new THREE.Vector3(
      (Math.random() - 0.5) * radius * 1.6,
      0,
      (Math.random() - 0.5) * radius * 1.6
    );
    const impactPos = bombingSite.clone().add(offset);
    ctx.projectiles.spawnMortar(from, impactPos, Math.round(s.dmg * 0.8), s.projSpeed * (1 + i * 0.1), {
      ...damageOpts(tower), splash: 2.5,
    });
  }
  ctx.fx.ring(bombingSite, radius, 0xff6a3a, 0.7);
  return true;
}

function castSniper(tower, tier, ctx) {
  const s = tower.combatStats();
  const target = tower.acquire(ctx.enemies, ctx);
  if (!target) return false;
  const from = muzzleOf(tower);
  if (tier === 'signature') {
    // 弱点狙击：280% 伤害，对精英/Boss 额外加成
    let dmgMul = 2.8;
    const mods = specializationModifiers(tower);
    if (mods.signatureDamagePct) dmgMul += mods.signatureDamagePct;
    if (target.def.rank === 'elite') dmgMul += 0.4;
    if (target.def.shape === 'boss') dmgMul += 0.6;
    const dmg = Math.round(s.dmg * dmgMul);
    ctx.projectiles.spawnHoming(from, target, dmg, s.projSpeed, {
      ...damageOpts(tower, { damageType: mods.trueDamage ? 'true' : 'physical' }),
      kind: tower.def.proj, pierce: true,
    });
    ctx.fx.flash(from, 0xffea6a, 10, 0.15);
    return true;
  }
  // 狙击标记：目标受到所有来源伤害 +30%
  if (!target.effects) target.effects = {};
  target.effects.marked = {
    sourceTowerId: tower.id,
    until: ctx.time + 8,
    allDamagePct: 0.3,
    sniperDamagePct: 0.25,
  };
  ctx.fx.ring(target.pos, 1.5, 0xff4a6a, 0.6);
  return true;
}

function castTesla(tower, tier, ctx) {
  const s = tower.combatStats();
  if (tier === 'signature') {
    // 过载：3 秒内攻速 +120%
    const mods = specializationModifiers(tower);
    const duration = 3 + (mods.signatureDuration || 0);
    tower.overloadUntil = ctx.time + duration;
    tower.overloadRate = 2.2;
    tower.overloadDamageMul = 0.85;
    ctx.fx.ring(tower.pos, 1.2, 0x6aaaff, 0.5);
    return true;
  }
  // 电磁脉冲：4.5 格范围伤害 + 减速
  const radius = 4.5;
  const targets = targetsInRange(tower, ctx, radius);
  if (!targets.length) return false;
  for (const e of targets) {
    ctx.hitEnemy(e, Math.round(s.dmg * 1.5), {
      ...damageOpts(tower),
      effects: { slow: { pct: 0.7, dur: 2.5 } },
    });
  }
  ctx.fx.ring(tower.pos, radius, 0x3a8aff, 0.8);
  ctx.fx.shockwave?.(tower.pos.clone().setY(0.3), radius);
  return true;
}

function castFrost(tower, tier, ctx) {
  const s = tower.combatStats();
  if (tier === 'signature') {
    // 冰环新星：扩大范围的减速 + 伤害
    const mods = specializationModifiers(tower);
    const radius = s.range + 1.0;
    const slowPct = s.slow.pct + 0.15 + (mods.signatureSlowPct || 0);
    const slowDur = s.slow.dur + 1.5;
    const targets = targetsInRange(tower, ctx, radius);
    for (const e of targets) {
      ctx.hitEnemy(e, Math.round(s.dmg * 0.8), {
        ...damageOpts(tower),
        effects: { slow: { pct: Math.min(0.95, slowPct), dur: slowDur } },
      });
    }
    ctx.fx.ring(tower.pos, radius, 0x6ad4ff, 0.7);
    return true;
  }
  // 极寒领域：立即对目标区域造成范围伤害和减速
  const target = tower.acquire(ctx.enemies, ctx);
  if (!target) return false;
  const fieldPos = target.pos.clone();
  const radius = 4.0;
  const nearby = ctx.queryEnemiesRadius(fieldPos.x, fieldPos.z, radius, (e) => e.alive);
  if (!nearby.length) return false;
  for (const e of nearby) {
    ctx.hitEnemy(e, Math.round(s.dmg * 2.0), {
      ...damageOpts(tower),
      effects: { slow: { pct: 0.75, dur: 6 } },
    });
  }
  ctx.fx.ring(fieldPos, radius, 0x3aa4ff, 0.8);
  return true;
}

export function castSkill(tower, tier, ctx) {
  if (!canUseSkill(tower, tier) || ctx.state !== 'combat' || ctx.paused) return false;
  const casters = {
    arrow: castArrow, cannon: castCannon, sniper: castSniper,
    tesla: castTesla, frost: castFrost, venom: castVenom, beacon: castBeacon,
  };
  const ok = casters[tower.key]?.(tower, tier, ctx) ?? false;
  if (ok) {
    tower.skillCooldowns[tier] = skillFor(tower, tier).cooldown;
    tower.skillCasts[tier]++;
    ctx.onSkill?.(tower, tier);
  }
  return ok;
}

export function autoSkillTiers(tower, ctx) {
  if (ctx.state !== 'combat' || ctx.paused) return [];
  const tiers = [];
  if (!tower.manualUltimate && canUseSkill(tower, 'ultimate')) tiers.push('ultimate');
  if (canUseSkill(tower, 'signature')) tiers.push('signature');
  return tiers;
}
