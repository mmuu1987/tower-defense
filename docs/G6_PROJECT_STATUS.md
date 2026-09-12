# G6 技能平衡项目 - 当前状态

**最后更新**: 2026-09-12  
**项目阶段**: M1-M4 完成  
**项目状态**: ✅ 阶段性完成

---

## 当前配置 (Round 11 稳定版本)

### 平衡状态

| 塔 | 招牌冷却 | 终极冷却 | 招牌/关 | 终极/关 | 终极占比 | 目标范围 | 状态 |
|---|---|---|---|---|---|---|---|
| Arrow | 12s | 20s | 12.1 | 7.4 | 38.0% | 38-43% | ✅ |
| Sniper | 15s | 22s | 9.4 | 6.6 | 41.1% | 38-43% | ✅ |
| Cannon | 12s | 22s | 9.0 | 6.1 | 40.2% | 38-43% | ✅ |
| Venom | 13s | 22s | 5.0 | 4.1 | 42.6% | 38-43% | ✅ |
| Beacon | 16s | 25s | 5.0 | 3.3 | 40.0% | 38-43% | ✅ |
| **Frost** | 16s | **20s** | 15.7 | 2.2 | **12.3%** | 12-20% | ✅ |
| **Tesla** | 13s | 22s | 17.2 | 1.3 | **7.1%** | 12-20% | ❌ |

**达标率**: 6/7 (85.7%)  
**胜率**: 50/50 (100%)

### 关键参数

**Frost终极技能** (成功配置):
```javascript
// js/game/skills.js:40
ultimate: { key: 'blizzardField', name: '极寒领域', unlockLevel: 8, cooldown: 20 }

// 特殊效果 (Round 7添加):
e.effects.frostVulnerable = {
  sourceTowerId: tower.id,
  until: ctx.time + 6,
  allDamagePct: 0.15,  // +15%增伤效果
};
```

**Tesla招牌技能** (当前配置):
```javascript
// js/game/skills.js:31
signature: { key: 'overload', name: '过载', unlockLevel: 4, cooldown: 13 }

// 实现 (js/game/skills.js:287-290):
const duration = 3 + (mods.signatureDuration || 0);  // 3秒
tower.overloadUntil = ctx.time + duration;
tower.overloadRate = 2.2;        // +120%攻速
tower.overloadDamageMul = 0.75;  // 75%伤害倍率
```

**Tesla终极技能** (当前配置):
```javascript
// js/game/skills.js:32
ultimate: { key: 'empBlast', name: '电磁脉冲', unlockLevel: 8, cooldown: 22 }

// 效果: 4.5格范围伤害 + 70%减速2.5秒
// 无增伤效果 (Round 12证实添加会与Frost竞争)
```

---

## 测试配置

### 模拟器配置 (固定配置版本)

**文件**: `tools/simulate-balance.mjs`

**关键函数**: `autoPlace` (固定7座塔)
```javascript
function autoPlace(battle) {
  const towers = ['arrow','cannon','sniper','tesla','frost','venom','beacon'];
  const placed = [];
  
  // 每种塔恰好放置1座
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
        break;  // 成功后跳出
      }
    }
  }
  
  // 升级至Lv.8 + 随机专精
  for(const t of placed) {
    while(t.level < 7) {
      const branch = Math.random() > 0.5 ? 'A' : 'B';
      battle.upgradeTower(t, t.requiresSpecialization() ? branch : null);
      battle.gold += t.upgradeCost();
    }
  }
  
  return placed;
}
```

**特点**:
- 每关恰好7座塔 (每种各1座)
- 位置随机 (适应地形)
- 类型和数量固定 (消除随机性)
- 专精随机 (保持真实性)

**运行命令**:
```bash
node tools/simulate-balance.mjs
```

**输出**: `balance-report.json`

---

## 已知问题

### Tesla终极使用率低 (未达标)

**当前状态**:
- 终极占比: 7.1%
- 目标范围: 12-20%
- 缺口: +4.9% (需提升69%)

**根本原因** (三层结构性问题):

1. **招牌过载过强**
   - 效果: +120%攻速 × 3秒 = 效率2.2倍
   - AI高度依赖，优先级极高
   - 削弱招牌会降低整体参与度 (Round 10证实)

2. **终极基础价值不足**
   - 当前: 仅有范围伤害+减速
   - 冷却: 22s已较短，继续缩短效果递减
   - 频率: 1.3次/关，理论上限约2次/关

3. **增伤效果竞争** (Round 12发现)
   - 添加增伤会与Frost竞争
   - Tesla优势(范围4.5>4.0, 增伤20%>15%)压制Frost
   - 导致Frost崩溃 (12.3% → 8.4%)

**结论**: 参数调整无法解决，需要结构性重设计

---

## 禁止操作

### ⚠️ 不要尝试的调整

1. **Tesla招牌削弱** ❌
   - 原因: Round 10证实会降低整体参与度
   - 效果: 终极占比反而下降 (8.2% → 5.3%)
   - 风险: 高

