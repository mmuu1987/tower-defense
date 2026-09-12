// Deterministic wave generation: profiles and budgets are fixed before spawning.
import { BOSS_DEFS } from './units.js';
import { mapForLevel } from './maps.js';
import { enemyProfile, enemyThreat, affixesFor } from './enemy-stats.js';
import { allocateBudget } from './economy.js';

export const BALANCE = {
  startGoldBase: 400,
  startGoldPerWorld: 220,
  startGoldPerLvl: 30,
  extraRouteGold: 140,
  incomeBase: 120,
  incomePerDifficulty: 30,
  incomePerWave: 24,
  incomeWaveDifficulty: 1.2,
  bountyFraction: 0.62,
  earlyFraction: 0.15,
  threatScale: 1,
  economyScale: 1,
  enemyLevelOffset: 0,
};

export function buildLevel(worldIdx, lvlIdx, overrides = {}) {
  if (!Number.isInteger(worldIdx) || worldIdx < 0 || worldIdx > 4 || !Number.isInteger(lvlIdx) || lvlIdx < 0 || lvlIdx > 9) throw new Error('Invalid level coordinates');
  for (const [key, value] of Object.entries(overrides)) if (!(key in BALANCE) || !Number.isFinite(value)) throw new Error('Unknown or invalid balance option: ' + key);
  const cfg = { ...BALANCE, ...overrides };
  if (Object.values(cfg).some((v) => !Number.isFinite(v)) || cfg.threatScale <= 0 || cfg.economyScale <= 0 ||
      cfg.bountyFraction < 0 || cfg.bountyFraction > 1 || cfg.earlyFraction < 0 || cfg.earlyFraction > 0.15 ||
      Object.entries(cfg).some(([key, v]) => key !== 'enemyLevelOffset' && v < 0)) throw new Error('Invalid balance parameters');
  const d = worldIdx * 10 + lvlIdx;
  const map = mapForLevel(worldIdx, lvlIdx);
  const routeCount = map.routes.length;
  const waveCount = 6 + Math.floor(d / 4.5);
  const baseEnemyLevel = Math.max(1, Math.min(100, 1 + Math.floor(d * 1.8) + Math.trunc(cfg.enemyLevelOffset)));
  const unlocks = [['grunt', 0], ['runner', 2], ['tank', 4], ['flyer', 5], ['healer', 8], ['splitter', 12],
    ['fox', 13], ['flamingo', 15], ['mummy', 17], ['stork', 19], ['dancer', 21]];
  const pool = unlocks.filter(([, at]) => d >= at).map(([type]) => type);
  const starterPool = d >= 2 ? ['grunt', 'runner'] : ['grunt'];
  const waves = [];
  for (let w = 0; w < waveCount; w++) {
    const level = Math.min(100, baseEnemyLevel + Math.floor(w * 0.7));
    const boss = lvlIdx === 9 && w === waveCount - 1;
    const active = w < 2 ? starterPool : pool;
    const main = w === 0 ? starterPool[lvlIdx % starterPool.length] : active[Math.floor(w * 0.7 + lvlIdx) % active.length];
    const sub = active[(w + lvlIdx + 1) % active.length];
    const standard = enemyProfile('grunt', { enemyLevel: level });
    const slots = Math.max(4, Math.round((5 + w * 0.8 + lvlIdx * 0.4) * (1 + d * 0.017) * (w < 3 ? 0.7 + w * 0.1 : 1)));
    const baseThreat = enemyThreat(standard) * (slots + (w % 2 ? Math.round(slots * 0.25) : 0)) * cfg.threatScale;
    const bossProfile = boss ? enemyProfile(Object.keys(BOSS_DEFS)[worldIdx], { enemyLevel: Math.min(100, level + 2) }) : null;
    const threatBudget = Math.ceil((boss ? enemyThreat(bossProfile) + baseThreat * 0.7 : baseThreat) * 1000) / 1000;
    const income = Math.round((cfg.incomeBase + d * cfg.incomePerDifficulty + w * (cfg.incomePerWave + d * cfg.incomeWaveDifficulty)) * cfg.economyScale);
    const bounty = Math.floor(income * cfg.bountyFraction);
    const budget = { threat: threatBudget, income, bounty, clear: income - bounty, early: Math.floor(income * cfg.earlyFraction) };
    let remaining = threatBudget;
    const groups = [];
    const add = (profile, count, gap, delay) => {
      const cost = enemyThreat(profile);
      count = Math.min(count, Math.floor((remaining + 1e-7) / cost));
      if (count <= 0) return;
      groups.push({ type: profile.type, count, gap, delay, profile, threat: cost * count });
      remaining = Math.max(0, remaining - cost * count);
    };
    if (boss) add(bossProfile, 1, 0, 0.8);
    else if (d >= 6 && w >= 2 && (w === Math.floor(waveCount / 2) || (d >= 20 && w % 3 === 2))) {
      const elite = enemyProfile(main, { enemyLevel: Math.min(100, level + 1), rank: 'elite', affixes: affixesFor(d, w, map.seed) });
      if (remaining >= enemyThreat(elite) + enemyThreat(standard) * 2) add(elite, d >= 30 ? 2 : 1, 2.2, 4);
    }
    const mainProfile = enemyProfile(boss ? starterPool[starterPool.length - 1] : main, { enemyLevel: level });
    const mainCost = enemyThreat(mainProfile);
    const mixed = !boss && w % 2 === 1 && sub !== main;
    const gap = Math.max(0.7, 1.15 - w * 0.025) + (w < 2 ? (2 - w) * 0.2 : 0);
    if (remaining >= mainCost) add(mainProfile, Math.max(1, Math.floor(remaining * (mixed ? 0.72 : 1) / mainCost)), gap, boss ? 3 : 0.5);
    if (mixed) {
      const subProfile = enemyProfile(sub, { enemyLevel: level });
      add(subProfile, Math.floor(remaining / enemyThreat(subProfile)), 0.95, 5.5);
    }
    if (!groups.length) add(standard, 1, gap, 0.5);
    // Small residual budgets remain unspent rather than creating an extra pressure spike.
    const tickets = [];
    groups.forEach((g, gi) => { for (let i = 0; i < g.count; i++) tickets.push({ group: gi, unit: i, weight: g.profile.rewardWeight }); });
    const shares = allocateBudget(bounty, tickets.map((ticket) => ticket.weight));
    const routes = Array(routeCount).fill(0);
    groups.forEach((g, gi) => {
      g.id = 'wave-' + w + ':group-' + gi;
      g.bounties = []; g.routes = [];
    });
    tickets.forEach((ticket, i) => {
      const group = groups[ticket.group];
      const route = (i + w) % routeCount;
      group.bounties.push(shares[i]); group.routes.push(route); routes[route]++;
    });
    waves.push({ groups, boss, budget, threatSpent: threatBudget - remaining, routeCounts: routes,
      levelRange: [Math.min(...groups.map((g) => g.profile.enemyLevel)), Math.max(...groups.map((g) => g.profile.enemyLevel))],
      duration: Math.max(...groups.map((g) => g.delay + (g.count - 1) * g.gap)) });
  }
  return {
    worldIdx, lvlIdx, name: (worldIdx + 1) + '-' + (lvlIdx + 1) + ' · ' + map.name,
    map, waves, baseEnemyLevel, schemaVersion: 3,
    startGold: Math.round(cfg.startGoldBase + worldIdx * cfg.startGoldPerWorld + lvlIdx * cfg.startGoldPerLvl + (routeCount - 1) * cfg.extraRouteGold),
    lives: 20, intermission: 6, unlockPool: pool,
    budget: { income: waves.reduce((sum, wave) => sum + wave.budget.income, 0),
      bounty: waves.reduce((sum, wave) => sum + wave.budget.bounty, 0), clear: waves.reduce((sum, wave) => sum + wave.budget.clear, 0) },
  };
}

export function starsFor(lives, maxLives) {
  const r = lives / maxLives;
  if (r >= 0.999) return 3;
  if (r >= 0.5) return 2;
  return 1;
}
