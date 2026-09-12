# G6 技能平衡项目 - 变更日志

**项目周期**：2026-09-12  
**记录范围**：基准测试 → 第七轮测试

---

## 概览

本文档记录 G6 技能平衡项目中所有代码变更的详细历史。

**变更统计**：
- 技能冷却调整：7 次
- 技能伤害调整：9 次
- 新增机制：1 次（Frost 增伤效果）
- 失败回滚：1 次（第六轮 Tesla 过度调整）

---

## 第七轮（2026-09-12 下午）

### ✅ Frost 终极增强

**提交**：5de8914

#### 调整 1：终极冷却缩短

**文件**：`js/game/skills.js:20`

```diff
 frost: {
   signature: { key: 'icePulse', name: '冰霜脉冲', unlockLevel: 3, cooldown: 16 },
-  ultimate: { key: 'frozenDomain', name: '极寒领域', unlockLevel: 8, cooldown: 24 }
+  ultimate: { key: 'frozenDomain', name: '极寒领域', unlockLevel: 8, cooldown: 20 }
 },
```

**原因**：提升终极技能使用频率  
**预期效果**：终极频率 +20%  
**实际效果**：终极频率 +117%（1.8 → 3.9/关）✓

#### 调整 2：增加增伤效果

**文件**：`js/game/skills.js:344-350`

```diff
 // castFrost 函数，终极技能 frozenDomain 部分
 for (const e of targets) {
   ctx.hitEnemy(e, Math.round(s.dmg * 3.0), {
     ...damageOpts(tower),
     effects: { frozen: { until: ctx.time + 3.5 } },
   });
+  // 新增：增伤效果
+  if (!e.effects) e.effects = {};
+  e.effects.frostVulnerable = {
+    sourceTowerId: tower.id,
+    until: ctx.time + 6,
+    allDamagePct: 0.15,
+  };
 }
```

**原因**：增加终极技能的团队协同价值（类似 Sniper 标记）  
**预期效果**：提升 AI 对终极技能的优先级判断  
**实际效果**：终极占比 7.8% → 13.8%（符合目标 12-20%）✓

**结果**：
- 胜率：50/50 (100%) ✓
- Frost 终极占比：13.8%（目标 12-20%）✓
- 6/7 塔类平衡达标（85.7%）✓

---

## 第六轮（2026-09-12 下午）❌ 已回滚

### ❌ Tesla 过度调整

**提交**：（未保留，已回滚）

#### 调整 1-4（失败）

```diff
 frost: {
   signature: { key: 'icePulse', name: '冰霜脉冲', unlockLevel: 3, cooldown: 16 },
-  ultimate: { key: 'frozenDomain', name: '极寒领域', unlockLevel: 8, cooldown: 24 }
+  ultimate: { key: 'frozenDomain', name: '极寒领域', unlockLevel: 8, cooldown: 20 }
 },
 tesla: {
-  signature: { key: 'overload', name: '过载', unlockLevel: 3, cooldown: 13 },
+  signature: { key: 'overload', name: '过载', unlockLevel: 3, cooldown: 16 },
-  ultimate: { key: 'empBlast', name: '电磁脉冲', unlockLevel: 8, cooldown: 22 }
+  ultimate: { key: 'empBlast', name: '电磁脉冲', unlockLevel: 8, cooldown: 18 }
 },
```

**原因**：同时调整 Frost 终极和 Tesla 招牌/终极冷却  
**结果**：
- 胜率：**49/50 (98%)** ❌
- W3-9 失败（仅 2 座塔：Venom + Cannon）
- Tesla 招牌冷却过长破坏通关能力

**教训**：单次调整不超过 2 个参数，避免过度削弱关键技能

**回滚决策**：立即回滚 Tesla 调整，仅保留 Frost 调整

---

## 第五轮（2026-09-12 下午）

### ✅ Sniper/Cannon 伤害削减

**提交**：c7e3a84

#### 调整 1：Sniper 弱点狙击伤害

**文件**：`js/game/skills.js:151-156`

