// 专精选择模态框 - G5 UI 增强
import { specializationFor } from '../game/skills.js';

export function createSpecModal({ battle = null } = {}) {
  const modal = document.createElement('div');
  modal.id = 'spec-modal';
  modal.className = 'hidden';
  modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-content">
      <h3>选择专精分支 <small>此选择永久生效，无法撤销</small></h3>
      <div class="spec-cards"></div>
    </div>
  `;
  document.body.appendChild(modal);

  const backdrop = modal.querySelector('.modal-backdrop');
  const cards = modal.querySelector('.spec-cards');
  
  let onChoose = null;
  let pausedByModal = false;

  function formatModifier(key, value) {
    // 格式化修改器显示
    if (key.endsWith('Pct')) {
      const pct = Math.round(value * 100);
      const sign = pct > 0 ? '+' : '';
      const label = key.replace('Pct', '').replace(/([A-Z])/g, ' $1').trim();
      const name = {
        'damage': '伤害',
        'rate': '攻速',
        'splash': '溅射半径',
        'elite Damage': '对精英伤害',
        'boss Damage': '对Boss伤害',
        'signature Cooldown': '招牌技能冷却',
        'ultimate Damage': '终极技能伤害',
        'signature Damage': '招牌技能伤害',
        'slow': '减速强度',
        'slow Duration': '减速持续',
        'slowed Damage': '对减速目标伤害',
        'poison Damage': '毒伤',
        'heal Block': '治疗抑制',
        'aura Damage': '光环伤害',
        'aura Rate': '光环攻速',
        'aura Skill Cooldown': '光环技能加速',
      }[label] || label;
      return `${name} ${sign}${pct}%`;
    }
    
    // 绝对值修改器
    const absNames = {
      'armorPenetration': '护甲穿透',
      'chains': '连锁目标',
      'signatureRadius': '招牌技能范围',
      'signatureDuration': '过载持续时间',
      'poisonMaxStacks': '毒层上限',
    };
    if (absNames[key]) {
      const sign = value > 0 ? '+' : '';
      return `${absNames[key]} ${sign}${value}`;
    }
    
    // 布尔修改器
    if (key === 'trueDamage' && value) return '所有伤害视为真实伤害';
    
    // 特殊修改器
    if (key === 'critChance') return `暴击几率 ${Math.round(value * 100)}%`;
    if (key === 'critMultiplier') return `暴击倍率 ×${value}`;
    if (key === 'slow' && typeof value === 'object') {
      return `攻击附带 ${Math.round(value.pct * 100)}% 减速 (${value.dur}秒)`;
    }
    
    return null;
  }

  const api = {
    show(tower, callback) {
      if (!tower || !tower.requiresSpecialization()) return;
      
      onChoose = callback;
      const options = tower.specializationOptions();
      
      cards.innerHTML = options.map((opt) => {
        const spec = specializationFor(tower.key, opt.branch);
        if (!spec) return '';
        
        const mods = Object.entries(spec.modifiers)
          .map(([k, v]) => formatModifier(k, v))
          .filter(Boolean);
        
        const icon = opt.branch === 'A' ? '🔹' : '🔸';
        
        return `
          <div class="spec-card" data-branch="${opt.branch}">
            <div class="spec-icon">${icon}</div>
            <h4>${spec.name}</h4>
            <p class="spec-desc">${spec.desc}</p>
            <ul class="spec-mods">
              ${mods.map(m => `<li>${m}</li>`).join('')}
            </ul>
            <button class="spec-choose" data-branch="${opt.branch}">选择此专精</button>
          </div>
        `;
      }).join('');
      
      // 绑定按钮事件
      for (const btn of cards.querySelectorAll('.spec-choose')) {
        btn.onclick = () => {
          const branch = btn.dataset.branch;
          const choose = onChoose;
          api.hide();
          choose?.(branch);
        };
      }
      
      // 暂停游戏（如果正在战斗）
      if (battle && !battle.paused) {
        pausedByModal = true;
        battle.setPaused(true);
      }
      
      modal.classList.remove('hidden');
      // 聚焦到第一个按钮（可访问性）
      cards.querySelector('.spec-choose')?.focus();
    },
    
    hide() {
      modal.classList.add('hidden');
      
      // 恢复游戏
      if (battle && pausedByModal) {
        battle.setPaused(false);
        pausedByModal = false;
      }
      onChoose = null;
    },
    
    destroy() {
      api.hide();
      modal.remove();
    },
  };
  
  // 点击背景关闭（但专精选择必须做出决定，所以这里只是聚焦提示）
  backdrop.onclick = () => {
    cards.querySelector('.spec-choose')?.focus();
    // 添加震动提示
    modal.querySelector('.modal-content').classList.add('shake');
    setTimeout(() => modal.querySelector('.modal-content').classList.remove('shake'), 300);
  };
  
  return api;
}
