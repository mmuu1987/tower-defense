// Each poison layer owns its damage snapshot and expiry.
export const POISON_TICK = 0.75;
export const MAX_POISON_STACKS = 8;

export function applyPoison(target, { damage = 2, duration = 3, stacks = 1, maxStacks = 4, healBlock = 0 } = {}) {
  if (!target?.alive || target.hp <= 0 || ![damage, duration, stacks, maxStacks, healBlock].every(Number.isFinite) ||
      damage <= 0 || duration <= 0 || maxStacks < 1 || stacks < 1 || target.def?.fly) return false;
  target.effects ||= {};
  const poison = target.effects.poison ||= { layers: [] };
  const cap = Math.min(MAX_POISON_STACKS, Math.floor(maxStacks));
  for (let i = 0; i < Math.min(cap, Math.floor(stacks)); i++) {
    const layer = { damage, remaining: Math.min(12, duration), tick: POISON_TICK };
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
  const poison = target.effects?.poison;
  if (!poison) return;
  let damage = 0;
  for (const layer of poison.layers) {
    const activeTime = Math.min(dt, layer.remaining);
    layer.remaining = Math.max(0, layer.remaining - dt);
    layer.tick -= activeTime;
    while (layer.tick <= 1e-9) {
      damage += layer.damage;
      layer.tick += POISON_TICK;
    }
  }
  if (damage > 0) ctx.hitEnemy(target, damage, { damageType: 'magic', minimumDamage: 0, allowZero: true });
  poison.layers = poison.layers.filter((p) => p.remaining > 1e-9);
  if (!poison.layers.length || !target.alive) delete target.effects.poison;
}

export function clearEffects(target) {
  if (!target) return;
  target.effects = {};
  target.healSuppressedT = 0;
}

export function poisonStacks(target) { return target?.effects?.poison?.layers.length || 0; }
