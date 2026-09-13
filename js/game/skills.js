// Tower skills share one entry point for the client and offline simulators.
import * as THREE from 'three';
import { compareScores, targetMatches, targetScore, xzDistanceSq } from './combat.js';
import { towerPerformanceScale } from './towers.js';

export const SKILL_DEFS = {
  arrow: {
    signature: { key: 'arrowVolley', name: '连射', unlockLevel: 4, cooldown: 12 },
    ultimate: { key: 'arrowRain', name: '箭雨', unlockLevel: 8, cooldown: 20 },
    specializations: {
      A: { key: 'rapid', name: '快速清杂', desc: '攻速提高，连射冷却缩短', modifiers: { ratePct: 0.12, signatureCooldownPct: -0.12 } },
      B: { key: 'mark', name: '单点压制', desc: '对高威胁目标造成更高伤害', modifiers: { damagePct: 0.1, ultimateDamagePct: 0.15 } },
    },
  },
  cannon: {
    signature: { key: 'barrage', name: '集束炮击', unlockLevel: 4, cooldown: 12 },
    ultimate: { key: 'carpetBombing', name: '地毯轰炸', unlockLevel: 8, cooldown: 22 },
    specializations: {
      A: { key: 'armorBreaker', name: '破甲穿透', desc: '穿透护甲，对精英和Boss更有效', modifiers: { armorPenetration: 0.25, eliteDamagePct: 0.08, bossDamagePct: 0.12 } },
      B: { key: 'blastRadius', name: '范围增强', desc: '溅射范围扩大，影响更多目标', modifiers: { splashPct: 0.15, damagePct: 0.08, signatureCooldownPct: -0.1 } },
    },
  },
  sniper: {
    signature: { key: 'weakSpot', name: '弱点狙击', unlockLevel: 4, cooldown: 15 },
    ultimate: { key: 'markedForDeath', name: '狙击标记', unlockLevel: 8, cooldown: 22 },
    specializations: {
      A: { key: 'apRounds', name: '穿甲弹', desc: '更强的护甲穿透和真实伤害', modifiers: { trueDamage: true, signatureDamagePct: 0.25 } },
      B: { key: 'headshot', name: '爆头', desc: '有概率造成暴击伤害', modifiers: { critChance: 0.2, critMultiplier: 1.7, ratePct: 0.1, signatureCooldownPct: -0.12 } },
    },
  },
  tesla: {
    signature: { key: 'overload', name: '过载', unlockLevel: 4, cooldown: 13 },
    ultimate: { key: 'empBlast', name: '电磁脉冲', unlockLevel: 8, cooldown: 22 },
    specializations: {
      A: { key: 'chainMaster', name: '连锁增强', desc: '更多弹跳目标，更远弹跳距离', modifiers: { chains: 2, chainRangePct: 0.18, signatureDuration: 0.5 } },
      B: { key: 'paralyze', name: '瘫痪', desc: '电击附带减速效果', modifiers: { slow: { pct: 0.25, dur: 1.2 }, damagePct: 0.08, slowedDamagePct: 0.06 } },
    },
  },
  frost: {
    signature: { key: 'frostNova', name: '冰环新星', unlockLevel: 4, cooldown: 16 },
    ultimate: { key: 'blizzardField', name: '极寒领域', unlockLevel: 8, cooldown: 20 },
    specializations: {
      A: { key: 'deepFreeze', name: '深度冻结', desc: '更强的减速效果', modifiers: { slowPct: 0.06, slowDurationPct: 0.2, signatureSlowPct: 0.045 } },
      B: { key: 'frozenCycle', name: '冰冻循环', desc: '更频繁的冰环释放', modifiers: { ratePct: 0.1, signatureCooldownPct: -0.15, slowedDamagePct: 0.08 } },
    },
  },
  venom: {
    signature: { key: 'toxicBurst', name: '毒液爆破', unlockLevel: 4, cooldown: 13 },
    ultimate: { key: 'plagueCloud', name: '毒云区', unlockLevel: 8, cooldown: 22 },
    specializations: {
      A: { key: 'spread', name: '有限传播', desc: '毒液爆破范围更大，毒层更易传播', modifiers: { signatureRadius: 1.12, poisonMaxStacks: 1 } },
      B: { key: 'toxin', name: '单体叠层', desc: '毒伤更高，治疗抑制更久', modifiers: { poisonDamagePct: 0.2, healBlockPct: 0.25 } },
    },
  },
  beacon: {
    signature: { key: 'rally', name: '集结号令', unlockLevel: 4, cooldown: 16 },
    ultimate: { key: 'overdrive', name: '超载指令', unlockLevel: 8, cooldown: 25 },
    specializations: {
      A: { key: 'command', name: '火力增益', desc: '光环提高伤害与攻速', modifiers: { auraDamagePct: 0.06, auraRatePct: 0.04 } },
      B: { key: 'tactics', name: '技能循环', desc: '光环内技能冷却更快', modifiers: { auraSkillCooldownPct: 0.1, signatureCooldownPct: -0.08 } },
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
  const scale = towerPerformanceScale(tower.key);
  if (tower.level >= 6) {
    for (const key of Object.keys(values)) {
      if (key.endsWith('Pct')) values[key] *= 1.1;
      if (key === 'signatureRadius') values[key] = 1 + (values[key] - 1) * 1.1;
    }
  }
  for (const key of Object.keys(values)) {
    if (key.endsWith('Pct') || ['armorPenetration', 'critChance', 'signatureDuration'].includes(key)) values[key] *= scale;
    if (key === 'critMultiplier') values[key] = 1 + (values[key] - 1) * scale;
    if (key === 'signatureRadius') values[key] = 1 + (values[key] - 1) * scale;
    if (key === 'slow') values[key] = { pct: values[key].pct * scale, dur: values[key].dur * scale };
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
  const modifiers = specializationModifiers(tower);
  return {
    damageType: s.damageType,
    armorPenetration: s.armorPenetration,
    ignoreArmor: s.ignoreArmor || s.pierce,
    minimumDamage: s.minimumDamage,
    allowZero: s.allowZero,
    targetMask: s.targets,
    sourceTowerId: tower.id,
    sourceTowerKey: tower.key,
    skillTier: tower._castingSkillTier || undefined,
    attackModifiers: {
      eliteDamagePct: modifiers.eliteDamagePct || 0,
      bossDamagePct: modifiers.bossDamagePct || 0,
      slowedDamagePct: modifiers.slowedDamagePct || 0,
      critChance: modifiers.critChance || 0,
      critMultiplier: modifiers.critMultiplier || 0,
    },
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
      ctx.projectiles.spawnHoming(from, target, Math.round(s.dmg * (0.5 + i * 0.08)), s.projSpeed, {
        ...damageOpts(tower), kind: tower.def.proj, pierce: false,
      });
    }
    // G5: 招牌技能双层波纹
    ctx.fx.ring(from, 0.8, 0xd8e8ff, 0.3);
    ctx.fx.ring(from, 1.0, 0xd8e8ff, 0.4);
    ctx.fx.flash(from, 0xd8e8ff, 7, 0.1);
    return true;
  }
  const chosen = targetsInRange(tower, ctx)
    .sort((a, b) => compareScores(targetScore(a), targetScore(b))).slice(0, 4);
  if (!chosen.length) return false;
  const damageMul = 1.0 * (1 + (specializationModifiers(tower).ultimateDamagePct || 0));
  for (const e of chosen) ctx.projectiles.spawnHoming(from, e, Math.round(s.dmg * damageMul), s.projSpeed, {
    ...damageOpts(tower, { damageType: 'physical' }), kind: tower.def.proj,
  });
  // G5: 终极技能冲击波
  ctx.fx.ring(tower.pos, 0.8, 0xffd36a, 0.4);
  ctx.fx.ring(tower.pos, 1.2, 0xffd36a, 0.6);
  ctx.fx.shockwave?.(tower.pos.clone().setY(0.3), 1.2);
  return true;
}

function castVenom(tower, tier, ctx) {
  const s = tower.combatStats();
  const scale = towerPerformanceScale(tower.key);
  const target = tower.acquire(ctx.enemies, ctx);
  if (!target) return false;
  const from = muzzleOf(tower);
  const poison = tower.poisonSpec(tier === 'ultimate' ? 1.5 : 1);
  if (tier === 'signature') {
    ctx.projectiles.spawnHoming(from, target, Math.round(s.dmg * 1.1), s.projSpeed, {
      ...damageOpts(tower, { effects: { poison }, splash: tower.skillRadius(), targetLimit: 4 }), kind: 'venom',
    });
    // G5: 招牌技能双层波纹
    ctx.fx.ring(from, 0.7, 0x8dff79, 0.3);
    ctx.fx.ring(from, 0.9, 0x8dff79, 0.4);
    ctx.fx.flash(from, 0x8dff79, 8, 0.1);
    return true;
  }
  const radius = tower.skillRadius(tier);
  if (!ctx.createPoisonField?.(tower, target.pos, { radius, duration: 5 * scale, poison, targetLimit: 8 })) return false;
  // G5: 终极技能冲击波
  ctx.fx.ring(target.pos, radius * 0.6, 0x75e66f, 0.4);
  ctx.fx.ring(target.pos, radius, 0x75e66f, 0.65);
  ctx.fx.shockwave?.(target.pos.clone().setY(0.3), radius);
  return true;
}

function castBeacon(tower, tier, ctx) {
  const scale = towerPerformanceScale(tower.key);
  const affected = (ctx.queryTowersRadius?.(tower.pos.x, tower.pos.z, tower.combatStats().range) || ctx.towers)
    .filter((other) => !other.disposed && other !== tower && other.key !== 'beacon' &&
      xzDistanceSq(other.pos, tower.pos) <= tower.combatStats().range ** 2);
  if (!affected.length || !affected.some((other) => other.acquire(ctx.enemies, ctx))) return false;
  const duration = (tier === 'signature' ? 5 : 8) * scale;
  const boost = tier === 'signature'
    ? { damagePct: 0.15 * scale, ratePct: 0.1 * scale, skillCooldownPct: 0.06 * scale }
    : { damagePct: 0.25 * scale, ratePct: 0.18 * scale, skillCooldownPct: 0.12 * scale };
  for (const target of affected) target.addTimedBuff(tower.id, ctx.time, duration, boost, tier);
  // G5: 增强特效
  const color = tier === 'signature' ? 0x62d7ff : 0xffd36a;
  const range = tower.combatStats().range;
  if (tier === 'signature') {
    ctx.fx.ring(tower.pos, range * 0.8, color, 0.4);
    ctx.fx.ring(tower.pos, range, color, 0.65);
  } else {
    ctx.fx.ring(tower.pos, range * 0.6, color, 0.4);
    ctx.fx.ring(tower.pos, range, color, 0.75);
    ctx.fx.shockwave?.(tower.pos.clone().setY(0.3), range);
  }
  return true;
}

function castCannon(tower, tier, ctx) {
  const s = tower.combatStats();
  const scale = towerPerformanceScale(tower.key);
  const target = tower.acquire(ctx.enemies, ctx);
  if (!target) return false;
  const from = muzzleOf(tower);
  if (tier === 'signature') {
    // 集束炮击：立即发射 4 枚炮弹
    const dmg = Math.round(s.dmg * 0.45);
    const targetPos = target.pos.clone();
    for (let i = 0; i < 3; i++) {
      const flight = Math.max(0.35, targetPos.distanceTo(from) / (s.projSpeed * (1 + i * 0.15)));
      ctx.projectiles.spawnMortar(from, targetPos, dmg, s.splash, flight, s.targets,
        damageOpts(tower));
    }
    // G5: 招牌技能双层波纹
    ctx.fx.ring(from, 0.7, 0xff9a4a, 0.3);
    ctx.fx.ring(from, 0.9, 0xff9a4a, 0.4);
    ctx.fx.flash(from, 0xff9a4a, 8, 0.12);
    return true;
  }
  // 地毯轰炸：立即发射多枚炮弹到目标区域
  const bombingSite = target.pos.clone();
  const radius = 3.5 * scale;
  const random = ctx.random || Math.random;
  for (let i = 0; i < 6; i++) {
    const offset = new THREE.Vector3(
      (random() - 0.5) * radius * 1.6,
      0,
      (random() - 0.5) * radius * 1.6
    );
    const impactPos = bombingSite.clone().add(offset);
    const flight = Math.max(0.35, impactPos.distanceTo(from) / (s.projSpeed * (1 + i * 0.1)));
    ctx.projectiles.spawnMortar(from, impactPos, Math.round(s.dmg * 0.55), 2.2 * scale, flight, s.targets,
      damageOpts(tower));
  }
  // G5: 终极技能冲击波
  ctx.fx.ring(bombingSite, radius * 0.6, 0xff6a3a, 0.5);
  ctx.fx.ring(bombingSite, radius, 0xff6a3a, 0.7);
  ctx.fx.shockwave?.(bombingSite.clone().setY(0.3), radius);
  return true;
}

function castSniper(tower, tier, ctx) {
  const s = tower.combatStats();
  const scale = towerPerformanceScale(tower.key);
  const target = tower.acquire(ctx.enemies, ctx);
  if (!target) return false;
  const from = muzzleOf(tower);
  if (tier === 'signature') {
    // 弱点狙击：140% 伤害，对精英/Boss 额外加成
    let dmgMul = 1.4;
    const mods = specializationModifiers(tower);
    if (mods.signatureDamagePct) dmgMul += mods.signatureDamagePct;
    if (target.rank === 'elite') dmgMul += 0.15 * scale;
    if (target.def.shape === 'boss') dmgMul += 0.2 * scale;
    const dmg = Math.round(s.dmg * dmgMul);
    ctx.projectiles.spawnHoming(from, target, dmg, s.projSpeed, {
      ...damageOpts(tower, { damageType: mods.trueDamage ? 'true' : 'physical' }),
      kind: tower.def.proj, pierce: true,
    });
    // G5: 招牌技能双层波纹
    ctx.fx.ring(from, 0.6, 0xffea6a, 0.3);
    ctx.fx.ring(from, 0.8, 0xffea6a, 0.4);
    ctx.fx.flash(from, 0xffea6a, 10, 0.15);
    return true;
  }
  // 狙击标记：短时间提高目标承受的伤害
  if (!target.effects) target.effects = {};
  target.effects.marked = {
    sourceTowerId: tower.id,
    until: ctx.time + 6 * scale,
    allDamagePct: 0.12 * scale,
    sniperDamagePct: 0.08 * scale,
  };
  // G5: 终极技能冲击波
  ctx.fx.ring(target.pos, 1.0, 0xff4a6a, 0.4);
  ctx.fx.ring(target.pos, 1.5, 0xff4a6a, 0.6);
  ctx.fx.shockwave?.(target.pos.clone().setY(0.3), 1.5);
  return true;
}

function castTesla(tower, tier, ctx) {
  const s = tower.combatStats();
  const scale = towerPerformanceScale(tower.key);
  if (tier === 'signature') {
    // 过载：短时间提高攻速，但单次攻击略微减伤
    const mods = specializationModifiers(tower);
    const duration = 2.5 * scale + (mods.signatureDuration || 0);
    tower.overloadUntil = ctx.time + duration;
    tower.overloadRate = 1 + 0.65 * scale;
    tower.overloadDamageMul = 0.75;
    // G5: 招牌技能双层波纹
    ctx.fx.ring(tower.pos, 1.0, 0x6aaaff, 0.3);
    ctx.fx.ring(tower.pos, 1.2, 0x6aaaff, 0.5);
    return true;
  }
  // 电磁脉冲：范围伤害 + 减速
  const radius = 3.8 * scale;
  const targets = targetsInRange(tower, ctx, radius);
  if (!targets.length) return false;
  for (const e of targets) {
    ctx.hitEnemy(e, Math.round(s.dmg * 1.4), {
      ...damageOpts(tower),
      effects: { slow: { pct: 0.55 * scale, dur: 2 * scale } },
    });
  }
  // G5: 终极技能冲击波
  ctx.fx.ring(tower.pos, radius * 0.6, 0x3a8aff, 0.5);
  ctx.fx.ring(tower.pos, radius, 0x3a8aff, 0.8);
  ctx.fx.shockwave?.(tower.pos.clone().setY(0.3), radius);
  return true;
}

function castFrost(tower, tier, ctx) {
  const s = tower.combatStats();
  const scale = towerPerformanceScale(tower.key);
  if (tier === 'signature') {
    // 冰环新星：扩大范围的减速 + 伤害
    const mods = specializationModifiers(tower);
    const radius = s.range + 0.6 * scale;
    const slowPct = s.slow.pct + 0.07 * scale + (mods.signatureSlowPct || 0);
    const slowDur = s.slow.dur + 0.8 * scale;
    const targets = targetsInRange(tower, ctx, radius);
    for (const e of targets) {
      ctx.hitEnemy(e, Math.round(s.dmg * 0.4), {
        ...damageOpts(tower),
        effects: { slow: { pct: Math.min(0.95, slowPct), dur: slowDur } },
      });
    }
    // G5: 招牌技能双层波纹
    ctx.fx.ring(tower.pos, radius * 0.8, 0x6ad4ff, 0.4);
    ctx.fx.ring(tower.pos, radius, 0x6ad4ff, 0.7);
    return true;
  }
  // 极寒领域：立即对目标区域造成范围伤害和减速
  const target = tower.acquire(ctx.enemies, ctx);
  if (!target) return false;
  const fieldPos = target.pos.clone();
  const radius = 3.4 * scale;
  const nearby = ctx.queryEnemiesRadius(fieldPos.x, fieldPos.z, radius, (e) => e.alive);
  if (!nearby.length) return false;
  for (const e of nearby) {
    ctx.hitEnemy(e, Math.round(s.dmg * 1.5), {
      ...damageOpts(tower),
      effects: { slow: { pct: 0.54 * scale, dur: 4 * scale } },
    });
    // 极寒领域增伤效果：被冰冻的敌人短时间受到额外伤害
    if (!e.effects) e.effects = {};
    e.effects.frostVulnerable = {
      sourceTowerId: tower.id,
      until: ctx.time + 4 * scale,
      allDamagePct: 0.1 * scale,
    };
  }
  // G5: 终极技能冲击波
  ctx.fx.ring(fieldPos, radius * 0.6, 0x3aa4ff, 0.5);
  ctx.fx.ring(fieldPos, radius, 0x3aa4ff, 0.8);
  ctx.fx.shockwave?.(fieldPos.clone().setY(0.3), radius);
  return true;
}

export function castSkill(tower, tier, ctx) {
  if (!canUseSkill(tower, tier) || ctx.state !== 'combat' || ctx.paused) return false;
  const casters = {
    arrow: castArrow, cannon: castCannon, sniper: castSniper,
    tesla: castTesla, frost: castFrost, venom: castVenom, beacon: castBeacon,
  };
  let ok = false;
  tower._castingSkillTier = tier;
  try {
    ok = casters[tower.key]?.(tower, tier, ctx) ?? false;
  } finally {
    delete tower._castingSkillTier;
  }
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