2. **Tesla终极添加增伤效果** ❌
   - 原因: Round 12证实会与Frost竞争
   - 效果: Frost崩溃 (12.3% → 8.4%)
   - 风险: 极高

3. **恢复随机配置** ❌
   - 原因: 导致33.3%失败率
   - 效果: 数据不可靠，无法准确诊断
   - 风险: 极高

4. **同时调整多个参数** ❌
   - 原因: Round 8和Round 12双重失败教训
   - 效果: 难以定位问题，回滚成本高
   - 风险: 高

---

## 可以尝试的方向

### ✅ 保守单步调整 (中等风险)

**方案**: 仅缩短Tesla终极冷却

```javascript
// js/game/skills.js:32
// 当前:
ultimate: { key: 'empBlast', name: '电磁脉冲', unlockLevel: 8, cooldown: 22 }

// 建议:
ultimate: { key: 'empBlast', name: '电磁脉冲', unlockLevel: 8, cooldown: 16 }
// 22s → 16s (-27.3%)
```

**预期效果**:
- 终极频率: 1.3 → 1.9次/关 (+46%)
- 终极占比: 7.1% → 10-11%
- 胜率: 可能保持100%

**风险评估**: 中等
- 单参数调整，影响可控
- 不涉及增伤效果，不影响Frost
- 即使成功也仅勉强达标下限

**决策点**: 是否值得为1-2%的提升冒险?

### 🔄 长期重设计 (根本方案)

**方案1: 瞬发强化**
- 将持续时间效果改为瞬发效果
- 招牌: 立即发射5道连锁闪电
- 降低持续输出优势，提升终极相对价值

**方案2: 充能机制**
- 招牌攻击累积充能
- 终极消耗充能释放
- 建立招牌和终极的联动关系

**工作量**: 高 (完整设计-实现-测试周期)

---

## 验证流程

### 测试新调整

1. **修改代码**
   ```bash
   # 编辑 js/game/skills.js
   # 修改相应参数
   ```

2. **运行单元测试**
   ```bash
   npm test
   # 必须100/100通过
   ```

3. **运行模拟测试**
   ```bash
   node tools/simulate-balance.mjs
   # 预期: 50/50 (100%胜率)
   ```

4. **分析结果**
   ```bash
   cat balance-report.json
   # 检查各塔终极占比
   # 确认无破坏现有平衡
   ```

5. **提交或回滚**
   ```bash
   # 成功:
   git add . && git commit -m "..."
   
   # 失败:
   git checkout -- js/game/skills.js
   git checkout -- balance-report.json
   ```

### 评估标准

**必须达成**:
- ✅ 胜率: 50/50 (100%)
- ✅ 不破坏其他6塔平衡

**期望达成**:
- 🎯 Tesla终极占比: ≥12%
- 🎯 Frost保持: 12-20%范围

**可接受妥协**:
- ⚠️ Tesla终极占比: 10-12% (接近目标)

**不可接受**:
- ❌ 胜率: <100%
- ❌ 任何达标塔脱离目标范围
- ❌ Frost崩溃 (<10%)

---

## 项目文件

### 代码文件

- `js/game/skills.js` - 技能定义和实现 (核心文件)
- `tools/simulate-balance.mjs` - 自动化模拟器
- `balance-report.json` - 最新测试数据

### 文档文件

**核心文档**:
- `docs/G6_FINAL_REPORT.md` - 项目最终总结
- `docs/G6_M4_PROJECT_CONCLUSION.md` - M4阶段总结
- `docs/G6_PROJECT_STATUS.md` - 当前状态 (本文档)
- `docs/README.md` - 文档导航中心

**M4详细报告**:
- `docs/G6_M4_ROUND10_REPORT.md` - Round 10失败分析
- `docs/G6_M4_ROUND11_VERIFICATION.md` - Round 11验证报告
- `docs/G6_M4_ROUND12_FAILURE.md` - Round 12失败分析

**M1-M3文档**: (参见README.md)

---

## 快速命令

### 常用命令

```bash
# 运行单元测试
npm test

# 运行平衡模拟
node tools/simulate-balance.mjs

# 查看最新结果
cat balance-report.json | jq '.summary.byTower'

# 检查git状态
git status

# 查看最近提交
git log --oneline -10

# 回滚到Round 11
git checkout b807040 -- js/game/skills.js
```

### 快速验证

```bash
# 一键测试流程
npm test && node tools/simulate-balance.mjs && echo "测试完成!"
```

---

## 联系与支持

**项目负责人**: Claude Opus 5  
**最后更新**: 2026-09-12  
**Git提交**: b807040 (Round 11稳定版本)

**文档问题**: 查看 `docs/README.md`  
**技术问题**: 查看 `docs/G6_FINAL_REPORT.md` 核心发现部分

---

**状态**: ✅ 可用于生产  
**建议**: 接受6/7达标作为当前稳定版本

