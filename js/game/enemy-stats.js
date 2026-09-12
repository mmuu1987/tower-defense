// Enemy templates become immutable spawn snapshots here, before entering battle.
import { ENEMY_DEFS, BOSS_DEFS } from './units.js';

export const ENEMY_RANKS = {
  normal: { name: '普通', color: '#d5e4dc' },
  elite: { name: '精英', color: '#ffd375' },
  boss: { name: 'Boss', color: '#ff8580' },
};
export const AFFIX_DEFS = {
  armored: { name: '重甲', armor: 7 },
  shielded: { name: '护盾', shieldPct: 0.3 },
  swift: { name: '疾行', speedPct: 0.18 },
  regenerating: { name: '再生', regenPct: 0.008 },
  resilient: { name: '坚韧', controlResistance: 0.35, resistance: 0.12 },
};
export const MAX_ENEMY_LEVEL = 100;
export const MAX_SUMMON_GENERATION = 1;
export const MAX_FAMILY_CHILDREN = 8;
export const enemyDefinition = (type) => ENEMY_DEFS[type] || BOSS_DEFS[type] || null;

export function enemyProfile(type, { enemyLevel = 1, rank = BOSS_DEFS[type] ? 'boss' : 'normal', affixes = [] } = {}) {
  const def = enemyDefinition(type);
  if (!def || !Number.isInteger(enemyLevel) || enemyLevel < 1 || enemyLevel > MAX_ENEMY_LEVEL || !ENEMY_RANKS[rank]) throw new Error('Invalid enemy profile');
  if ((rank === 'boss') !== !!BOSS_DEFS[type] || !Array.isArray(affixes) || affixes.length > 2 ||
      new Set(affixes).size !== affixes.length || affixes.some((key) => !AFFIX_DEFS[key]) ||
      (affixes.length && rank !== 'elite') || (affixes.includes('shielded') && affixes.includes('regenerating'))) throw new Error('Invalid rank or affix combination');
  const n = enemyLevel - 1;
  const growth = 1 + n * 0.045 + n * n * 0.00038;
  const hp = Math.max(1, Math.round(def.hp * growth * (rank === 'elite' ? 1.6 : 1)));
  const result = {
    type, enemyLevel, rank, affixes: [...affixes], hp,
    armor: Math.min(24, (def.armor || 0) + n * 0.04),
    resistance: Math.min(0.3, (def.resistance || 0) + n * 0.0008),
    speed: def.speed * (1 + Math.min(0.18, n * 0.0018)),
    controlResistance: rank === 'boss' ? 0.4 : rank === 'elite' ? 0.1 : 0,
    regen: 0,
    heal: def.heal ? { radius: def.heal.radius, hps: def.heal.hps * (1 + n * 0.025) } : null,
    shield: def.shield ? { hp: Math.round(def.shield.hp * growth), cd: def.shield.cd } : null,
    rewardWeight: def.reward * (1 + n * 0.008) * (rank === 'elite' ? 1.8 : rank === 'boss' ? 2 : 1),
  };
  for (const key of affixes) {
    const mod = AFFIX_DEFS[key];
    result.armor = Math.min(24, result.armor + (mod.armor || 0));
    result.resistance = Math.min(0.45, result.resistance + (mod.resistance || 0));
    if (mod.shieldPct) result.shield = { hp: Math.round(hp * mod.shieldPct), cd: 9 };
    if (mod.speedPct) result.speed *= 1 + mod.speedPct;
    if (mod.regenPct) result.regen = hp * mod.regenPct;
    result.controlResistance = Math.max(result.controlResistance, mod.controlResistance || 0);
  }
  return result;
}

export function childProfiles(profile, generation = 0) {
  if (generation >= MAX_SUMMON_GENERATION) return [];
  const def = enemyDefinition(profile.type);
  const spawn = def?.splitInto || def?.deathSpawn;
  if (!spawn || !enemyDefinition(spawn.type)) return [];
  return Array.from({ length: Math.min(MAX_FAMILY_CHILDREN, spawn.count) }, () => {
    const child = enemyProfile(spawn.type, { enemyLevel: profile.enemyLevel });
    child.hp = Math.max(1, Math.round(child.hp * (spawn.hpMul ?? 0.5)));
    return child;
  });
}

export function enemyThreat(profile, includeChildren = true) {
  const def = enemyDefinition(profile.type);
  const durability = (profile.hp + (profile.shield?.hp || 0)) * (1 + profile.armor / 60) / (1 - profile.resistance);
  const mobility = Math.pow(profile.speed / 1.5, 0.45) * (def.fly ? 1.2 : 1);
  const utility = (profile.heal ? 1.3 : 1) * (profile.regen > 0 ? 1.2 : 1) * (1 + profile.controlResistance * 0.12);
  const children = includeChildren ? childProfiles(profile).reduce((sum, child) => sum + enemyThreat(child, false), 0) : 0;
  return Math.round((durability / 52 * mobility * utility + children) * 1000) / 1000;
}

export function affixesFor(difficulty, wave, seed) {
  const keys = Object.keys(AFFIX_DEFS);
  // Regeneration arrives after poison and healing suppression are available.
  const pool = difficulty < 8 ? keys.filter((key) => key !== 'regenerating') : keys;
  const first = pool[(seed + wave * 7) % pool.length];
  if (difficulty < 35) return [first];
  const second = pool[(seed + wave * 7 + 2) % pool.length];
  if ([first, second].includes('regenerating') && [first, second].includes('shielded')) return [first];
  return [first, second];
}
