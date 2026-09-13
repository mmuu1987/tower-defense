// Each poison layer owns its damage snapshot and expiry.
export const POISON_TICK = 0.75;
export const MAX_POISON_STACKS = 8;
const TIMED_DAMAGE_EFFECTS = ['marked', 'frostVulnerable'];

export function damageAmplification(target, time = 0, sourceTowerKey = null) {
  if (!target?.effects) return 1;
  let bonus = 0;
  for (const key of TIMED_DAMAGE_EFFECTS) {
    const effect = target.effects[key];
    if (!effect) continue;
    if (!Number.isFinite(effect.until) || effect.until <= time) {
      delete target.effects[key];
      continue;
    }
    bonus += Math.max(0, Number(effect.allDamagePct) || 0);
    if (key === 'marked' && sourceTowerKey === 'sniper') {
      bonus += Math.max(0, Number(effect.sniperDamagePct) || 0);
    }
  }
  return 1 + Math.min(3, bonus);
}

export function applyPoison(target, { damage = 2, duration = 3, stacks = 1, maxStacks = 4, healBlock = 0,
  sourceTowerId = null, sourceTowerKey = null, skillTier = null } = {}) {
  if (!target?.alive || target.hp <= 0 || ![damage, duration, stacks, maxStacks, healBlock].every(Number.isFinite) ||
      damage <= 0 || duration <= 0 || maxStacks < 1 || stacks < 1 || target.def?.fly) return false;
  target.effects ||= {};
  const poison = target.effects.poison ||= { layers: [] };
  const cap = Math.min(MAX_POISON_STACKS, Math.floor(maxStacks));
  for (let i = 0; i < Math.min(cap, Math.floor(stacks)); i++) {
    const layer = { damage, remaining: Math.min(12, duration), tick: POISON_TICK,
      sourceTowerId, sourceTowerKey, skillTier };
    if (poison.layers.length < cap) poison.layers.push(layer);
    else {
      const weakest = poison.layers.reduce((best, p, index, layers) =>
        p.damage < layers[best].damage || (p.damage === layers[best].damage && p.remaining < layers[best].remaining) ? index : best, 0);
      if (damage >= poison.layers[weakest].damage) {
        layer.tick = poison.layers[weakest].tick;
        poison.layers[weakest] = layer;
      }
    }
  }
  target.healSuppressedT = Math.max(target.healSuppressedT || 0, Math.min(8, Math.max(0, healBlock)));
  return true;
}

export function updateEffects(target, dt, ctx) {
  if (!target?.alive || !Number.isFinite(dt) || dt <= 0) return;
  target.healSuppressedT = Math.max(0, (target.healSuppressedT || 0) - dt);
  damageAmplification(target, ctx?.time ?? 0);
  const poison = target.effects?.poison;
  if (!poison) return;
  const damageBySource = new Map();
  for (const layer of poison.layers) {
    const activeTime = Math.min(dt, layer.remaining);
    layer.remaining = Math.max(0, layer.remaining - dt);
    layer.tick -= activeTime;
    while (layer.tick <= 1e-9) {
      const key = `${layer.sourceTowerId ?? ''}|${layer.sourceTowerKey ?? ''}|${layer.skillTier ?? ''}`;
      const entry = damageBySource.get(key) || { damage: 0, sourceTowerId: layer.sourceTowerId,
        sourceTowerKey: layer.sourceTowerKey, skillTier: layer.skillTier };
      entry.damage += layer.damage;
      damageBySource.set(key, entry);
      layer.tick += POISON_TICK;
    }
  }
  for (const entry of damageBySource.values()) {
    if (!target.alive) break;
    ctx.hitEnemy(target, entry.damage, { damageType: 'magic', minimumDamage: 0, allowZero: true,
      sourceTowerId: entry.sourceTowerId, sourceTowerKey: entry.sourceTowerKey, skillTier: entry.skillTier });
  }
  poison.layers = poison.layers.filter((p) => p.remaining > 1e-9);
  if (!poison.layers.length || !target.alive) delete target.effects.poison;
}

export function clearEffects(target) {
  if (!target) return;
  target.effects = {};
  target.healSuppressedT = 0;
}

export function poisonStacks(target) { return target?.effects?.poison?.layers.length || 0; }
