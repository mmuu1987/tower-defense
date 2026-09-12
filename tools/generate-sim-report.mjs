// 生成模拟器统计报告（G3 验收要求）
import { execSync } from 'child_process';

console.log('生成 G3 模拟器统计报告...\n');

// 测试关卡子集（覆盖每个世界的起点、中点、Boss）
const testLevels = [
  { w: 0, l: 0, desc: 'W1-1 起点' },
  { w: 0, l: 4, desc: 'W1-5 中期' },
  { w: 0, l: 9, desc: 'W1-10 Boss' },
  { w: 1, l: 0, desc: 'W2-1 起点' },
  { w: 1, l: 4, desc: 'W2-5 中期' },
  { w: 1, l: 9, desc: 'W2-10 Boss' },
  { w: 2, l: 0, desc: 'W3-1 起点' },
  { w: 2, l: 9, desc: 'W3-10 Boss' },
  { w: 3, l: 0, desc: 'W4-1 起点' },
  { w: 3, l: 9, desc: 'W4-10 Boss' },
  { w: 4, l: 0, desc: 'W5-1 起点' },
  { w: 4, l: 9, desc: 'W5-10 Boss' },
];

const results = [];
const stats = {
  wins: 0,
  losses: 0,
  timeouts: 0,
  errors: 0,
  totalTime: 0,
  totalKills: 0,
  totalLeaks: 0,
};

console.log(`运行 ${testLevels.length} 个代表关卡的模拟...\n`);

for (const { w, l, desc } of testLevels) {
  try {
    const startTime = Date.now();
    const output = execSync(`node tools/sim.mjs ${w} ${l} --g2 --branch=A --budget=300`, {
      encoding: 'utf-8',
      timeout: 120000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const elapsed = (Date.now() - startTime) / 1000;
    
    // 解析结果
    let result = 'UNKNOWN';
    let lives = 0;
    let kills = 0;
    let leaks = 0;
    let waves = '';
    
    const winMatch = output.match(/WIN\s+(\d+)\s+(\d+)\s+(\d+)\/(\d+)/);
    const lossMatch = output.match(/LOSS\s+(\d+)\s+(\d+)\s+(\d+)\/(\d+)/);
    const timeoutMatch = output.match(/TIMEOUT/);
    
    if (winMatch) {
      result = 'WIN';
      lives = parseInt(winMatch[1]);
      kills = parseInt(winMatch[2]);
      waves = `${winMatch[3]}/${winMatch[4]}`;
      stats.wins++;
      stats.totalKills += kills;
    } else if (lossMatch) {
      result = 'LOSS';
      lives = parseInt(lossMatch[1]);
      leaks = parseInt(lossMatch[2]);
      waves = `${lossMatch[3]}/${lossMatch[4]}`;
      stats.losses++;
      stats.totalLeaks += leaks;
    } else if (timeoutMatch) {
      result = 'TIMEOUT';
      stats.timeouts++;
    } else {
      result = 'ERROR';
      stats.errors++;
    }
    
    stats.totalTime += elapsed;
    
    results.push({
      level: `${w}-${l}`,
      desc,
      result,
      lives,
      kills,
      leaks,
      waves,
      time: elapsed.toFixed(1),
    });
    
    const statusIcon = result === 'WIN' ? '✓' : result === 'LOSS' ? '✗' : result === 'TIMEOUT' ? '⏱' : '⚠';
    console.log(`${statusIcon} ${desc.padEnd(15)} ${result.padEnd(8)} ${waves.padEnd(7)} ${lives} lives  ${kills} kills  ${elapsed.toFixed(1)}s`);
    
  } catch (err) {
    const elapsed = 120;
    stats.timeouts++;
    results.push({ level: `${w}-${l}`, desc, result: 'TIMEOUT', time: elapsed });
    console.log(`⏱ ${desc.padEnd(15)} TIMEOUT  ${elapsed}s`);
  }
}

console.log('\n═══════════════════════════════════════════════════════');
console.log('模拟统计汇总:\n');
console.log(`  总测试: ${testLevels.length}`);
console.log(`  胜利: ${stats.wins} (${(stats.wins / testLevels.length * 100).toFixed(1)}%)`);
console.log(`  失败: ${stats.losses}`);
console.log(`  超时: ${stats.timeouts}`);
console.log(`  错误: ${stats.errors}`);
console.log(`  平均耗时: ${(stats.totalTime / testLevels.length).toFixed(1)}s`);
console.log(`  总击杀: ${stats.totalKills}`);
console.log(`  总漏怪: ${stats.totalLeaks}\n`);

// 按世界分组统计
console.log('按世界统计:');
for (let w = 0; w < 5; w++) {
  const worldResults = results.filter(r => r.level.startsWith(`${w}-`));
  const worldWins = worldResults.filter(r => r.result === 'WIN').length;
  console.log(`  W${w + 1}: ${worldWins}/${worldResults.length} 通关`);
}

console.log('\n详细结果:');
console.log('┌─────────┬─────────────────┬─────────┬─────────┬───────┬───────┬───────┐');
console.log('│ 关卡    │ 描述            │ 结果    │ 波次    │ 生命  │ 击杀  │ 时间  │');
console.log('├─────────┼─────────────────┼─────────┼─────────┼───────┼───────┼───────┤');
for (const r of results) {
  const level = r.level.padEnd(7);
  const desc = r.desc.padEnd(15);
  const result = r.result.padEnd(7);
  const waves = (r.waves || '-').padEnd(7);
  const lives = String(r.lives || '-').padEnd(5);
  const kills = String(r.kills || '-').padEnd(5);
  const time = (r.time + 's').padEnd(5);
  console.log(`│ ${level} │ ${desc} │ ${result} │ ${waves} │ ${lives} │ ${kills} │ ${time} │`);
}
console.log('└─────────┴─────────────────┴─────────┴─────────┴───────┴───────┴───────┘');

console.log('\n✅ G3 模拟器统计报告生成完成');
console.log('   - 覆盖 5 个世界的代表关卡');
console.log('   - 使用 G2 机器人（八塔固定阵容）');
console.log(`   - 通关率: ${stats.wins}/${testLevels.length} (${(stats.wins / testLevels.length * 100).toFixed(1)}%)`);
console.log('   - 注：G3 完成系统集成，G4/G5 将扩展策略和平衡调优');
