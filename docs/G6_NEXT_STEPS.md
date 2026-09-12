# G6 后续行动计划

**日期**：2026-09-12  
**当前状态**：6/7 塔类达标（85.7%）  
**项目阶段**：M3 完成 → M4 规划

---

## 1. 当前项目状态

### 1.1 已完成

✅ **M1 - 平衡基准**（2026-09-12 上午）：
- 50 关自动化模拟器开发完成
- 基准数据收集（技能频率 + 伤害）
- 识别明确平衡问题

✅ **M2 - 深度调整**（2026-09-12 中午）：
- Sniper/Cannon 伤害过高问题已修复
- Beacon 增益过强问题已修复
- 100% 胜率稳定性保持

✅ **M3 - 不对称平衡**（2026-09-12 下午）：
- 不对称平衡策略验证成功
- Frost 终极使用率提升至 13.8%（目标 12-20%）
- 6/7 塔类达到平衡目标

### 1.2 剩余问题

⚠️ **Tesla 终极使用率低**（1/7 未达标）：
- 当前：4.5%（目标 12-20%）
- 原因：招牌过载效果太强（+120% 攻速 3 秒）
- 状态：方案已制定，等待实施

⚠️ **Sniper 伤害波动**：
- 第五轮：79,264 总伤害
- 第七轮：121,708 总伤害（+53.5%）
- 原因：随机配置 + Frost 增伤效果
- 状态：需要更多数据观察

⚠️ **数据随机性**：
- 塔配置随机导致 ±40% 波动
- 单轮 50 关样本量偏小
- 状态：需要改进测试方法

---

## 2. 立即行动（P0）

### 2.1 Tesla 平衡调整

**目标**：提升 Tesla 终极技能使用率至 12-20%

#### 方案 A：弱化招牌，增强终极（推荐）

**调整 1：过载持续时间缩短**
```javascript
// js/game/skills.js:287-289
// 当前：
const duration = 3 + (mods.signatureDuration || 0);
tower.overloadUntil = ctx.time + duration;

// 建议：
const duration = 2 + (mods.signatureDuration || 0);  // 3s → 2s
tower.overloadUntil = ctx.time + duration;
```

**调整 2：终极冷却缩短**
```javascript
// js/game/skills.js:31
// 当前：
ultimate: { key: 'empBlast', name: '电磁脉冲', unlockLevel: 8, cooldown: 22 }

// 建议：
ultimate: { key: 'empBlast', name: '电磁脉冲', unlockLevel: 8, cooldown: 18 }
```

**调整 3：终极增加增伤效果**
```javascript
// js/game/skills.js:301-305（castTesla 函数中，终极技能部分）
// 当前：
for (const e of targets) {
  ctx.hitEnemy(e, Math.round(s.dmg * 2.2), {
    ...damageOpts(tower),
    effects: { slow: { pct: 0.7, dur: 2.5 } },
  });
}

// 建议：在循环后添加增伤 debuff
for (const e of targets) {
  ctx.hitEnemy(e, Math.round(s.dmg * 2.2), {
    ...damageOpts(tower),
    effects: { slow: { pct: 0.7, dur: 2.5 } },
  });
  // 新增增伤效果
  if (!e.effects) e.effects = {};
  e.effects.empVulnerable = {
    sourceTowerId: tower.id,
    until: ctx.time + 4,
    allDamagePct: 0.20,
  };
}
```

**预期效果**：
- 招牌价值下降（持续时间 -33%）
- 终极频率提升（冷却 -18%）
- 终极价值提升（增伤 +20% 效果）
- 终极占比：4.5% → 10-12%

**验证计划**：
1. 实施调整
2. 运行单元测试（100/100 预期通过）
3. 运行第八轮 50 关模拟
4. 分析 Tesla 终极占比（目标 ≥10%）
5. 确认胜率 50/50 (100%)

#### 方案 B：接受现状（保守）

**理念**：承认 Tesla 作为"极端高频控制塔"

**新目标定位**：
- Tesla 终极占比目标：5-10%（而非 12-20%）
- 定位：通过高频招牌提供持续控制，终极作为紧急手段
- 不需要代码调整

**优点**：
- 无需进一步调整
- 保持当前通关稳定性
- 避免第六轮过度调整的风险

