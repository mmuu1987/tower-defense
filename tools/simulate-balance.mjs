// tools/simulate-balance.mjs - 50 关技能平衡模拟器（G6 M1）
import * as THREE from 'three';
import { Battle } from '../js/game/battle.js';
import { buildLevel } from '../js/game/levelgen.js';
import { createMapLayout } from '../js/game/map-layout.js';
import { makePathSampler } from '../js/game/entities.js';
import { TOWER_DEFS } from '../js/game/towers.js';
import { writeFileSync } from 'fs';

const fx = Object.fromEntries(['update','flash','ring','spark','burst','lightning','beam','decal','shockwave'].map(k=>[k,()=>{}]));

// 固定建造策略：每个地图恰好放置 7 座塔（每种各 1 座）
function autoPlace(battle) {
  const towers = ['arrow','cannon','sniper','tesla','frost','venom','beacon'];
  const placed = [];

  // 为每种塔类型各放置 1 座
  for (const key of towers) {
    let attempts = 0;
    while (attempts < 50) {
      attempts++;
      const cx = Math.floor(Math.random() * 42);
      const cz = Math.floor(Math.random() * 28);

      if (!battle.isBuildable(cx, cz)) continue;
      battle.selectBuild(key);
      if (battle.tryPlace(cx, cz) === true) {
        placed.push(battle.selectedTower);
        battle.gold += TOWER_DEFS[key].cost;
        break;  // 成功放置后跳出循环
      }
    }
  }

  // 升级到 Lv.8 + 随机专精
  for(const t of placed) {
    while(t.level < 7) {
      const branch = Math.random() > 0.5 ? 'A' : 'B';
      battle.upgradeTower(t, t.requiresSpecialization() ? branch : null);
      battle.gold += t.upgradeCost();
    }
  }

  return placed;
}

// 运行单关
async function runLevel(worldIdx, lvlIdx) {
  const level = buildLevel(worldIdx, lvlIdx);
  const layout = createMapLayout(level.map);
  const samplers = layout.routes.map(makePathSampler);

  const stats = { towers: {}, waves: 0, win: false, time: 0 };

  const battle = new Battle({
    scene: new THREE.Scene(),
    level,
    sampler: samplers[0],
    samplers,
    pathCells: layout.pathCells,
    blockedCells: layout.blockedCells,
    heightAt: layout.heightAt,
    fx,
    hooks: { camera: new THREE.PerspectiveCamera() }
  });

  // 追踪技能数据和伤害
  const skillDamage = {};
  const originalHit = battle.hitEnemy.bind(battle);
  battle.hitEnemy = (enemy, damage, opts) => {
    if(opts?.sourceTowerId) {
      const tower = battle.towers.find(t => t.id === opts.sourceTowerId);
      if(tower && battle._activeSkill) {
        const key = tower.key + ':' + battle._activeSkill;
        skillDamage[key] = (skillDamage[key] || 0) + damage;
      }
    }
    return originalHit(enemy, damage, opts);
  };

  const onSkill = (tower, tier) => {
    const key = tower.key;
    if(!stats.towers[key]) stats.towers[key] = { sig: 0, ult: 0, sigDmg: 0, ultDmg: 0, casts: 0 };
    battle._activeSkill = tier;
    if(tier === 'signature') stats.towers[key].sig++;
    else stats.towers[key].ult++;
    stats.towers[key].casts++;
    setTimeout(() => { battle._activeSkill = null; }, 100);
  };
  battle.hooks.onSkill = onSkill;

  const towers = autoPlace(battle);

  // 模拟战斗
  while(battle.state !== 'won' && battle.state !== 'lost' && battle.time < 1800) {
    if(battle.state === 'build') battle.startWave();
    battle.update(1/60);
  }

  stats.win = battle.state === 'won';
  stats.waves = battle.waveIdx + 1;
  stats.time = battle.time;
  stats.kills = battle.kills;
  stats.leaks = battle.leaks;

  // 汇总技能伤害
  for(const [key, dmg] of Object.entries(skillDamage)) {
    const [towerKey, tier] = key.split(':');
    if(stats.towers[towerKey]) {
      if(tier === 'signature') stats.towers[towerKey].sigDmg = dmg;
      else stats.towers[towerKey].ultDmg = dmg;
    }
  }

  battle.destroy();
  return stats;
}

// 运行全部 50 关
async function runAll() {
  const results = [];

  for(let w = 0; w < 5; w++) {
    for(let l = 0; l < 10; l++) {
      const idx = w * 10 + l;
      process.stdout.write(`\r运行关卡 ${idx+1}/50: W${w+1}-${l+1} `);

      const stats = await runLevel(w, l);
      results.push({ world: w+1, level: l+1, ...stats });
    }
  }

  console.log('\n\n=== 模拟完成 ===\n');

  // 汇总统计
  const summary = { total: 50, wins: 0, losses: 0, byTower: {} };

  for(const r of results) {
    if(r.win) summary.wins++; else summary.losses++;

    for(const [key, data] of Object.entries(r.towers)) {
      if(!summary.byTower[key]) summary.byTower[key] = { sig: 0, ult: 0, sigDmg: 0, ultDmg: 0, total: 0, levels: 0 };
      summary.byTower[key].sig += data.sig;
      summary.byTower[key].ult += data.ult;
      summary.byTower[key].total += data.casts;
      summary.byTower[key].levels++;
      summary.byTower[key].sigDmg += data.sigDmg || 0;
      summary.byTower[key].ultDmg += data.ultDmg || 0;
    }
  }

  console.log(`胜率: ${summary.wins}/50 (${(summary.wins/50*100).toFixed(1)}%)\n`);
  console.log('技能使用统计:\n');

  for(const [key, data] of Object.entries(summary.byTower)) {
    const avgSig = (data.sig / data.levels).toFixed(1);
    const avgSigDmg = (data.sigDmg / data.levels).toFixed(0);
    const avgUltDmg = (data.ultDmg / data.levels).toFixed(0);
    const avgUlt = (data.ult / data.levels).toFixed(1);
    console.log(`${key.padEnd(8)} - 招牌: ${avgSig.padStart(5)}/关 (${avgSigDmg.padStart(6)}伤)  终极: ${avgUlt.padStart(5)}/关 (${avgUltDmg.padStart(6)}伤)`);
  }

  return { results, summary };
}

// 执行
runAll().then(data => {
  console.log('\n数据已保存到 tools/balance-report.json');
  writeFileSync('balance-report.json', JSON.stringify(data, null, 2));
}).catch(err => {
  console.error('模拟失败:', err);
  process.exit(1);
});

