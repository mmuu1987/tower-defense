# G5 技能 UI 设计规格

**日期**：2026-09-12  
**负责人**：Claude Opus 5  
**状态**：✅ 已实现

---

## 1. 技能冷却视觉反馈

### 1.1 设计目标
玩家在战斗中需要快速判断技能是否就绪，当前实现的纯文字倒计时不够直观。

### 1.2 解决方案：径向进度条

#### 视觉效果
- **位置**：技能按钮左侧内嵌
- **形状**：20×20px 圆形
- **颜色**：半透明白色 `#ffffff55`
- **动画**：顺时针填充，从 0% 到 100%
- **就绪状态**：进度条淡出，按钮变绿

#### CSS 实现
```css
#hud-panel .skill-btn {
  position: relative;
}

#hud-panel .skill-btn::before {
  content: '';
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: conic-gradient(
    #ffffff55 calc(var(--progress, 0) * 100%),
    transparent 0
  );
  opacity: var(--cooling, 0);
  pointer-events: none;
  transition: opacity 0.15s;
}

#hud-panel .skill-btn.ready::before {
  opacity: 0;
}
```

#### JavaScript 更新
在 `hud-lite.js` 的 `refreshPanel()` 中：

```javascript
for (const btn of panel.querySelectorAll('.skill-btn')) {
  const tier = btn.dataset.tier;
  const skill = skillFor(t, tier);
  if (skill) {
    const remaining = t.skillRemaining(tier);
    const progress = remaining > 0 ? 1 - (remaining / skill.cooldown) : 1;
    btn.style.setProperty('--progress', progress.toFixed(3));
    btn.style.setProperty('--cooling', remaining > 0 ? '1' : '0');
  }
}
```

### 1.3 用户体验

**冷却中**：
```
[◐ 集束炮击] 8.3s
 ↑
 径向进度条
 已完成 40%
```

**即将就绪**（< 1 秒）：
```
[◕ 集束炮击] 0.2s
 ↑
 进度条 95%
 按钮开始变绿
```

**就绪**：
```
[✓ 集束炮击] 就绪
 ↑
 进度条淡出
 绿色边框
```

---

## 2. 技能音效占位

### 2.1 音效分类

| 塔类型 | 招牌技能音效 | 终极技能音效 |
|--------|--------------|--------------|
| **Arrow** | 连续射击 (0.4s) | 箭雨落下 (0.7s) |
| **Cannon** | 炮击齐射 (0.5s) | 地毯轰炸 (0.8s) |
| **Sniper** | 精准狙击 (0.3s) | 标记锁定 (0.6s) |
| **Tesla** | 电流过载 (0.4s) | 电磁脉冲 (0.7s) |
| **Frost** | 冰环爆发 (0.4s) | 极寒领域 (0.8s) |
| **Venom** | 毒液爆破 (0.4s) | 毒云扩散 (0.7s) |
| **Beacon** | 号令冲锋 (0.5s) | 超载指令 (0.8s) |

### 2.2 音效触发

在 `battle.js` 的 `castSkill` 调用后：

```javascript
ctx.onSkill?.(tower, tier);
```

在 `client-main.js` 中：

```javascript
battle.hooks.onSkill = (tower, tier) => {
  const key = `${tower.key}_${tier}`;
  audio?.skillSnd?.(key);
};
```

### 2.3 音效资源规划

**文件命名**：
```
audio/skills/
├── arrow_signature.mp3
├── arrow_ultimate.mp3
├── cannon_signature.mp3
├── cannon_ultimate.mp3
├── sniper_signature.mp3
├── sniper_ultimate.mp3
├── tesla_signature.mp3
├── tesla_ultimate.mp3
├── frost_signature.mp3
├── frost_ultimate.mp3
├── venom_signature.mp3
├── venom_ultimate.mp3
├── beacon_signature.mp3
└── beacon_ultimate.mp3
```

**音量**：
- 招牌技能：0.4-0.6
- 终极技能：0.6-0.8
- 允许用户在设置中调整

---

## 3. 技能快捷键提示

### 3.1 设计

在技能按钮右上角显示小标签：

```html
<button class="skill-btn" data-tier="signature">
  集束炮击
  <kbd class="skill-key">Z</kbd>
  <small>8.3s</small>
</button>
```

### 3.2 样式

```css
.skill-key {
  position: absolute;
  top: 4px;
  right: 4px;
  padding: 2px 4px;
  font-size: 10px;
  font-weight: 600;
  background: #1a1d26;
  border: 1px solid #3a4556;
  border-radius: 3px;
  color: #8b92a7;
  pointer-events: none;
}

@media (max-width: 700px) {
  .skill-key { display: none; }
}
```

### 3.3 响应式

- **桌面**：显示 Z/X 标签
- **平板/手机**：隐藏（触摸无键盘）

---

## 4. 技能特效增强

### 4.1 当前状态

所有技能使用统一的 `ctx.fx.ring()` 标记：

```javascript
ctx.fx.ring(pos, radius, color, duration);
```

### 4.2 增强方案

#### 招牌技能：双层波纹
```javascript
ctx.fx.ring(pos, radius * 0.8, color, 0.3);
ctx.fx.ring(pos, radius, color, 0.4);
ctx.fx.flash(pos, color, 10, 0.15);
```

#### 终极技能：冲击波 + 震动
```javascript
ctx.fx.ring(pos, radius * 0.6, color, 0.4);
ctx.fx.ring(pos, radius, color, 0.6);
ctx.fx.shockwave(pos, radius);
ctx.screenShake?.(0.2, 3);
```

### 4.3 颜色主题

| 塔 | 招牌技能色 | 终极技能色 |
|----|-----------|-----------|
| Arrow | `#d8e8ff` | `#ffd36a` |
| Cannon | `#ff9a4a` | `#ff6a3a` |
| Sniper | `#ffea6a` | `#ff4a6a` |
| Tesla | `#6aaaff` | `#3a8aff` |
| Frost | `#6ad4ff` | `#3aa4ff` |
| Venom | `#8dff79` | `#75e66f` |
| Beacon | `#62d7ff` | `#ffd36a` |

---

## 5. 实现优先级

### P0（必须有）
- [x] 技能冷却进度条 ✅
- [ ] 技能音效占位

### P1（应该有）
- [ ] 快捷键提示标签
- [ ] 技能特效增强

### P2（可以有）
- [ ] 技能释放动画（按钮缩放）
- [ ] 技能连击提示（连续释放 3+ 技能）
- [ ] 技能统计面板（战后显示技能使用次数）

---

## 6. 测试计划

### 6.1 单元测试
- [x] 专精选择模态框测试
- [ ] 技能音效触发测试（模拟）

### 6.2 集成测试
- [ ] 实际游戏中测试冷却进度条
- [ ] 验证进度条在不同冷却时间下的准确性
- [ ] 验证就绪状态的视觉反馈

### 6.3 性能测试
- [ ] 检查进度条更新对帧率的影响
- [ ] 验证 CSS 变量更新性能（60 FPS 目标）

---

## 7. 已知限制

1. **进度条精度**：使用 `toFixed(3)` 限制 CSS 变量更新频率
2. **音效资源**：尚未准备音频文件，当前为占位实现
3. **特效性能**：多层特效可能在低端设备上影响帧率

---

**最后更新**：2026-09-12  
**实现状态**：技能冷却进度条已完成，音效占位待实现