```diff
 function castSniper(tower, tier, ctx) {
   // ...
   if (tier === 'signature') {
-    const basePct = 2.20;  // 220%
+    const basePct = 1.80;  // 180%
     let bonus = 0;
     if (e.def.shape === 'elite') {
-      bonus = mods.eliteBonus ?? 0.40;  // +40%
+      bonus = mods.eliteBonus ?? 0.30;  // +30%
     } else if (e.def.shape === 'boss') {
-      bonus = mods.bossBonus ?? 0.60;  // +60%
+      bonus = mods.bossBonus ?? 0.40;  // +40%
     }
     // ...
   }
 }
```

**原因**：第四轮数据显示 Sniper 招牌伤害过高（100,694）  
**预期效果**：招牌伤害 -20-25%  
**实际效果**：招牌伤害 -31.7%（100,694 → 68,795）✓

#### 调整 2：Cannon 集束炮击伤害

**文件**：`js/game/skills.js:189`

```diff
 function castCannon(tower, tier, ctx) {
   // ...
   if (tier === 'ultimate') {
     // 集束炮击：4 发子弹
     for (let i = 0; i < 4; i++) {
-      const bulletDmg = Math.round(s.dmg * 0.60);  // 60% 每发
+      const bulletDmg = Math.round(s.dmg * 0.50);  // 50% 每发
       // ...
     }
   }
 }
```

**原因**：第四轮数据显示 Cannon 伤害偏高  
**预期效果**：总伤害 240% → 200%（-16.7%）  
**实际效果**：招牌频率 -10.2%（9.8 → 8.8/关）✓

**结果**：
- 胜率：50/50 (100%) ✓
- Sniper/Cannon 伤害问题解决 ✓
- M2 阶段完成

---

## 第四轮（2026-09-12 中午）

### ✅ Beacon/Sniper 伤害调整 + 伤害追踪实施

**提交**：b9e4f21

#### 调整 1：Beacon 增益削减

**文件**：`js/game/skills.js:266-273`

```diff
 function castBeacon(tower, tier, ctx) {
   // ...
   if (tier === 'signature') {
     for (const t of targets) {
       t.buffedUntil = ctx.time + (6 + (mods.signatureDuration || 0));
-      t.beaconBuff = { damagePct: 0.28, speedPct: 0.22 };  // +28% 伤害, +22% 攻速
+      t.beaconBuff = { damagePct: 0.25, speedPct: 0.20 };  // +25% 伤害, +20% 攻速
     }
   } else {
     for (const t of targets) {
       t.buffedUntil = ctx.time + (10 + (mods.ultimateDuration || 0));
-      t.beaconBuff = { damagePct: 0.55, speedPct: 0.42 };  // +55% 伤害, +42% 攻速
+      t.beaconBuff = { damagePct: 0.45, speedPct: 0.35 };  // +45% 伤害, +35% 攻速
     }
   }
 }
```

**原因**：第三轮数据显示 Beacon 增益过强  
**预期效果**：Beacon 终极占比下降至 38-43%  
**实际效果**：Beacon 终极占比 42.4%（目标范围内）✓

#### 调整 2：Sniper 标记增伤削减

**文件**：`js/game/skills.js:164`

```diff
 function castSniper(tower, tier, ctx) {
   // ...
   if (tier === 'ultimate') {
     // 狙击标记
     e.effects.sniperMark = {
       sourceTowerId: tower.id,
       until: ctx.time + 8,
-      allDamagePct: 0.30,  // +30% 所有伤害
+      allDamagePct: 0.25,  // +25% 所有伤害
     };
   }
 }
```

**原因**：初步怀疑 Sniper 增益过强  
**预期效果**：降低团队总伤害输出  
**实际效果**：需要更详细的伤害数据追踪

#### 调整 3：Frost 招牌伤害削减

**文件**：`js/game/skills.js:332`

```diff
 function castFrost(tower, tier, ctx) {
   // ...
   if (tier === 'signature') {
     for (const e of targets) {
-      ctx.hitEnemy(e, Math.round(s.dmg * 0.80), {  // 80% 伤害
+      ctx.hitEnemy(e, Math.round(s.dmg * 0.60), {  // 60% 伤害
         ...damageOpts(tower),
         effects: { frozen: { until: ctx.time + 1.5 } },
       });
     }
   }
 }
```

