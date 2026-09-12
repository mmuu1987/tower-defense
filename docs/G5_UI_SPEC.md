# G5 UI 设计规格

**日期**：2026-09-12  
**阶段**：G5 - UI 与用户体验  
**目标**：使技能系统对玩家完全可见和可操作

---

## 1. 设计原则

### 1.1 渐进式增强
- 保持现有 M3 轻量 HUD 的简洁风格
- 不破坏已有的塔信息面板结构
- 技能 UI 作为 Lv.4+ 的自然扩展
- 专精选择在 Lv.6 关键节点弹窗确认

### 1.2 信息层级
**优先级排序**：
1. 技能就绪状态（绿色高亮 + "就绪"文字）
2. 冷却剩余时间（实时倒计时）
3. 技能名称和图标
4. 专精选择（仅 Lv.6 显示）

### 1.3 交互反馈
- 技能按钮：就绪=绿边框 + 可点击，冷却中=灰色 + 倒计时
- 专精按钮：Lv.6 升级时弹窗二选一，一旦选择不可撤销
- 终极技能模式切换：复选框切换自动/手动

---

## 2. 现有实现分析

### 2.1 已完成的 UI 元素（hud-lite.js）

#### 技能按钮行（Lv.4+ 显示）
```javascript
// 行 112-113：技能按钮生成
const skills = ['signature', 'ultimate'].map((tier) => {
  const skill = skillFor(t, tier);
  if (!skill || t.level + 1 < skill.unlockLevel) return '';
  return `<button class="skill-btn" data-tier="${tier}" title="${skill.name} (${tier === 'signature' ? 'Z' : 'X'})">${icon(tier === 'signature' ? 'zap' : 'sparkles')}<span>${skill.name}</span><small></small></button>`;
}).join('');
```

**现状**：
- ✅ 招牌技能（Lv.4+）显示闪电图标 ⚡
- ✅ 终极技能（Lv.8+）显示火花图标 ✨
- ✅ 倒计时显示在 `<small>` 元素中
- ✅ 就绪状态显示 "就绪" 文字
- ✅ 冷却中显示 "X.Xs" 格式

**更新逻辑（行 146-151）**：
```javascript
for (const btn of panel.querySelectorAll('.skill-btn')) {
  const ready = t.canUseSkill(btn.dataset.tier);
  btn.disabled = !battle.canCommand() || battle.state !== 'combat' || !ready;
  btn.classList.toggle('ready', !btn.disabled);
  btn.querySelector('small').textContent = ready ? (battle.state === 'combat' ? '就绪' : '待战') : `${t.skillRemaining(btn.dataset.tier).toFixed(1)}s`;
}
```

#### 专精选择（Lv.6 显示）
```javascript
// 行 119：专精按钮行
${t.requiresSpecialization() ? `<div class="spec-row"><small>Lv.6 专精 · ${t.upgradeCost()} 金</small>${t.specializationOptions().map((o) => `<button class="spec-btn" data-branch="${o.branch}" title="${o.desc}">${icon('git-branch')}${o.name}</button>`).join('')}</div>` : ''}
```

**现状**：
- ✅ Lv.6 时显示 A/B 两个专精按钮
- ✅ 按钮禁用逻辑与金币挂钩
- ✅ 点击后调用 `battle.upgradeSelected(branch)`

**问题**：
- ❌ 没有专精详细说明弹窗（玩家只能看到 title 提示）
- ❌ 没有专精效果预览（修改器数值不可见）
- ❌ 选择后没有确认动画

#### 终极技能模式（Lv.8+ 显示）
```javascript
// 行 120：自动施放复选框
${skillFor(t, 'ultimate') && t.level + 1 >= 8 ? '<label class="skill-mode"><input id="p-mode" type="checkbox">终阶自动施放</label>' : ''}
```

**现状**：
- ✅ Lv.8+ 显示复选框
- ✅ 默认勾选（自动施放）
- ✅ 取消勾选后需手动点击终极技能按钮

### 2.2 CSS 样式（style.css）

#### 技能按钮样式（行 156-159）
```css
#hud-panel .skill-row{ display:flex; flex-direction:column; gap:5px; margin-bottom:8px; }
#hud-panel .skill-btn{ justify-content:flex-start; height:36px; flex:none; }
#hud-panel .skill-btn small{ margin-left:auto; width:48px; flex:none; text-align:right; font-variant-numeric:tabular-nums; }
#hud-panel .skill-btn.ready{ border-color:#7bd39b99; color:#e1f5db; }
```

