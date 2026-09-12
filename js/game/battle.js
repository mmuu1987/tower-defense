// 战斗编排：波次生成/敌人生命周期/经济/建造与选塔/胜负判定
import * as THREE from 'three';
import { GRID } from './config.js';
import { Enemy, Tower, Projectiles } from './entities.js';
import { ENEMY_DEFS, BOSS_DEFS } from './units.js';
import { towerCost, towerUnlocked, TOWER_DEFS } from './towers.js';
import { SpatialIndex } from './spatial-index.js';
import { targetMatches, xzDistanceSq } from './combat.js';
import { applyPoison } from './effects.js';
import { EconomyLedger } from './economy.js';
import { childProfiles } from './enemy-stats.js';

const ALL_DEFS = { ...ENEMY_DEFS, ...BOSS_DEFS };
export const SIMULATION_STEP = 1 / 60;

export class Battle {
  constructor({ scene, level, sampler, samplers = [sampler], pathCells, blockedCells = new Set(), heightAt = () => 0, fx, hooks = {} }) {
    this.scene = scene;
    this.level = level;
    this.sampler = sampler;
    this.samplers = samplers;
    this.pathCells = pathCells;
    this.blockedCells = blockedCells;
    this.heightAt = heightAt;
    this._spawnSerial = 0;
    this.fx = fx;
    this.hooks = hooks;

    this.gold = level.startGold;
    this.lives = level.lives;
    this.waveIdx = -1;              // 已开始的波
    this.state = 'build';           // build | combat | won | lost
    this.enemies = [];
    this.enemyIndex = new SpatialIndex(4);
    this.towers = [];
    this.towerIndex = new SpatialIndex(4);
    this.fields = [];
    this.paused = false;
    this.accumulator = 0;
    this.occupied = new Map();      // "cx,cz" -> Tower
    this.spawnQueue = [];           // {t, profile, ticket}
    this.intermission = 0;
    this.speed = 1;
    this.time = 0;
    this.kills = 0;
    this.leaks = 0;
    // G3: 账本系统
    this.ledger = new EconomyLedger(level.startGold);

    this.selectedType = null;       // 待建造的塔类型
    this.selectedTower = null;

    this.projectiles = new Projectiles(scene);
    this._tangentTmp = new THREE.Vector3();
  }

  // ———— 建造 ————
  isBuildable(cx, cz) {
    if (!Number.isInteger(cx) || !Number.isInteger(cz)) return false;
    if (cx < 0 || cz < 0 || cx >= GRID.w || cz >= GRID.h) return false;
    if (this.pathCells.has(`${cx},${cz}`)) return false;
    if (this.blockedCells.has(`${cx},${cz}`)) return false;
    return !this.occupied.has(`${cx},${cz}`);
  }

  tryPlace(cx, cz) {
    if (!this.selectedType) return false;
    if (!this.canCommand()) return false;
    const tdef = this.selectedType;
    if (!TOWER_DEFS[tdef]) return 'invalid';
    const levelIndex = (this.level.worldIdx ?? 0) * 10 + (this.level.lvlIdx ?? 0);
    if (!towerUnlocked(tdef, levelIndex)) return 'locked';
    const cost = this.costOf(tdef);
    if (!Number.isFinite(cost) || cost < 0) return 'invalid';
    if (!this.isBuildable(cx, cz)) return 'blocked';
    if (this.gold < cost) return 'poor';
    const tower = new Tower(tdef, cx, cz);
    tower.placeAt(this.cellCenter(cx, cz));
    this.scene.add(tower.mesh);
    this.towers.push(tower);
    this.towerIndex.insert(tower);
    this.occupied.set(`${cx},${cz}`, tower);
    this.gold -= cost;
    // G3: 账本记录建造
    this.ledger?.register({ id: 'build:' + tower.id, kind: 'build', amount: -cost, wave: this.waveIdx, time: this.time, tower: tdef });
    this.refreshTowerStats();
    this.hooks.onGold?.(this.gold);
    this.hooks.onBuild?.(tower);
    this.selectTower(tower);
    return true;
  }

  costOf(key) {
    return towerCost(key);
  }
  cellCenter(cx, cz) {
    const x = cx - GRID.w / 2 + 0.5, z = cz - GRID.h / 2 + 0.5;
    return new THREE.Vector3(x, this.heightAt(x, z), z);
  }
  towerAt(cx, cz) { return this.occupied.get(`${cx},${cz}`) || null; }

