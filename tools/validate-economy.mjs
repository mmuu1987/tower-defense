// 验证经济账本系统的收支闭环
import { buildLevel } from '../js/game/levelgen.js';
import { EconomyLedger, allocateBudget } from '../js/game/economy.js';

console.log('测试经济账本系统...\n');

const tests = [];
const passed = [];
const failed = [];

// 测试 1: 基础账本创建
tests.push({
  name: '账本初始化',
  fn: () => {
    const ledger = new EconomyLedger(500);
    if (ledger.balance !== 500) throw new Error(`余额不正确: ${ledger.balance}`);
    if (ledger.entries.length !== 1) throw new Error(`初始条目数不正确`);
    if (ledger.entries[0].kind !== 'opening') throw new Error(`初始条目类型不正确`);
  }
});

// 测试 2: 击杀收入
tests.push({
  name: '击杀收入记录',
  fn: () => {
    const ledger = new EconomyLedger(100);
    const ok = ledger.register({ id: 'kill-1', kind: 'kill', amount: 50, wave: 0, time: 1.5 });
    if (!ok) throw new Error('记录失败');
    if (ledger.balance !== 150) throw new Error(`余额错误: ${ledger.balance}`);
  }
});

// 测试 3: 建造支出
tests.push({
  name: '建造支出记录',
  fn: () => {
    const ledger = new EconomyLedger(200);
    const ok = ledger.register({ id: 'build-1', kind: 'build', amount: -120, wave: 0, time: 2.0, tower: 'arrow' });
    if (!ok) throw new Error('记录失败');
    if (ledger.balance !== 80) throw new Error(`余额错误: ${ledger.balance}`);
  }
});

// 测试 4: 余额不足保护
tests.push({
  name: '余额不足拒绝',
  fn: () => {
    const ledger = new EconomyLedger(50);
    const ok = ledger.register({ id: 'build-2', kind: 'build', amount: -100, wave: 0, time: 3.0 });
    if (ok) throw new Error('应该拒绝但通过了');
    if (ledger.balance !== 50) throw new Error('余额被错误修改');
  }
});

// 测试 5: 家族预算系统
tests.push({
  name: '家族预算注册',
  fn: () => {
    const ledger = new EconomyLedger(0);
    const ok = ledger.registerFamily('wave-0:group-0', 150, [
      { id: 'wave-0:group-0:0', amount: 50 },
      { id: 'wave-0:group-0:1', amount: 50 },
      { id: 'wave-0:group-0:2', amount: 50 },
    ]);
    if (!ok) throw new Error('注册失败');
  }
});

// 测试 6: 家族赏金领取
tests.push({
  name: '家族赏金领取',
  fn: () => {
    const ledger = new EconomyLedger(0);
    ledger.registerFamily('wave-0:group-0', 100, [
      { id: 'wave-0:group-0:0', amount: 40 },
      { id: 'wave-0:group-0:1', amount: 60 },
    ]);
    
    const amount1 = ledger.claim('wave-0:group-0', 'wave-0:group-0:0', { wave: 0, time: 5.0 });
    if (amount1 !== 40) throw new Error(`第一次领取金额错误: ${amount1}`);
    if (ledger.balance !== 40) throw new Error(`余额错误: ${ledger.balance}`);
    
    const amount2 = ledger.claim('wave-0:group-0', 'wave-0:group-0:1', { wave: 0, time: 6.0 });
    if (amount2 !== 60) throw new Error(`第二次领取金额错误: ${amount2}`);
    if (ledger.balance !== 100) throw new Error(`余额错误: ${ledger.balance}`);
  }
});

// 测试 7: 家族预算限制（修正：票据总和必须 <= 预算才能注册）
tests.push({
  name: '家族预算超限保护',
  fn: () => {
    const ledger = new EconomyLedger(0);
    // 注册时票据总和 = 预算（合法）
    ledger.registerFamily('wave-0:group-0', 100, [
      { id: 'wave-0:group-0:0', amount: 50 },
      { id: 'wave-0:group-0:1', amount: 50 },
    ]);
    
    // 领取第一笔
    ledger.claim('wave-0:group-0', 'wave-0:group-0:0', { wave: 0, time: 5.0 });
    if (ledger.balance !== 50) throw new Error(`第一次领取后余额错误: ${ledger.balance}`);
    
    // 领取第二笔
    ledger.claim('wave-0:group-0', 'wave-0:group-0:1', { wave: 0, time: 6.0 });
    if (ledger.balance !== 100) throw new Error(`第二次领取后余额错误: ${ledger.balance}`);
    
    // 测试注册时超预算会被拒绝
    const ledger2 = new EconomyLedger(0);
    const ok = ledger2.registerFamily('wave-0:group-1', 100, [
      { id: 'wave-0:group-1:0', amount: 60 },
      { id: 'wave-0:group-1:1', amount: 60 },
    ]);
    if (ok) throw new Error('票据总和超预算应该拒绝注册');
  }
});