**现状**：
- ✅ 就绪状态有绿色边框和浅绿文字
- ✅ 倒计时右对齐，等宽字体
- ✅ 按钮高度固定 36px

#### 专精样式（行 160-162）
```css
.spec-row{ display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:8px; }
.spec-row>small{ grid-column:1/-1; color:#efca79; }
.spec-tag{ font-size:11px; color:#efca79; margin-top:4px; }
```

**现状**：
- ✅ 两列网格布局
- ✅ 金色标签文字（#efca79）
- ✅ 选择后显示 `.spec-tag`

---

## 3. G5 优化任务清单

### 3.1 优先级 P0（核心功能）

#### ✅ 任务 1：技能按钮基础功能
**状态**：已完成（G4 实现）
- 技能解锁显示
- 冷却倒计时
- 就绪状态切换
- 点击施放

#### ✅ 任务 2：专精选择基础功能
**状态**：已完成（G4 实现）
- Lv.6 时显示 A/B 按钮
- 点击升级并锁定选择
- 选择后显示专精标签

#### ✅ 任务 3：终极技能模式切换
**状态**：已完成（G4 实现）
- 自动/手动切换复选框
- 手动模式下只能点击施放

### 3.2 优先级 P1（用户体验增强）

#### 🔲 任务 4：专精选择弹窗
**目标**：Lv.6 升级时弹出模态框，展示 A/B 两个专精的详细信息

**设计**：
```html
<div id="spec-modal">
  <div class="modal-backdrop"></div>
  <div class="modal-content">
    <h3>选择专精分支 <small>此选择永久生效</small></h3>
    <div class="spec-cards">
      <!-- 专精 A -->
      <div class="spec-card" data-branch="A">
        <div class="spec-icon">🔹</div>
        <h4>专精名称 A</h4>
        <p class="spec-desc">描述文字</p>
        <ul class="spec-mods">
          <li>修改器 1：+XX%</li>
          <li>修改器 2：+YY</li>
        </ul>
        <button class="spec-choose">选择此专精</button>
      </div>
      <!-- 专精 B -->
      <div class="spec-card" data-branch="B">
        <!-- 同上 -->
      </div>
    </div>
  </div>
</div>
```

**交互流程**：
1. 玩家点击 Lv.5 → Lv.6 升级按钮
2. `battle.upgradeSelected()` 检测到 `requiresSpecialization() === true`
3. 暂停游戏，弹出专精选择模态框
4. 玩家点击 "选择此专精" 按钮
5. 调用 `battle.upgradeSelected(branch)`
6. 关闭模态框，恢复游戏
7. 塔面板刷新，显示专精标签

**实现要点**：
- 模态框背景半透明遮罩
- 两个专精卡片横向排列
- 修改器数值从 `SKILL_DEFS[key].specializations[branch].modifiers` 读取
- 格式化显示（百分比、绝对值、冷却缩减等）

#### 🔲 任务 5：技能冷却视觉优化
**目标**：在技能按钮上叠加径向进度条

**设计方案**：
- CSS `conic-gradient` 实现圆形进度条
- 叠加在按钮左侧图标上
- 冷却中：灰色扇形逐渐减小
- 就绪时：扇形消失，绿色边框出现

**示例 CSS**：
```css
.skill-btn::before {
  content: '';
  position: absolute;
  left: 8px; top: 50%;
  transform: translateY(-50%);
  width: 20px; height: 20px;
  border-radius: 50%;
  background: conic-gradient(#ffffff44 calc(var(--progress) * 100%), transparent 0);
  opacity: var(--cooling, 0);
}
```

**实现要点**：
- 每次面板刷新时计算 `--progress = 1 - (remaining / cooldown)`
- 就绪时设置 `--cooling: 0`

#### 🔲 任务 6：技能施放音效
**目标**：每个技能释放时播放对应音效

**资源需求**：
- 招牌技能：中等音效（0.3-0.5 秒）
- 终极技能：重音效（0.6-0.8 秒）
- 可使用现有 `audio.js` 系统