**原因**：平衡招牌/终极伤害比例  
**预期效果**：招牌价值下降，AI 更倾向终极  
**实际效果**：对 AI 决策影响有限（AI 仅看冷却）

#### 调整 4：Frost 终极伤害提升

**文件**：`js/game/skills.js:344`

```diff
 function castFrost(tower, tier, ctx) {
   // ...
   if (tier === 'ultimate') {
     for (const e of targets) {
-      ctx.hitEnemy(e, Math.round(s.dmg * 2.50), {  // 250% 伤害
+      ctx.hitEnemy(e, Math.round(s.dmg * 3.00), {  // 300% 伤害
         ...damageOpts(tower),
         effects: { frozen: { until: ctx.time + 3.5 } },
       });
     }
   }
 }
```

**原因**：提升终极技能价值  
**预期效果**：终极伤害提升 20%  
**实际效果**：对 AI 决策影响有限

#### 调整 5：Tesla 过载伤害削减

**文件**：`js/game/skills.js:287`

```diff
 function castTesla(tower, tier, ctx) {
   // ...
   if (tier === 'signature') {
-    tower.overloadDmgPct = 0.85;  // 85% 伤害倍率
+    tower.overloadDmgPct = 0.75;  // 75% 伤害倍率
     tower.overloadUntil = ctx.time + 3;
   }
 }
```

**原因**：平衡 Tesla 招牌/终极伤害  
**预期效果**：招牌价值下降  
**实际效果**：对 AI 决策影响有限

#### 调整 6：Tesla 终极伤害提升

**文件**：`js/game/skills.js:303`

```diff
 function castTesla(tower, tier, ctx) {
   // ...
   if (tier === 'ultimate') {
     for (const e of targets) {
-      ctx.hitEnemy(e, Math.round(s.dmg * 1.80), {  // 180% 伤害
+      ctx.hitEnemy(e, Math.round(s.dmg * 2.20), {  // 220% 伤害
         ...damageOpts(tower),
         effects: { slow: { pct: 0.7, dur: 2.5 } },
       });
     }
   }
 }
```

**原因**：提升终极技能价值  
**预期效果**：终极伤害提升 22%  
**实际效果**：对 AI 决策影响有限

**结果**：
- 胜率：50/50 (100%) ✓
- Beacon 调整成功 ✓
- 识别需要伤害追踪系统
- 伤害调整对 AI 决策效果不明显

---

## 第三轮（跳过）

由于第二轮结果不理想，直接进入深入分析阶段，未进行代码调整。

---

## 第二轮（2026-09-12 上午）

### ⚠️ Frost 冷却进一步延长（效果不明显）

**提交**：a8f6d14

#### 调整 1：Frost 招牌冷却再延长

**文件**：`js/game/skills.js:19`

```diff
 frost: {
-  signature: { key: 'icePulse', name: '冰霜脉冲', unlockLevel: 3, cooldown: 15 },
+  signature: { key: 'icePulse', name: '冰霜脉冲', unlockLevel: 3, cooldown: 17 },
   ultimate: { key: 'frozenDomain', name: '极寒领域', unlockLevel: 8, cooldown: 24 }
 },
```

**原因**：第一轮 Frost 招牌频率仍偏高（28.2/关）  
**预期效果**：招牌频率 -10-15%  
**实际效果**：招牌频率 +11.3%（28.2 → 31.4/关）⚠️

**分析**：随机配置影响（Frost 出现 35 → 37 座），冷却调整边际效应递减

**结果**：
- 胜率：50/50 (100%) ✓
- 调整效果被随机性掩盖
- 识别需要新的平衡策略

---

## 第一轮（2026-09-12 上午）

### ✅ Frost/Tesla 冷却调整

**提交**：d2e8c55

#### 调整 1：Frost 招牌冷却延长

**文件**：`js/game/skills.js:19`

```diff
 frost: {
-  signature: { key: 'icePulse', name: '冰霜脉冲', unlockLevel: 3, cooldown: 12 },
+  signature: { key: 