// 测试 8: 重复领取保护
tests.push({
  name: '重复领取拒绝',
  fn: () => {
    const ledger = new EconomyLedger(0);
    ledger.registerFamily('wave-0:group-0', 100, [
      { id: 'wave-0:group-0:0', amount: 50 },
    ]);
    
    const amount1 = ledger.claim('wave-0:group-0', 'wave-0:group-0:0', { wave: 0, time: 5.0 });
    if (amount1 !== 50) throw new Error('首次领取失败');
    
    const amount2 = ledger.claim('wave-0:group-0', 'wave-0:group-0:0', { wave: 0, time: 6.0 });
    if (amount2 !== null) throw new Error('重复领取应该被拒绝');
    if (ledger.balance !== 50) throw new Error('余额被错误修改');
  }
});

// 测试 9: 账本汇总
tests.push({
  name: '账本汇总统计',
  fn: () => {
    const ledger = new EconomyLedger(500);
    ledger.register({ id: 'kill-1', kind: 'kill', amount: 50, wave: 0, time: 1.0 });
    ledger.register({ id: 'clear-0', kind: 'clear', amount: 100, wave: 0, time: 10.0 });
    ledger.register({ id: 'build-1', kind: 'build', amount: -120, wave: 0, time: 2.0 });
    ledger.register({ id: 'upgrade-1', kind: 'upgrade', amount: -80, wave: 0, time: 5.0 });
    
    const summary = ledger.summary();
    if (summary.startGold !== 500) throw new Error('起始金币错误');
    if (summary.balance !== 450) throw new Error('余额错误');
    if (summary.totals.kill !== 50) throw new Error('击杀收入统计错误');
    if (summary.totals.clear !== 100) throw new Error('清波奖励统计错误');
    if (summary.totals.build !== 120) throw new Error('建造支出统计错误');
    if (summary.totals.upgrade !== 80) throw new Error('升级支出统计错误');
    if (summary.income !== 150) throw new Error('总收入统计错误');
    if (summary.spending !== 200) throw new Error('总支出统计错误');
  }
});

// 测试 10: 整数分配算法
tests.push({
  name: '整数预算分配',
  fn: () => {
    // 测试均匀分配
    const result1 = allocateBudget(100, [1, 1, 1]);
    const sum1 = result1.reduce((a, b) => a + b, 0);
    if (sum1 !== 100) throw new Error(`分配总和错误: ${sum1}`);
    
    // 测试不均匀分配
    const result2 = allocateBudget(100, [1, 2, 3]);
    const sum2 = result2.reduce((a, b) => a + b, 0);
    if (sum2 !== 100) throw new Error(`分配总和错误: ${sum2}`);
    
    // 测试零权重
    const result3 = allocateBudget(100, [0, 1, 0]);
    if (result3[0] !== 0 || result3[2] !== 0 || result3[1] !== 100) {
      throw new Error(`零权重分配错误: ${result3}`);
    }
  }
});

// 运行所有测试
for (const test of tests) {
  try {
    test.fn();
    passed.push(test.name);
    console.log(`✓ ${test.name}`);
  } catch (err) {
    failed.push({ name: test.name, error: err.message });
    console.log(`✗ ${test.name}: ${err.message}`);
  }
}

console.log('\n═══════════════════════════════════════════════════════');
console.log(`测试结果: ${passed.length}/${tests.length} 通过\n`);

if (failed.length > 0) {
  console.log('❌ 失败的测试:');
  failed.forEach(f => console.log(`  - ${f.name}: ${f.error}`));
  process.exit(1);
} else {
  console.log('✅ 所有经济账本测试通过！');
  console.log('   - 基础收支记录正常');
  console.log('   - 余额保护生效');
  console.log('   - 家族预算系统正常');
  console.log('   - 重复领取保护生效');
  console.log('   - 账本汇总准确');
  console.log('   - 整数分配算法正确');
}
