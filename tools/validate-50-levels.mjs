// 验证 50 关数据生成的完整性和正确性
import { buildLevel } from '../js/game/levelgen.js';

const errors = [];
const warnings = [];
const stats = {
  levels: 0,
  waves: 0,
  groups: 0,
  enemies: 0,
  elites: 0,
  bosses: 0,
  affixes: new Set(),
  types: new Set(),
  totalIncome: 0,
  totalBounty: 0,
};

console.log('验证 50 关数据生成...\n');

for (let w = 0; w < 5; w++) {
  for (let l = 0; l < 10; l++) {
    const levelId = `${w}-${l}`;
    try {
      const level = buildLevel(w, l);
      stats.levels++;
      
      // 验证基础数据
      if (!Number.isFinite(level.startGold) || level.startGold < 0) {
        errors.push(`${levelId}: 无效的起始金币 ${level.startGold}`);
      }
      if (!Number.isFinite(level.lives) || level.lives <= 0) {
        errors.push(`${levelId}: 无效的生命值 ${level.lives}`);
      }
      if (!Array.isArray(level.waves) || level.waves.length === 0) {
        errors.push(`${levelId}: 无效的波次数据`);
        continue;
      }
      
      stats.waves += level.waves.length;
      stats.totalIncome += level.budget.income;
      stats.totalBounty += level.budget.bounty;
      
      // 验证每一波
      for (let wi = 0; wi < level.waves.length; wi++) {
        const wave = level.waves[wi];
        const waveId = `${levelId} wave ${wi}`;
        
        if (!Array.isArray(wave.groups) || wave.groups.length === 0) {
          errors.push(`${waveId}: 无 groups 数据`);
          continue;
        }
        
        stats.groups += wave.groups.length;
        
        // 验证每个组
        for (let gi = 0; gi < wave.groups.length; gi++) {
          const group = wave.groups[gi];
          const groupId = `${waveId} group ${gi}`;
          
          // 检查 profile
          if (!group.profile) {
            errors.push(`${groupId}: 缺少 profile`);
            continue;
          }
          
          const p = group.profile;
          
          // 验证 profile 必需字段
          if (!p.type) errors.push(`${groupId}: profile 缺少 type`);
          if (!Number.isFinite(p.hp) || p.hp <= 0) errors.push(`${groupId}: 无效的 hp ${p.hp}`);
          if (!Number.isFinite(p.armor) || p.armor < 0) errors.push(`${groupId}: 无效的 armor ${p.armor}`);
          if (!Number.isFinite(p.resistance) || p.resistance < 0) errors.push(`${groupId}: 无效的 resistance ${p.resistance}`);
          if (!Number.isFinite(p.speed) || p.speed <= 0) errors.push(`${groupId}: 无效的 speed ${p.speed}`);
          if (!Number.isInteger(p.enemyLevel) || p.enemyLevel < 1 || p.enemyLevel > 100) {
            errors.push(`${groupId}: 无效的 enemyLevel ${p.enemyLevel}`);
          }
          if (!['normal', 'elite', 'boss'].includes(p.rank)) {
            errors.push(`${groupId}: 无效的 rank ${p.rank}`);
          }
          if (!Array.isArray(p.affixes)) {
            errors.push(`${groupId}: affixes 不是数组`);
          }
          
          // 统计
          stats.enemies += group.count;
          if (p.rank === 'elite') stats.elites++;
          if (p.rank === 'boss') stats.bosses++;
          stats.types.add(p.type);
          p.affixes.forEach(a => stats.affixes.add(a));
          
          // 验证 bounties 和 routes
          if (!Array.isArray(group.bounties) || group.bounties.length !== group.count) {
            errors.push(`${groupId}: bounties 数量不匹配 (${group.bounties?.length} vs ${group.count})`);
          }
          if (!Array.isArray(group.routes) || group.routes.length !== group.count) {
            errors.push(`${groupId}: routes 数量不匹配 (${group.routes?.length} vs ${group.count})`);
          }
          
          // 验证 bounties 是有效整数
          if (group.bounties) {
            for (let i = 0; i < group.bounties.length; i++) {
              if (!Number.isSafeInteger(group.bounties[i]) || group.bounties[i] < 0) {
                errors.push(`${groupId}: bounties[${i}] 无效 (${group.bounties[i]})`);
              }
            }
          }
          
          // 验证 routes 是有效索引
          if (group.routes) {
            for (let i = 0; i < group.routes.length; i++) {
              if (!Number.isInteger(group.routes[i]) || group.routes[i] < 0) {
                errors.push(`${groupId}: routes[${i}] 无效 (${group.routes[i]})`);
              }
            }
          }
        }
        
        // 验证波次预算
        if (!wave.budget) {
          errors.push(`${waveId}: 缺少 budget`);
        } else {
          if (!Number.isSafeInteger(wave.budget.income) || wave.budget.income < 0) {
            errors.push(`${waveId}: 无效的 income ${wave.budget.income}`);
          }
          if (!Number.isSafeInteger(wave.budget.bounty) || wave.budget.bounty < 0) {
            errors.push(`${waveId}: 无效的 bounty ${wave.budget.bounty}`);
          }
          if (!Number.isSafeInteger(wave.budget.clear) || wave.budget.clear < 0) {
            errors.push(`${waveId}: 无效的 clear ${wave.budget.clear}`);
          }
          
          // 验证预算总和
          const totalBounty = wave.groups.flatMap(g => g.bounties).reduce((a, b) => a + b, 0);
          if (Math.abs(totalBounty - wave.budget.bounty) > 1) {
            warnings.push(`${waveId}: 赏金总和 (${totalBounty}) 与预算 (${wave.budget.bounty}) 不匹配`);
          }
        }
      }
      
    } catch (err) {
      errors.push(`${levelId}: 生成失败 - ${err.message}`);
    }
  }
}

console.log('═══════════════════════════════════════════════════════');
console.log(`验证完成: ${stats.levels}/50 关\n`);

console.log('📊 统计:');
console.log(`  关卡数: ${stats.levels}`);
console.log(`  波次数: ${stats.waves}`);
console.log(`  组数: ${stats.groups}`);
console.log(`  敌人总数: ${stats.enemies}`);
console.log(`  精英怪: ${stats.elites}`);
console.log(`  Boss: ${stats.bosses}`);
console.log(`  敌人类型: ${[...stats.types].join(', ')}`);
console.log(`  词缀类型: ${[...stats.affixes].join(', ') || '无'}`);
console.log(`  总收入: ${stats.totalIncome}`);
console.log(`  总赏金: ${stats.totalBounty}\n`);

if (warnings.length > 0) {
  console.log(`⚠️  警告 (${warnings.length}):`);
  warnings.slice(0, 10).forEach(w => console.log(`  ${w}`));
  if (warnings.length > 10) console.log(`  ... 还有 ${warnings.length - 10} 个警告\n`);
}

if (errors.length > 0) {
  console.log(`❌ 错误 (${errors.length}):`);
  errors.slice(0, 20).forEach(e => console.log(`  ${e}`));
  if (errors.length > 20) console.log(`  ... 还有 ${errors.length - 20} 个错误`);
  process.exit(1);
} else {
  console.log('✅ 所有 50 关数据验证通过！');
  console.log('   - 无 NaN 值');
  console.log('   - 无未定义兵种');
  console.log('   - 等级和预算数据正确');
  console.log('   - profile/bounties/routes 完整');
}