**缺点**：
- 与其他塔差异过大
- 终极技能使用体验差（每关仅 1-2 次）
- 玩家可能感觉终极技能"无用"

**决策依据**：
- 如果优先通关稳定性 → 选方案 B
- 如果优先玩家体验 → 选方案 A

### 2.2 决策点

**需要确认的问题**：

1. **Tesla 调整策略**：
   - [ ] 实施方案 A（弱化招牌，增强终极）
   - [ ] 接受方案 B（终极目标降至 5-10%）

2. **Sniper 伤害处理**：
   - [ ] 立即削减（180% → 160%）
   - [ ] 再观察 1-2 轮数据
   - [ ] 接受现状（认为是随机波动）

3. **数据质量改进**：
   - [ ] 实施固定塔配置（每关 7 座塔各 1 座）
   - [ ] 增加样本量（50 → 100-150 关）
   - [ ] 保持当前方法（随机配置 + 50 关）

---

## 3. 短期任务（P1）

### 3.1 数据质量改进

#### 3.1.1 固定塔配置

**目标**：消除随机配置导致的 ±40% 波动

**修改**：`tools/simulate-balance.mjs`

```javascript
// 当前 autoPlace 函数：随机放置 4-6 座塔
function autoPlace(battle) {
  const towers = ['arrow','cannon','sniper','tesla','frost','venom','beacon'];
  const placed = [];
  let attempts = 0;

  while(placed.length < 6 && attempts < 200) {
    attempts++;
    const cx = Math.floor(Math.random() * 42);
    const cz = Math.floor(Math.random() * 28);
    const key = towers[Math.floor(Math.random() * towers.length)];
    // ...
  }
}

// 建议：固定配置，每座塔恰好 1 座
function autoPlace(battle) {
  const towers = ['arrow','cannon','sniper','tesla','frost','venom','beacon'];
  const placed = [];

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
        break;
      }
    }
  }

  // 升级逻辑保持不变
  for (const t of placed) {
    while (t.level < 7) {
      const branch = Math.random() > 0.5 ? 'A' : 'B';
      battle.upgradeTower(t, t.requiresSpecialization() ? branch : null);
      battle.gold += t.upgradeCost();
    }
  }

  return placed;
}
```

**预期效果**：
- 每座塔恰好出现 50 次/50 关
- 消除塔数量波动（当前 17-37 座 → 固定 50 座）
- 数据可靠性显著提升

#### 3.1.2 增加样本量

**目标**：提高统计可靠性

**修改**：`tools/simulate-balance.mjs`

```javascript
// 当前：50 关
async function runAll() {
  const results = [];
  for(let w = 0; w < 5; w++) {
    for(let l = 0; l < 10; l++) {
      // ...
    }
  }
}

// 建议：100-150 关（重复运行 2-3 次）
async function runAll(rounds = 3) {
  const results = [];
  for (let r = 0; r < rounds; r++) {
    for (let w = 0; w < 5; w++) {
      for (let l = 0; l < 10; l++) {
        const idx = r * 50 + w * 10 + l;
        process.stdout.write(`\r运行关卡 ${idx+1}/${rounds*50}: W${w+1}-${l+1} (轮次 ${r+1}/${rounds}) `);
        const stats = await runLevel(w, l);
        results.push({ round: r+1, world: w+1, level: l+1, ...stats });
      }
    }
  }
  // ...
}
```

**预期效果**：
- 样本量：50 → 150 关
- 可靠性提升：误差 ±40% → ±15%
- 执行时间：5 分钟 → 15 分钟

#### 3.1.3 专精分支统计

**目标**：分析 A/B 专精对技能频率的影响

**修改**：`tools/simulate-balance.mjs`

```javascript
// 记录专精选择
const autoPlace = (battle) => {
  // ...
  for(const t of placed) {
    while(t.level < 7) {
      const branch = Math.random() > 0.5 ? 'A' : 'B';
      battle.upgradeTower(t, t.requiresSpecialization() ? branch : null);
      battle.gold += t.upgradeCost();
    }
    // 新增：记录专精
    t.finalSpec = t.specialization;
  }
  return placed;
}

// 统计中分组
for(const [key, data] of Object.entries(r.towers)) {
  const spec = r.towersSpecs?.[key] || 'none';  // 新增
  if(!summary.byTower[key]) summary.byTower[key] = { 
    sig: 0, ult: 0, sigDmg: 0, ultDmg: 0, total: 0, levels: 0,
    specA: { sig: 0, ult: 0 },  // 新增
    specB: { sig: 0, ult: 0 },  // 新增
  };
  // 根据专精分组统计
  if (spec === 'A') {
    summary.byTower[key].specA.sig += data.sig;
    summary.byTower[key].specA.ult += data.ult;
  } else if (spec === 'B') {
    summary.byTower[key].specB.sig += data.sig;
    summary.byTower[key].specB.ult += data.ult;
  }
}
```