**实现**：
```javascript
// 在 castSkill 成功后
ctx.onSkill?.(tower, tier);
// 音效钩子
battle.hooks.onSkill = (tower, tier) => {
  audio.playSkill(tower.key, tier);
};
```

### 3.3 优先级 P2（锦上添花）

#### 🔲 任务 7：技能特效增强
**目标**：优化现有 `ctx.fx.ring()` 和 `ctx.fx.flash()` 的视觉效果

**增强方向**：
- 招牌技能：环形波纹 + 中心闪光
- 终极技能：双层冲击波 + 屏幕震动
- 不同塔类型使用不同颜色主题

**实现要点**：
- 复用 Three.js 现有的粒子系统
- 不增加性能负担（移动端 60fps）

#### 🔲 任务 8：技能快捷键提示
**目标**：在技能按钮上显示快捷键（Z / X）

**设计**：
```html
<button class="skill-btn" data-tier="signature">
  <span class="skill-key">Z</span>
  <span class="skill-name">连射</span>
  <small>就绪</small>
</button>
```

**CSS**：
```css
.skill-key {
  display: inline-block;
  width: 20px; height: 20px;
  background: #ffffff1a;
  border-radius: 3px;
  font-size: 11px;
  line-height: 20px;
  text-align: center;
}
```

#### 🔲 任务 9：塔升级预览
**目标**：升级按钮上显示下一等级的属性变化

**设计**：
```html
<button id="p-up">
  <span>Lv.3 → Lv.4</span>
  <small>伤害 +15 · 射程 +0.5</small>
  <i>200 金</i>
</button>
```

**实现要点**：
- 调用 `statsFor(key, level+1)` 获取下一等级数据
- 计算差值并格式化（仅显示有变化的属性）

---

## 4. 技术实现路径

### 4.1 文件修改清单

#### js/ui/hud-lite.js
- **修改点 1**：专精选择逻辑（行 127-129）
  - 当前：直接调用 `battle.upgradeSelected(branch)`
  - 改进：改为 `showSpecModal(tower, branch => battle.upgradeSelected(branch))`
- **修改点 2**：技能按钮渲染（行 112-113）
  - 添加快捷键标签
  - 添加进度条容器
- **修改点 3**：面板刷新（行 146-151）
  - 计算并设置 CSS 变量 `--progress`

#### css/style.css
- **新增**：`.spec-modal` 相关样式（模态框、卡片、按钮）
- **新增**：`.skill-btn::before` 进度条样式
- **优化**：`.skill-btn.ready` 动画效果（脉冲/发光）

#### js/game/battle.js（可能需要修改）
- **检查点**：`upgradeSelected()` 是否支持延迟回调
- **检查点**：`canCommand()` 在模态框打开时的行为

### 4.2 新增文件

#### js/ui/spec-modal.js（新文件）
```javascript
export function createSpecModal() {
  // 模态框创建和管理逻辑
  // 接收 tower、A/B 专精数据、回调函数
  // 返回 { show(tower, onChoose), hide() }
}
```

### 4.3 集成测试要点

- Lv.5 → Lv.6 升级流程完整
- 专精选择后塔属性正确应用
- 技能按钮在不同等级的显示/隐藏
- 冷却倒计时精度（0.1s 更新）
- 手动/自动模式切换正确

---

## 5. 验收标准

### 5.1 P0 功能（已完成）
- [x] 技能按钮在 Lv.4+ 显示
- [x] 冷却倒计时实时更新
- [x] 就绪状态视觉反馈
- [x] 专精选择按钮在 Lv.6 显示
- [x] 终极技能模式切换

### 5.2 P1 功能（G5 目标）
- [ ] 专精选择弹窗完整实现
- [ ] 专精修改器数值可视化
- [ ] 技能冷却径向进度条
- [ ] 技能施放音效

### 5.3 P2 功能（后续优化）
- [ ] 技能特效增强
- [ ] 快捷键提示
- [ ] 升级预览

---

## 6. 下一步行动

### 立即开始（本次 commit）
1. 创建专精选择弹窗 UI 结构
2. 实现专精数据格式化显示
3. 集成到升级流程

### 短期（下 1-2 次 commit）
4. 技能冷却进度条
5. 技能音效占位

### 中期（G5 后续）
6. 特效优化
7. 快捷键提示
8. 全面测试和调优

---

**文档版本**：1.0  
**下次更新**：专精弹窗实现完成后