  canCommand() { return !this.paused && this.state !== 'won' && this.state !== 'lost'; }
  setPaused(value) { this.paused = !!value; this.accumulator = 0; }
  refreshTowerStats() {
    const ctx = this._ctx();
    for (const tower of this.towers) tower._refreshCombatStats(ctx);
  }
  ownsTower(t) { return !!t && !t.disposed && this.occupied.get(t.cx + ',' + t.cz) === t; }
  isTowerUnlocked(key) { return towerUnlocked(key, (this.level.worldIdx ?? 0) * 10 + (this.level.lvlIdx ?? 0)); }
  selectBuild(key) {
    if (!this.canCommand() || (key && !this.isTowerUnlocked(key))) return false;
    this.selectedType = key; this.selectedTower = null; this.hooks.onSelectChanged?.(this);
    return true;
  }
  selectTower(t) { this.selectedType = null; this.selectedTower = t || null; this.hooks.onSelectChanged?.(this); }
  clearSelection() { this.selectedType = null; this.selectedTower = null; this.hooks.onSelectChanged?.(this); }

  upgradeTower(t, branch = null) {
    if (!this.canCommand() || !this.ownsTower(t) || !t.canUpgrade()) return false;
    const c = t.upgradeCost();
    if (!Number.isFinite(c) || c <= 0 || this.gold < c || !t.upgrade(branch)) return false;
    this.gold -= c;
    // G3: 账本记录升级
    this.ledger?.register({ id: 'upgrade:' + t.id + ':' + t.level, kind: 'upgrade', amount: -c, wave: this.waveIdx, time: this.time,
      tower: t.key, level: t.level, branch: branch ?? 'none' });
    this.refreshTowerStats();
    this.hooks.onGold?.(this.gold);
    this.hooks.onSelectChanged?.(this);
    return true;
  }
  upgradeSelected(branch = null) { return this.upgradeTower(this.selectedTower, branch); }
  useSelectedSkill(tier = 'signature') {
    if (!this.canCommand() || !this.ownsTower(this.selectedTower)) return false;
    return this.selectedTower.useSkill(tier, this._ctx());
  }
  toggleSelectedUltimateMode() {
    if (!this.canCommand() || !this.ownsTower(this.selectedTower)) return false;
    return this.selectedTower?.toggleUltimateMode() ?? false;
  }
  sellSelected() {
    const t = this.selectedTower;
    if (!this.canCommand() || !this.ownsTower(t)) return false;
    const refund = t.sellValue();
    this.gold += refund;
    // G3: 账本记录出售
    this.ledger?.register({ id: 'sell:' + t.id, kind: 'sell', amount: refund, wave: this.waveIdx, time: this.time, tower: t.key });
    t.dispose(this.scene);
    this.towers.splice(this.towers.indexOf(t), 1);
    this.towerIndex.remove(t);
    this.occupied.delete(`${t.cx},${t.cz}`);
    for (const field of [...this.fields]) if (field.sourceId === t.id) this.removeField(field);
    this.refreshTowerStats();
    this.clearSelection();
    this.hooks.onGold?.(this.gold);
    return true;
  }

  // ———— 波次 ————
  startWave() {
    if (!this.canCommand()) return;
    if (this.state === 'won' || this.state === 'lost' || this.state === 'combat') return;
    if (this.waveIdx >= this.level.waves.length - 1) return; // 已是最后一波
    if (this.waveIdx + 1 >= this.level.waves.length) return;
    this.waveIdx++;
    const wave = this.level.waves[this.waveIdx];
    this.spawnQueue = [];
    // G3: 使用 wave.groups 的 profile、bounties 和 routes 数据
    for (const g of wave.groups) {
      const tickets = [];
      for (let i = 0; i < g.count; i++) {
        tickets.push({ groupId: g.id, unit: i, bounty: g.bounties[i], route: g.routes[i] });
      }
      // 注册家族预算（用于召唤物赏金限制）
      if (this.ledger) {
        this.ledger.registerFamily(g.id, wave.budget.bounty, tickets.map((t) => ({ id: t.groupId + ':' + t.unit, amount: t.bounty })),
          { wave: this.waveIdx, type: g.type });
      }
      for (let i = 0; i < g.count; i++) {
        this.spawnQueue.push({ t: g.delay + i * g.gap, profile: g.profile, ticket: tickets[i] });
      }
    }
    this.spawnQueue.sort((a, b) => a.t - b.t);
    this.state = 'combat';
    this.hooks.onWave?.(this.waveIdx + 1, this.level.waves.length, wave.boss);
  }

  get waveCleared() {
    return this.state === 'combat' && this.spawnQueue.length === 0 &&
      this.enemies.every((e) => !e.alive);
  }