**预期输出**：
```
frost (专精A) - 招牌: 26.3/关  终极: 4.2/关 (占比 13.8%)
frost (专精B) - 招牌: 22.1/关  终极: 3.6/关 (占比 14.0%)
```

### 3.2 UI 改进

#### 3.2.1 终极技能就绪提示

**目标**：引导玩家更频繁释放终极技能

**位置**：技能按钮 UI（假设在 `js/ui/skill-buttons.js`）

**效果设计**：
- 终极技能就绪时：
  - 按钮边框闪烁（金色光晕，1 秒周期）
  - 播放音效（"ding" 提示音）
  - 显示文字："终极技能就绪！"

**伪代码**：
```javascript
function updateSkillButton(tower, tier) {
  const skill = skillFor(tower, tier);
  const ready = canUseSkill(tower, tier);
  
  if (tier === 'ultimate' && ready) {
    button.classList.add('skill-ready-pulse');  // CSS 动画
    if (!button.wasReady) {
      playSound('skill-ready.mp3');
      showToast(`${tower.name} 终极技能就绪！`);
      button.wasReady = true;
    }
  } else {
    button.classList.remove('skill-ready-pulse');
    button.wasReady = false;
  }
}
```

#### 3.2.2 技能统计面板

**目标**：实时显示技能使用情况

**设计**：
- 位置：游戏 UI 右下角
- 内容：
  - 本关已释放：招牌 X 次 / 终极 Y 次
  - 当前冷却：招牌 5.2s / 终极 12.8s
  - 使用建议：终极技能可用时高亮提示

**数据来源**：Battle 类添加统计字段

```javascript
class Battle {
  constructor() {
    // ...
    this.skillStats = {
      signature: 0,
      ultimate: 0,
    };
  }

  castSkill(tower, tier) {
    // ...
    if (ok) {
      this.skillStats[tier]++;
    }
  }
}
```

---

## 4. 长期优化（P2）

### 4.1 动态冷却系统

**目标**：根据战场状态动态调整技能冷却

**设计理念**：
- 敌人密集时：AOE 技能冷却延长（防止过度释放）
- 敌人稀疏时：所有技能冷却缩短（保持游戏节奏）
- Boss 波次：终极技能冷却缩短（增强关键时刻体验）

**实现**：
```javascript
// js/game/skills.js 新增函数
function calculateDynamicCooldown(tower, tier, baseCooldown, ctx) {
  const enemyCount = ctx.enemies.filter(e => e.alive).length;
  const isBossWave = ctx.enemies.some(e => e.def.shape === 'boss');
  
  let modifier = 1.0;
  
  // AOE 控制塔在密集波次冷却延长
  if ((tower.key === 'frost' || tower.key === 'tesla') && tier === 'signature') {
    if (enemyCount > 15) modifier = 1.25;      // +25%
    else if (enemyCount < 5) modifier = 0.85;  // -15%
  }
  
  // Boss 波次终极技能冷却缩短
  if (tier === 'ultimate' && isBossWave) {
    modifier *= 0.85;  // -15%
  }
  
  return baseCooldown * modifier;
}

// 在 castSkill 中调用
export function castSkill(tower, tier, ctx) {
  // ...
  if (ok) {
    const baseCooldown = skillFor(tower, tier).cooldown;
    tower.skillCooldowns[tier] = calculateDynamicCooldown(tower, tier, baseCooldown, ctx);
    // ...
  }
}
```

**预期效果**：
- Frost/Tesla 在密集波次不会过度释放
- Boss 战时玩家有更多终极技能使用机会
- 整体游戏节奏更平衡

### 4.2 AI 决策改进

**目标**：让 AI 考虑技能价值而非仅看冷却

