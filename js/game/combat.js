// 战斗基础协议：目标资格、X/Z 平面距离、目标威胁评分和可审计伤害结算。
export function xzDistanceSq(a, b) {
  if (!a || !b) return Infinity;
  const dx = a.x - b.x, dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function targetMatches(mask = 'both', enemy) {
  if (!enemy?.alive) return false;
  if (mask === 'air') return !!enemy.def?.fly;
  if (mask === 'ground') return !enemy.def?.fly;
  return true;
}

export function remainingDistance(enemy) {
  return Math.max(0, (enemy?.sampler?.total ?? 0) - (enemy?.dist ?? 0));
}

export function estimatedExitTime(enemy) {
  const speed = Math.max(0.01, enemy?.effectiveSpeed ?? enemy?.baseSpeed ?? enemy?.def?.speed ?? 1);
  return remainingDistance(enemy) / speed;
}

export function targetScore(enemy, priority = 'threat') {
  const remaining = remainingDistance(enemy), eta = estimatedExitTime(enemy);
  switch (priority) {
    case 'weakest': return [enemy.hp + (enemy.shield ?? 0), eta, enemy.id ?? 0];
    case 'strongest': return [-(enemy.hp + (enemy.shield ?? 0)), eta, enemy.id ?? 0];
    case 'fastest': return [-(enemy.effectiveSpeed ?? enemy.baseSpeed ?? 0), eta, enemy.id ?? 0];
    case 'support': return [enemy.def?.heal || enemy.def?.splitInto || enemy.def?.deathSpawn ? 0 : 1, eta, enemy.id ?? 0];
    case 'progress': return [remaining, eta, enemy.id ?? 0];
    case 'threat':
    default: return [eta, remaining, enemy.id ?? 0];
  }
}

export function compareScores(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0, bv = b[i] ?? 0;
    if (av !== bv) return av < bv ? -1 : 1;
  }
  return 0;
}

export function resolveDamage({ hp, shield = 0, armor = 0, raw = 0,
  ignoreArmor = false, armorPenetration = 0, minimumDamage = 1, allowZero = false,
  resistance = 0, damageType = 'physical' } = {}) {
  const safeHp = Math.max(0, Number(hp) || 0), safeShield = Math.max(0, Number(shield) || 0);
  const safeRaw = Math.max(0, Number(raw) || 0), min = allowZero ? 0 : Math.max(0, Number(minimumDamage) || 0);
  const type = String(damageType || 'physical').toLowerCase();
  let effective = safeRaw;
  if (type === 'true') {
    effective = safeRaw;
  } else if (type === 'magic' || type === 'spell') {
    const resist = Math.min(1, Math.max(0, Number(resistance) || 0));
    effective = Math.max(min, safeRaw * (1 - resist));
  } else {
    const pen = Math.min(1, Math.max(0, Number(armorPenetration) || 0));
    const armorValue = Math.max(0, (Number(armor) || 0) * (1 - pen));
    effective = ignoreArmor ? safeRaw : Math.max(min, safeRaw - armorValue);
  }
  if (safeRaw <= 0) effective = 0;
  const incoming = Math.max(0, effective), shieldDamage = Math.min(safeShield, incoming);
  const hpDamage = Math.min(safeHp, Math.max(0, incoming - shieldDamage));
  return { rawDamage: safeRaw, shieldDamage, hpDamage, totalDamage: shieldDamage + hpDamage,
    overkill: Math.max(0, incoming - shieldDamage - hpDamage), killed: hpDamage >= safeHp && safeHp > 0, damageType: type };
}
