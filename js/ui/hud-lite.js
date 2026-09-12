// M3 轻量 HUD：资源条 + 塔坞 + 波次控制 + 选中塔面板（M5 全面美化重做）
const IS_TOUCH = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
import { ENEMY_DEFS } from '../game/units.js';
import { TOWER_DEFS, towerUnlocked } from '../game/towers.js';
import { skillFor } from '../game/skills.js';
import { createSpecModal } from './spec-modal.js';
const icon = (name) => `<img class="tool-icon" src="./vendor/lucide/${name}.svg" alt="">`;
export function createHud(battle, { audio, onSpeed, onQuit, onPause }) {
  // G5: 创建专精选择模态框
  const specModal = createSpecModal();
  const root = document.createElement('div');
  root.id = 'hud';
  root.innerHTML = `
    <div id="hud-top">
      <span id="hud-gold">💰 0</span>
      <span id="hud-lives">❤️ 0</span>
      <span id="hud-wave">波次 0/0</span>
      <span id="hud-state"></span>
    </div>
    <div id="hud-next" class="hidden"></div>
    <div id="hud-dock"></div>
    <div id="hud-panel" class="hidden"></div>
    <div id="hud-actions">
      <button id="btn-wave" class="hidden">${icon('play')}<span>开始下一波</span></button>
      <button id="btn-speed" title="战斗速度" aria-label="战斗速度">${icon('fast-forward')}<span>x1</span></button>
      <button id="btn-mute" title="静音" aria-label="静音">${icon('volume-2')}</button>
      <button id="btn-pause" title="暂停" aria-label="暂停">${icon('pause')}</button>
      <button id="btn-quit" title="撤退" aria-label="撤退">${icon('flag')}</button>
    </div>
    <div id="hud-cancel" class="hidden"><button id="btn-cancel">${icon('x')}取消建造</button></div>
    <div id="hud-hint" class="hidden"></div>
  `;
  document.body.appendChild(root);

  const $ = (s) => root.querySelector(s);
  const dock = $('#hud-dock');
  const panel = $('#hud-panel');
  const hint = $('#hud-hint');
  const nextEl = $('#hud-next');
  const btnWave = $('#btn-wave');
  const btnSpeed = $('#btn-speed');
  let panelKey = null;

  // ———— 下一波预览：敌人构成 + 飞行标记 + 波次强化倍率（让 HP 爬坡对玩家可见）————
  function updateNextWave() {
    if (battle.state === 'won' || battle.state === 'lost') { nextEl.classList.add('hidden'); return; }
    const idx = battle.waveIdx + 1;                       // 下一波（0 基）
    const waves = battle.level.waves;
    if (idx >= waves.length) {
      nextEl.classList.remove('hidden');
      nextEl.innerHTML = '<b>⚡ 最终波</b> 守住！';
      return;
    }
    const wv = waves[idx];
    const parts = wv.groups.map((g) => {
      const def = ENEMY_DEFS[g.type];
      if (!def) return null;
      return `${def.name}×${g.count}${def.fly ? '<span class="fly">🕊飞行</span>' : ''}`;
    }).filter(Boolean);
    const ramp = 1 + Math.max(0, idx - 1) * (battle.level.waveHpRamp ?? 0);
    const rampTag = ramp > 1.001 ? ` <span class="ramp">⚔️×${ramp.toFixed(2)}</span>` : '';
    nextEl.classList.remove('hidden');
    nextEl.innerHTML = (wv.boss ? '<b>👑 BOSS 波</b> ' : '<b>下一波</b> ') + parts.join(' · ') + rampTag;
  }

  // 塔坞
  const DOCK = Object.values(TOWER_DEFS);
  const cards = {};
  for (const d of DOCK) {
    const b = document.createElement('button');
    b.className = 'dock-card';
    b.dataset.tower = d.key;
    b.innerHTML = `<img src="${d.icon}" alt="" class="dock-thumb"><b>${d.name}</b><i>${d.cost}</i>`;
    b.onclick = () => {
      audio?.click();
      const levelIndex = (battle.level.worldIdx ?? 0) * 10 + (battle.level.lvlIdx ?? 0);
      if (!towerUnlocked(d.key, levelIndex)) { api.hint('该塔将在更高关卡解锁'); return; }
      battle.selectBuild(battle.selectedType === d.key ? null : d.key);
    };
    dock.appendChild(b);
    cards[d.key] = { b, cost: d.cost };
  }

  function refreshDock() {
    const levelIndex = (battle.level.worldIdx ?? 0) * 10 + (battle.level.lvlIdx ?? 0);
    for (const [key, c] of Object.entries(cards)) {
      c.b.classList.toggle('sel', battle.selectedType === key);
      c.b.classList.toggle('poor', battle.gold < c.cost);
      const locked = !towerUnlocked(key, levelIndex);
      c.b.classList.toggle('locked', locked);
      const unlock = TOWER_DEFS[key].unlockIndex;
      const stage = `W${Math.floor(unlock / 10) + 1}-${unlock % 10 + 1}`;
      c.b.disabled = locked || !battle.canCommand();
      c.b.setAttribute('aria-pressed', battle.selectedType === key);
      c.b.querySelector('i').textContent = locked ? stage : c.cost;
      c.b.title = locked ? `${stage} 解锁` : TOWER_DEFS[key].desc || TOWER_DEFS[key].name;
    }
    // 建造模式显示取消芯片（触摸设备没有右键，必须有可见的退出途径）
    root.querySelector('#hud-cancel').classList.toggle('hidden', !battle.selectedType);
  }

  function showPanel(t) {
    if (!t) { panel.classList.add('hidden'); panelKey = null; return; }
    const s = t.combatStats();
    const isMax = !t.canUpgrade();
    panel.classList.remove('hidden');
    const key = `${t.id}:${t.level}:${t.specialization}`;
    // Only structural changes rebuild controls; ticking cooldowns preserve focus and pointer capture.
    if (panelKey !== key) {
      panelKey = key;
      const spec = t.specializationOptions().find((o) => o.branch === t.specialization);
      const skills = ['signature', 'ultimate'].map((tier) => {
        const skill = skillFor(t, tier);
        if (!skill || t.level + 1 < skill.unlockLevel) return '';
        return `<button class="skill-btn" data-tier="${tier}" title="${skill.name} (${tier === 'signature' ? 'Z' : 'X'})">${icon(tier === 'signature' ? 'zap' : 'sparkles')}<span>${skill.name}</span><small></small></button>`;
      }).join('');
      panel.innerHTML = `
        <div class="tower-heading"><img class="dock-thumb" src="${t.def.icon}" alt=""><b>${t.def.name}<span class="lv ${isMax ? 'max-tag' : ''}">Lv.${t.level + 1}${isMax ? ' MAX' : ''}</span></b></div>
        ${spec ? `<div class="spec-tag">${spec.name}</div>` : ''}
        <div class="stats"></div>
        ${skills ? `<div class="skill-row">${skills}</div>` : ''}
        ${t.requiresSpecialization() ? `<div class="spec-row"><small>Lv.6 专精 · ${t.upgradeCost()} 金</small>${t.specializationOptions().map((o) => `<button class="spec-btn" data-branch="${o.branch}" title="${o.desc}">${icon('git-branch')}${o.name}</button>`).join('')}</div>` : ''}
        ${skillFor(t, 'ultimate') && t.level + 1 >= 8 ? '<label class="skill-mode"><input id="p-mode" type="checkbox">终阶自动施放</label>' : ''}
        <div class="row">
          ${t.canUpgrade() && !t.requiresSpecialization() ? `<button id="p-up" title="升级到 Lv.${t.level + 2}">${icon('arrow-up')}<span>Lv.${t.level + 2} · ${t.upgradeCost()} 金</span></button>` : (isMax ? '<span class="max">已达最高级</span>' : '')}
          <button id="p-sell">${icon('coins')}<span>出售 ${t.sellValue()}</span></button>
        </div>`;
      const up = panel.querySelector('#p-up');
      if (up) up.onclick = () => { if (battle.upgradeSelected()) audio?.upgradeSnd(); };
      // G5: 专精按钮改为打开模态框
      for (const btn of panel.querySelectorAll('.spec-btn')) btn.onclick = () => {
        specModal.show(t, (branch) => {
          if (battle.upgradeSelected(branch)) audio?.upgradeSnd();
        });
      };
      for (const btn of panel.querySelectorAll('.skill-btn')) btn.onclick = () => {
        if (!battle.useSelectedSkill(btn.dataset.tier)) audio?.click();
        showPanel(t);
      };
      panel.querySelector('#p-mode')?.addEventListener('change', () => {
        battle.toggleSelectedUltimateMode();
        showPanel(t);
      });
      panel.querySelector('#p-sell').onclick = () => { if (battle.sellSelected()) audio?.sell(); };
    }
    const poison = s.poison ? t.poisonSpec() : null;
    const extra = poison ? `中毒 ${poison.damage.toFixed(1)}/层 · 上限 ${poison.maxStacks} 层` : s.aura ? `伤害 +${(s.aura.damagePct * 100).toFixed(0)}% · 攻速 +${(s.aura.ratePct * 100).toFixed(0)}% · 技能加速 +${(s.aura.skillCooldownPct * 100).toFixed(0)}%` : s.slow ? `减速 ${(s.slow.pct * 100).toFixed(0)}%` : s.chains ? `连锁 ${s.chains}` : s.splash ? `溅射 ${s.splash.toFixed(1)}` : s.pierce ? '穿甲' : '';
    panel.querySelector('.stats').textContent = s.kind === 'support'
      ? `光环 ${s.range.toFixed(1)} · ${extra}`
      : `伤害 ${s.dmg} · 攻速 ${s.rate.toFixed(2)}/s · 射程 ${s.range.toFixed(1)}${extra ? ' · ' + extra : ''}`;
    for (const btn of panel.querySelectorAll('#p-up, .spec-btn')) btn.disabled = !battle.canCommand() || battle.gold < t.upgradeCost();
    for (const btn of panel.querySelectorAll('.skill-btn')) {
      const ready = t.canUseSkill(btn.dataset.tier);
      btn.disabled = !battle.canCommand() || battle.state !== 'combat' || !ready;
      btn.classList.toggle('ready', !btn.disabled);
      btn.querySelector('small').textContent = ready ? (battle.state === 'combat' ? '就绪' : '待战') : `${t.skillRemaining(btn.dataset.tier).toFixed(1)}s`;
    }
    panel.querySelector('#p-sell').disabled = !battle.canCommand();
    const mode = panel.querySelector('#p-mode');
    if (mode) { mode.checked = !t.manualUltimate; mode.disabled = !battle.canCommand(); }
  }

  const api = {
    root,
    gold(v) {
      const el = $('#hud-gold');
      el.textContent = `💰 ${v}`;
      el.classList.remove('pulse');
      void el.offsetWidth;
      el.classList.add('pulse');
      refreshDock();
      showPanel(battle.selectedTower);
    },
    lives(v) { $('#hud-lives').textContent = `❤️ ${v}`; },
    wave(cur, total, boss) {
      $('#hud-wave').textContent = `波次 ${cur}/${total}` + (boss ? ' 👑BOSS' : '');
      if (boss) api.banner('👑 BOSS 来袭！');
      btnWave.classList.add('hidden'); // 波已开打（无论手动/倒计时自动），收起开波按钮
      btnWave.classList.remove('rush');
      updateNextWave();
    },
    state(txt) { $('#hud-state').textContent = txt || ''; },
    intermission(sec) {
      btnWave.classList.remove('hidden');
      const bonus = battle.earlyCallBonus(Math.max(0, sec));
      if (sec > 0.15) {
        btnWave.classList.add('rush');
        btnWave.querySelector('span').textContent = `提前开战 +${bonus} (${sec.toFixed(0)}s)`;
      } else {
        btnWave.classList.remove('rush');
        btnWave.querySelector('span').textContent = '下一波即将开始…';
      }
    },
    hideWaveBtn() { btnWave.classList.add('hidden'); },
    hint(txt) {
      if (!txt) { hint.classList.add('hidden'); return; }
      hint.classList.remove('hidden');
      hint.textContent = txt;
    },
    banner(txt) {
      const b = document.createElement('div');
      b.className = 'banner';
      b.textContent = txt;
      root.appendChild(b);
      setTimeout(() => b.remove(), 1800);
    },
    onSelectChanged() {
      refreshDock();
      showPanel(battle.selectedTower);
      api.hint(battle.selectedType
        ? (IS_TOUCH ? '点空地放置 · 拖动可平移视角' : '点击空地放置（右键取消）')
        : '');
    },
    update(dt = 0) {
      api._panelT = (api._panelT || 0) - dt;
      if (api._panelT > 0) return;
      api._panelT = 0.15;
      refreshDock();
      showPanel(battle.selectedTower);
    },
    end(win) {
      api.hint('');
      btnWave.classList.add('hidden');
      const b = document.createElement('div');
      b.className = 'banner big';
      b.textContent = win ? '🏆 胜利！' : '💀 失败…';
      root.appendChild(b);
      setTimeout(() => b.remove(), 2600); // 结算弹窗已接管，横幅短暂展示后移除
    },
  };

  // 开波按钮：休整期=提前开战（拿奖励金）；建造期=正常开战
  btnWave.onclick = () => {
    if (battle.state === 'intermission') battle.callWaveEarly();
    else battle.startWave();
    api.hideWaveBtn();
  };
  const speeds = [1, 2, 3];
  let spIdx = 0;
  btnSpeed.onclick = () => {
    spIdx = (spIdx + 1) % speeds.length;
    battle.speed = speeds[spIdx];
    btnSpeed.querySelector('span').textContent = `x${speeds[spIdx]}`;
    onSpeed?.(speeds[spIdx]);
  };
  $('#btn-mute').onclick = (e) => {
    const m = !audio.muted;
    audio.setMuted(m);
    e.currentTarget.innerHTML = icon(m ? 'volume-x' : 'volume-2');
    e.currentTarget.title = m ? '取消静音' : '静音';
    e.currentTarget.setAttribute('aria-label', e.currentTarget.title);
  };
  $('#btn-pause').onclick = () => onPause?.();
  root.querySelector('#btn-cancel').onclick = () => battle.selectBuild(null);
  $('#btn-quit').onclick = () => onQuit();

  api.setSpeedLabel = (m) => { spIdx = Math.max(0, speeds.indexOf(m)); btnSpeed.querySelector('span').textContent = `x${m}`; };

  // 钩子链化：不覆盖 main 预先注册的监听者
  const chain = (key, fn) => {
    const prev = battle.hooks[key];
    battle.hooks[key] = (...args) => { prev?.(...args); fn(...args); };
  };
  chain('onGold', (v) => api.gold(v));
  chain('onLives', (v) => api.lives(v));
  chain('onWave', (c, t, boss) => api.wave(c, t, boss));
  chain('onSelectChanged', () => api.onSelectChanged());
  chain('onWaveClear', (n) => api.banner(`第 ${n} 波清除！+${battle._lastBonus ?? 30}💰`));
  chain('onIntermission', (sec) => api.intermission(sec));
  chain('onEarlyCall', (bonus) => {
    api.banner(`⏩ 提前开战 +${bonus}💰`);
    audio?.coin();
  });
  chain('onEnd', (r) => api.end(r.win));

  api.gold(battle.gold);
  api.lives(battle.lives);
  api.wave(0, battle.level.waves.length, false);
  // 建造阶段就要显示开波按钮（此前仅波间倒计时显示，导致开局找不到入口）
  if (battle.state === 'build') btnWave.classList.remove('hidden');
  return api;
}