**当前问题**：
- AI 仅检查 `canUseSkill`（冷却是否就绪）
- 不考虑伤害倍率、效果持续时间、战场情况

**改进方案**：引入技能价值评分

```javascript
// js/game/ai-skills.js（新文件）
export function evaluateSkillValue(tower, tier, ctx) {
  const skill = skillFor(tower, tier);
  const s = tower.combatStats();
  
  let value = 0;
  
  // 基础价值：伤害倍率
  if (tier === 'signature') {
    value += s.dmg * 1.5;  // 假设招牌平均 150% 伤害
  } else {
    value += s.dmg * 3.0;  // 假设终极平均 300% 伤害
  }
  
  // 目标价值：可攻击敌人数量
  const targets = targetsInRange(tower, ctx);
  value *= Math.min(targets.length, 5);  // 最多计 5 个目标
  
  // 紧急度：生命值威胁
  const criticalEnemies = ctx.enemies.filter(e => 
    e.alive && e.pos.distanceTo(ctx.goal) < 10
  );
  if (criticalEnemies.length > 0) value *= 1.5;
  
  // 冷却成本：终极技能冷却更长，价值相应提升
  if (tier === 'ultimate') value *= 1.3;
  
  return value;
}

// 在自动施放逻辑中使用
export function autoSkillTiers(tower, ctx) {
  if (ctx.state !== 'combat' || ctx.paused) return [];
  
  const tiers = [];
  
  // 评估招牌和终极价值
  const sigValue = canUseSkill(tower, 'signature') 
    ? evaluateSkillValue(tower, 'signature', ctx) 
    : 0;
  const ultValue = (!tower.manualUltimate && canUseSkill(tower, 'ultimate'))
    ? evaluateSkillValue(tower, 'ultimate', ctx)
    : 0;
  
  // 优先释放价值更高的技能
  if (ultValue > sigValue * 1.2) {  // 终极价值需要显著高于招牌
    tiers.push('ultimate');
  } else if (sigValue > 0) {
    tiers.push('signature');
  }
  
  return tiers;
}
```

**预期效果**：
- 终极技能在关键时刻优先释放
- 减少招牌技能的浪费（敌人太少时不释放）
- 整体技能使用更智能

### 4.3 技能组合系统

**目标**：奖励同时释放多个技能的策略

**设计**：
- 同一时间窗口（2 秒内）释放 2+ 技能
- 触发组合效果：伤害 +15%，范围 +10%
- UI 提示："技能连锁！"

**实现**：
```javascript
// js/game/battle.js
class Battle {
  constructor() {
    // ...
    this.recentSkills = [];  // 最近 2 秒内释放的技能
  }

  castSkill(tower, tier) {
    // ...
    if (ok) {
      // 记录技能释放
      this.recentSkills.push({ tower, tier, time: this.time });
      
      // 清理 2 秒前的记录
      this.recentSkills = this.recentSkills.filter(
        s => this.time - s.time < 2
      );
      
      // 检测组合
      if (this.recentSkills.length >= 2) {
        this.activateCombo();
      }
    }
  }

  activateCombo() {
    this.comboActive = true;
    this.comboUntil = this.time + 3;
    
    // 显示 UI
    this.hooks.onCombo?.();
    
    // 对所有塔临时增益
    for (const tower of this.towers) {
      tower.comboBuff = { damagePct: 0.15, rangePct: 0.10 };
    }
    
    // 3 秒后移除
    setTimeout(() => {
      this.comboActive = false;
      for (const tower of this.towers) {
        delete tower.comboBuff;
      }
    }, 3000);
  }
}
```

**预期效果**：
- 增加玩家手动释放技能的动机
- 提升技能系统的策略深度
- 更有趣的游戏体验

---

## 5. 执行时间表

### 第 1 周（立即）

- [ ] **Day 1**：决策 Tesla 方案（A vs B）
- [ ] **Day 1-2**：实施 Tesla 调整（如果选方案 A）
- [ ] **Day 2**：运行第八轮验证（50 关）
- [ ] **Day 2**：分析结果，确认 Tesla 达标
- [ ] **Day 3**：决策 Sniper 处理方式
- [ ] **Day 3-4**：实施 Sniper 调整（如果需要）
- [ ] **Day 4**：运行第九轮验证
- [ ] **Day 5**：最终验证报告，确认 7/7 达标

