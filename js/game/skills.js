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

export function castSkill(tower, tier, ctx) {
  if (!canUseSkill(tower, tier) || ctx.state !== 'combat' || ctx.paused) return false;
  const ok = tower.key === 'arrow'
    ? castArrow(tower, tier, ctx)
    : tower.key === 'venom'
      ? castVenom(tower, tier, ctx)
      : tower.key === 'beacon'
        ? castBeacon(tower, tier, ctx)
        : false;
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