  // ———— 提前开战：波间休整期跳过剩余倒计时，按剩余秒数返还奖励金 ————
  // 设计意图：与波次 HP 爬坡配合——休整时间是"备战资源"，高手可拿它换经济，但要少几秒布阵窗口
  earlyCallBonus(remainSec) {
    const upcoming = this.waveIdx + 1;   // 即将开始的一波（0 基）
    return Math.round(remainSec * (4 + upcoming * 1.0));
  }

  callWaveEarly() {
    if (!this.canCommand() || this.state !== 'intermission') return 0;
    const remain = Math.max(0, this.intermission);
    const bonus = remain > 0.05 ? this.earlyCallBonus(remain) : 0;
    if (bonus > 0) {
      this.gold += bonus;
      this._lastEarlyBonus = bonus;
      // G3: 账本记录提前开战奖励
      this.ledger?.register({ id: 'early:' + this.waveIdx + ':' + this.time, kind: 'early', amount: bonus, wave: this.waveIdx + 1, time: this.time });
      this.hooks.onGold?.(this.gold);
      this.hooks.onEarlyCall?.(bonus, remain);
    }
    this.startWave();
    return bonus;
  }

  // All combat timers use the same fixed simulation step; long stalls are bounded.
  update(dtRaw) {
    if (!this.canCommand() || !Number.isFinite(dtRaw) || dtRaw <= 0) return;
    const speed = [1, 2, 3].includes(this.speed) ? this.speed : 1;
    this.accumulator += Math.min(dtRaw, 0.25) * speed;
    while (this.accumulator + 1e-9 >= SIMULATION_STEP) {
      this.accumulator = Math.max(0, this.accumulator - SIMULATION_STEP);
      this._step(SIMULATION_STEP);
      if (!this.canCommand()) { this.accumulator = 0; break; }
    }
  }

  _step(dt) {
    this.time += dt;

    // 出兵
    for (const ev of this.spawnQueue) ev.t -= dt;
    while (this.spawnQueue.length && this.spawnQueue[0].t <= 0) {
      const ev = this.spawnQueue.shift();
      this.spawnEnemy(ev.profile, ev.ticket);
    }

    // 敌人
    const ctx = this._ctx();
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.update(dt, ctx);
      if (!e.alive) continue;
      if (e.hp <= 0) { this.kill(e); continue; }
      this.enemyIndex.update(e);
      if (e.dist >= e.sampler.total) {
        // 漏怪：立即标记清理（否则尸体永久堆积 → 数组膨胀 + 显存泄漏 → 越玩越卡）
        e.alive = false;
        e.disposed = true;
        this.enemyIndex.remove(e);
        this.lives--;
        this.leaks++;
        this.hooks.onLeak?.(e);
        this.hooks.onLives?.(this.lives);
      }
    }
    for (const e of this.enemies) if (e.dying) e.updateDeath(dt);
    // 死亡结算
    for (const e of this.enemies) {
      if (e.alive && e.hp <= 0) this.kill(e);
    }

    this.updateFields(dt);
    // 塔与弹道
    for (const t of this.towers) t.update(dt, ctx);
    this.projectiles.update(dt, ctx);
    this.fx.update(dt);

    // 清理尸体（死亡动画播完才移除；漏怪立即移除）
    let dirty = false;
    const remain = [];
    for (const e of this.enemies) {
      if (!e.disposed) remain.push(e);
      else { e.dispose(this.scene); dirty = true; }
    }
    if (dirty) this.enemies = remain;
    if (this.lives <= 0) {
      this.state = 'lost';
      this.clearFields();
      this.hooks.onEnd?.({ win: false });
      return;
    }