### 第 2 周（短期）

- [ ] **Day 6-7**：固定塔配置改进
- [ ] **Day 8**：增加样本量（150 关）
- [ ] **Day 9**：专精分支统计实施
- [ ] **Day 10**：UI 改进（终极技能提示）

### 第 3-4 周（长期）

- [ ] **Week 3**：动态冷却系统开发
- [ ] **Week 4**：AI 决策改进
- [ ] **Week 4**：技能组合系统（可选）

---

## 6. 成功标准

### 6.1 必须达成（P0）

✅ **7/7 塔类平衡达标**：
- Arrow/Sniper/Cannon/Venom/Beacon：38-43% 终极占比
- Frost：12-20% 终极占比
- **Tesla：12-20% 终极占比**（当前未达标）

✅ **胜率稳定性**：
- 100/100 单元测试通过
- 50/50 模拟关卡通过（100% 胜率）

✅ **数据可靠性**：
- 消除 ±40% 随机波动
- 固定塔配置或 150+ 关样本量

### 6.2 期望达成（P1）

🎯 **玩家体验改进**：
- 终极技能就绪提示实施
- 技能统计面板显示

🎯 **文档完整性**：
- 第八轮验证报告
- 最终达标报告（7/7）

### 6.3 可选达成（P2）

💡 **系统优化**：
- 动态冷却系统上线
- AI 决策改进验证
- 技能组合系统测试

---

## 7. 风险管理

### 7.1 已知风险

⚠️ **Tesla 调整可能破坏通关**：
- 风险：过度削弱招牌导致胜率下降（第六轮教训）
- 缓解：每次调整单一维度，立即验证
- 应急：保留回滚能力（Git 提交）

⚠️ **Sniper 伤害可能再次波动**：
- 风险：随机配置导致数据不稳定
- 缓解：固定配置 + 增加样本量
- 应急：保守策略，接受现状

⚠️ **固定配置可能无法通关**：
- 风险：某些关卡可能需要特定塔配置
- 缓解：先测试 10 关，确认可行性
- 应急：保留随机配置作为备用

### 7.2 应急计划

**如果第八轮 Tesla 调整失败**：
1. 立即回滚代码（Git revert）
2. 选择方案 B（接受 5-10% 目标）
3. 更新文档，标记 Tesla 为"特殊情况"

**如果固定配置导致胜率下降**：
1. 分析失败关卡（哪些塔组合不可行）
2. 调整为"半固定配置"（5 座固定 + 2 座随机）
3. 或增加样本量至 200-300 关保持随机配置

---

## 8. 总结

### 8.1 核心目标

🎯 **最高优先级**：完成 Tesla 调整，达到 7/7 塔类平衡

### 8.2 推荐路径

**第 1 步**：实施 Tesla 方案 A（弱化招牌持续时间 + 增强终极）  
**第 2 步**：运行第八轮验证，确认达标  
**第 3 步**：固定塔配置 + 增加样本量，消除随机性  
**第 4 步**：最终大规模验证（150 关），编写达标报告  
**第 5 步**：UI 改进，提升玩家体验

### 8.3 预期时间线

- **1 周内**：完成 P0 调整，达到 7/7 达标
- **2 周内**：完成数据质量改进和 UI 改进
- **4 周内**：完成长期优化（可选）

### 8.4 最终交付物

📄 **文档**：
- G6 M4 最终报告（第八轮验证）
- G6 达标报告（7/7 塔类 100% 平衡）
- G6 项目总结（完整历程回顾）

💾 **代码**：
- Tesla 平衡调整（skills.js）
- 固定配置模拟器（simulate-balance.mjs）
- UI 改进（skill-buttons.js, skill-stats-panel.js）

🧪 **验证**：
- 100/100 单元测试通过
- 150/150 模拟关卡通过（100% 胜率）
- 7/7 塔类平衡达标（100%）

---

**项目状态**：⏳ M4 规划完成，等待实施决策  
**下一步**：确认 Tesla 方案选择（A vs B）  
**预计完成时间**：2026-09-19（7 天内）

---

*计划编写日期：2026-09-12*  
*项目负责人：Claude Opus 5*  
*当前阶段：M3 完成 → M4 启动*