    // 波次推进
    if (this.state === 'combat') {
      if (this.waveCleared) {
        if (this.waveIdx >= this.level.waves.length - 1) {
          this.state = 'won';
          this.clearFields();
          this.hooks.onEnd?.({ win: true });
          return;
        }
        // G3: 清波奖励从波次预算读取
        const wave = this.level.waves[this.waveIdx];
        const bonus = wave.budget.clear;
        this.gold += bonus;
        // G3: 账本记录清波奖励
        this.ledger?.register({ id: 'clear:' + this.waveIdx, kind: 'clear', amount: bonus, wave: this.waveIdx, time: this.time });
        this.hooks.onGold?.(this.gold);
        this.intermission = this.level.intermission;
        this.state = 'intermission';
        this._lastBonus = bonus;
        this.hooks.onWaveClear?.(this.waveIdx + 1);
      }
    } else if (this.state === 'intermission') {
      this.intermission -= dt;
      this.hooks.onIntermission?.(Math.max(0, this.intermission));
      if (this.intermission <= 0) this.startWave();
    }

  }

  spawnEnemy(profile, ticket) {
    const def = ALL_DEFS[profile.type];
    if (!def) return;
    const sampler = this.samplers[ticket.route % this.samplers.length];
    // G3: 使用 profile 的完整数据（hp、armor、resistance、speed 等）
    const e = new Enemy(def, { sampler, profile, ticket });
    sampler.at(0, e.pos);
    e.mesh.position.x = e.pos.x;
    e.mesh.position.z = e.pos.z;
    this.scene.add(e.mesh);
    this.enemies.push(e);
    this.enemyIndex.insert(e);
    return e;
  }

  kill(e) {
    if (!e || e.dying || !e.alive) return false;
    e.startDeath(); // 死亡动画/沉没序列（alive=false, dying=true）
    this.enemyIndex.remove(e);
    this.kills++;
    // G3: 通过账本领取赏金
    if (e.ticket && this.ledger) {
      const amount = this.ledger.claim(e.ticket.groupId, e.ticket.groupId + ':' + e.ticket.unit,
        { wave: this.waveIdx, time: this.time, type: e.def.type });
      if (amount !== null) this.gold += amount;
    }
    // 死亡光柱：灵魂升天特效
    this.fx.beam?.(e.pos.clone().setY(0.1), e.def.color ?? 0xffffff, e.def.shape === 'boss' ? 5 : 2.6);
    this.hooks.onGold?.(this.gold);
    this.hooks.onKill?.(e);
    this.fx.burst(e.pos.clone().setY(0.5), e.def.color, e.def.shape === 'boss' ? 40 : 10);
    // G3: 召唤物使用 childProfiles
    if (e.profile && (e.def.splitInto || e.def.deathSpawn)) {
      const children = childProfiles(e.profile, e.generation ?? 0);
      for (let i = 0; i < children.length; i++) {
        const childProfile = children[i];
        const childTicket = { groupId: e.ticket?.groupId ?? 'summon-' + e.id, unit: i, bounty: 0, route: e.ticket?.route ?? 0 };
        const child = new Enemy(ALL_DEFS[childProfile.type], { sampler: e.sampler, profile: childProfile, ticket: childTicket });
        child.generation = (e.generation ?? 0) + 1;
        child.dist = Math.max(0, e.dist - i * 0.5);
        child.sampler.at(child.dist, child.pos);
        child.mesh.position.x = child.pos.x;
        child.mesh.position.z = child.pos.z;
        this.scene.add(child.mesh);
        this.enemies.push(child);
        this.enemyIndex.insert(child);
      }
    }
    return true;
  }

  hitEnemy(e, dmg, opts) {
    if (!e?.alive) return null;
    const applied = e.hurt(dmg, opts);
    if (opts?.effects?.poison) applyPoison(e, opts.effects.poison);
    if (applied > 0) this.hooks.onHit?.(e, applied, e.lastDamage);
    if (e.alive && e.hp <= 0) this.kill(e);
    return e.lastDamage;
  }

  explode(pos, dmg, splash, targetMask = 'ground', damageOpts = {}) {
    if (!Number.isFinite(splash) || splash <= 0) return;
    // 焦痕贴花 + 冲击波球
    if (damageOpts.effects?.poison) this.fx.ring?.(pos, splash, 0x75e66f, 0.4);
    else {
      this.fx.decal?.(pos, splash * 1.05);
      this.fx.shockwave?.(pos.clone().setY(0.25), splash);
    }
    let targets = this.enemyIndex.queryRadius(pos.x, pos.z, splash, (e) => targetMatches(targetMask, e));
    if (Number.isFinite(damageOpts.targetLimit)) {
      targets = targets.sort((a, b) => xzDistanceSq(a.pos, pos) - xzDistanceSq(b.pos, pos) || a.id - b.id)
        .slice(0, Math.max(0, Math.floor(damageOpts.targetLimit)));
    }
    for (const e of targets) this.hitEnemy(e, dmg, damageOpts);
    this.hooks.onExplosion?.(pos, splash);
  }

  createPoisonField(tower, pos, { radius, duration, poison, targetLimit = 12 }) {
    if (!this.canCommand() || this.state !== 'combat' || !this.ownsTower(tower) || tower.key !== 'venom' ||
        ![pos?.x, pos?.z, radius, duration, targetLimit, poison?.damage].every(Number.isFinite) ||
        radius <= 0 || duration <= 0 || targetLimit < 1 || poison.damage <= 0) return false;
    for (const field of [...this.fields]) if (field.sourceId === tower.id) this.removeField(field);
    if (this.fields.length >= 32) return false;
    const r = Math.min(4, radius);
    const mesh = new THREE.Group();
    mesh.position.set(pos.x, this.heightAt(pos.x, pos.z) + 0.07, pos.z);
    const surface = new THREE.Mesh(new THREE.CircleGeometry(r, 32),
      new THREE.MeshBasicMaterial({ color: 0x65b959, transparent: true, opacity: 0.18, depthWrite: false }));
    const edge = new THREE.Mesh(new THREE.RingGeometry(r - 0.08, r, 32),
      new THREE.MeshBasicMaterial({ color: 0xaff787, transparent: true, opacity: 0.65, depthWrite: false }));
    surface.rotation.x = edge.rotation.x = -Math.PI / 2;
    edge.position.y = 0.01;
    mesh.add(surface, edge);
    this.scene.add(mesh);
    const field = { sourceId: tower.id, mesh, pos: mesh.position, radius: r, remaining: Math.min(8, duration),
      tick: 0.75, poison: { ...poison }, targetLimit: Math.min(12, Math.floor(targetLimit)) };
    this.fields.push(field);
    this.pulseField(field);
    return true;
  }

  pulseField(field) {
    const targets = this.enemyIndex.queryRadius(field.pos.x, field.pos.z, field.radius, (e) => targetMatches('ground', e))
      .sort((a, b) => xzDistanceSq(a.pos, field.pos) - xzDistanceSq(b.pos, field.pos) || a.id - b.id);
    for (const e of targets.slice(0, field.targetLimit)) applyPoison(e, field.poison);
  }

  updateFields(dt) {
    for (const field of [...this.fields]) {
      field.remaining -= dt;
      if (field.remaining <= 1e-9) { this.removeField(field); continue; }
      field.tick -= dt;
      if (field.tick <= 1e-9) { field.tick += 0.75; this.pulseField(field); }
      field.mesh.children[0].material.opacity = Math.min(1, field.remaining) * (0.18 + Math.sin(this.time * 3) * 0.035);
    }
  }

  removeField(field) {
    if (!this.fields.includes(field)) return;
    this.scene.remove(field.mesh);
    for (const mesh of field.mesh.children) { mesh.geometry.dispose(); mesh.material.dispose(); }
    this.fields.splice(this.fields.indexOf(field), 1);
  }
  clearFields() { for (const field of [...this.fields]) this.removeField(field); }

  _ctx() {
    return {
      enemies: this.enemies,
      towers: this.towers,
      supportTowers: this.towers.filter((t) => !t.disposed && t.key === 'beacon'),
      state: this.state,
      paused: this.paused,
      time: this.time,
      camera: this.hooks.camera,
      fx: this.fx,
      projectiles: this.projectiles,
      queryEnemiesRadius: (x, z, radius, predicate) => this.enemyIndex.queryRadius(x, z, radius, predicate),
      queryTowersRadius: (x, z, radius, predicate) => this.towerIndex.queryRadius(x, z, radius, predicate),
      createPoisonField: (tower, pos, spec) => this.createPoisonField(tower, pos, spec),
      onSkill: (tower, tier) => this.hooks.onSkill?.(tower, tier),
      hitEnemy: (e, d, o) => this.hitEnemy(e, d, o),
      applyPoison: (e, spec) => applyPoison(e, spec),
      explode: (p, d, s, mask, opts) => this.explode(p, d, s, mask, opts),
      tangentOf: (e) => e.sampler.tangentAt(e.dist, this._tangentTmp),
    };
  }

  snapshot() {
    return {
      state: this.state, gold: this.gold, lives: this.lives,
      wave: this.waveIdx + 1, totalWaves: this.level.waves.length,
      enemies: this.enemies.filter((e) => e.alive).length,
      towers: this.towers.length, speed: this.speed,
      kills: this.kills, leaks: this.leaks,
    };
  }

  // 战斗结束/退出时清理场景中的所有战斗实体（地形装饰保留）
  destroy() {
    for (const e of this.enemies) e.dispose(this.scene);
    this.enemies = [];
    for (const t of this.towers) t.dispose(this.scene);
    this.towers = [];
    this.occupied.clear();
    this.enemyIndex.clear?.();
    this.towerIndex.clear();
    this.clearFields();
    this.selectedTower = null;
    this.selectedType = null;
    this.accumulator = 0;
    for (const p of this.projectiles.list) this.scene.remove(p.mesh);
    this.projectiles.list = [];
    this.spawnQueue = [];
    this.state = 'lost';
  }
}
