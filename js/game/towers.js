// Tower registry and shared mesh assets. Display levels are one-based; data indices are zero-based.
// 造价设计（2026-09-02 平衡轮）：Lv1-3 沿用旧价（前期手感已验证），
//   Lv4/Lv5 大幅提价 —— 后期塔全满级后金币无出口是"中后期无压力+钱花不完"的核心成因，
//   把满级做成真正昂贵的长期目标，让富余金币有地方去（数据见 tools/econprobe.mjs）。
import * as THREE from 'three';
import { hasModel, makeInstance, makeInstanceWithMaterials, loadOne } from '../engine/modellib.js';

const WEAPON_MODEL = {
  arrow: 'weapon_ballista',
  cannon: 'weapon_cannon',
  sniper: 'weapon_turret',
  tesla: 'tower_crystals',
  frost: 'crystal_large',
};
const WEAPON_ROT = { arrow: 0, cannon: Math.PI / 2, sniper: 0, tesla: 0, frost: 0 }; // 模型朝向修正（截图校准）
const WEAPON_TINT = { arrow: 0x9a7a44, cannon: 0x5a709a, sniper: 0x4a8a62, tesla: 0x9a6ae0, frost: 0x6ad4ff }; // 五塔辨识色

export const TOWER_DEFS = {
  arrow: {
    key: 'arrow', name: '箭塔', hotkey: '1', icon: './assets/textures/ui/tower_arrow.png', unlockIndex: 0, cost: 70, kind: 'proj', proj: 'arrow', projSpeed: 12,
    dmg: 15, rate: 1.25, range: 3.4, targets: 'both', damageType: 'physical', targeting: 'threat', desc: '射速快的可靠单体输出',
    lvls: [
      null,
      { cost: 60,  dmg: 24, rate: 1.4,  range: 3.7 },
      { cost: 115, dmg: 38, rate: 1.6,  range: 4.1 },
      { cost: 340, dmg: 60, rate: 1.85, range: 4.5 },
      { cost: 780, dmg: 98, rate: 2.2,  range: 5.0 },
      { cost: 1180, dmg: 142, rate: 2.5, range: 5.25 },
      { cost: 1680, dmg: 198, rate: 2.8, range: 5.5 },
      { cost: 2420, dmg: 274, rate: 3.1, range: 5.8 },
    ],
  },
  cannon: {
    key: 'cannon', name: '炮塔', hotkey: '2', icon: './assets/textures/ui/tower_cannon.png', unlockIndex: 0, cost: 110, kind: 'mortar', projSpeed: 8,
    dmg: 32, rate: 0.55, range: 3.1, splash: 1.7, targets: 'ground', damageType: 'physical', targeting: 'progress', desc: '范围溅射，无法对空',
    lvls: [
      null,
      { cost: 100, dmg: 52, rate: 0.58, range: 3.3, splash: 1.9 },
      { cost: 170, dmg: 85, rate: 0.62, range: 3.5, splash: 2.2 },
      { cost: 500, dmg: 140, rate: 0.68, range: 3.8, splash: 2.6 },
      { cost: 1120, dmg: 235, rate: 0.75, range: 4.2, splash: 3.1 },
      { cost: 1660, dmg: 330, rate: 0.81, range: 4.5, splash: 3.35 },
      { cost: 2320, dmg: 448, rate: 0.88, range: 4.8, splash: 3.6 },
      { cost: 3260, dmg: 600, rate: 0.96, range: 5.1, splash: 3.9 },
    ],
  },
  frost: {
    key: 'frost', name: '寒霜塔', hotkey: '3', icon: './assets/textures/ui/tower_frost.png', unlockIndex: 0, cost: 90, kind: 'pulse',
    dmg: 10, rate: 0.9, range: 2.9, slow: { pct: 0.48, dur: 2.0 }, targets: 'both', damageType: 'magic', targeting: 'fastest', desc: '冰环减速周围敌人',
    lvls: [
      null,
      { cost: 80,  dmg: 18, rate: 0.95, range: 3.1, slow: { pct: 0.55, dur: 2.3 } },
      { cost: 140, dmg: 30, rate: 1.0,  range: 3.4, slow: { pct: 0.62, dur: 2.7 } },
      { cost: 410, dmg: 48, rate: 1.1,  range: 3.7, slow: { pct: 0.70, dur: 3.1 } },
      { cost: 920, dmg: 80, rate: 1.25, range: 4.2, slow: { pct: 0.78, dur: 3.6 } },
      { cost: 1380, dmg: 112, rate: 1.34, range: 4.45, slow: { pct: 0.81, dur: 3.9 } },
      { cost: 1940, dmg: 154, rate: 1.44, range: 4.7, slow: { pct: 0.84, dur: 4.2 } },
      { cost: 2720, dmg: 210, rate: 1.56, range: 4.95, slow: { pct: 0.87, dur: 4.5 } },
    ],
  },
  tesla: {
    key: 'tesla', name: '特斯拉塔', hotkey: '4', icon: './assets/textures/ui/tower_tesla.png', unlockIndex: 0, cost: 130, kind: 'chain',
    dmg: 19, rate: 0.8, range: 3.2, chains: 3, targets: 'both', damageType: 'magic', targeting: 'support', chainRange: 2.4, desc: '闪电链打击多个敌人',
    lvls: [
      null,
      { cost: 110, dmg: 30, rate: 0.85, range: 3.4, chains: 4 },
      { cost: 190, dmg: 48, rate: 0.9,  range: 3.7, chains: 5 },
      { cost: 560, dmg: 76, rate: 1.0,  range: 4.0, chains: 7 },
      { cost: 1250, dmg: 125, rate: 1.15, range: 4.4, chains: 9 },
      { cost: 1840, dmg: 170, rate: 1.24, range: 4.7, chains: 11 },
      { cost: 2580, dmg: 228, rate: 1.34, range: 5.0, chains: 13 },
      { cost: 3620, dmg: 302, rate: 1.46, range: 5.3, chains: 15 },
    ],
  },
  sniper: {
    key: 'sniper', name: '狙击塔', hotkey: '5', icon: './assets/textures/ui/tower_sniper.png', unlockIndex: 0, cost: 150, kind: 'proj', proj: 'bullet', projSpeed: 34,
    dmg: 72, rate: 0.34, range: 6.6, pierce: true, targets: 'both', damageType: 'physical', targeting: 'strongest', desc: '超远射程，无视护甲',
    lvls: [
      null,
      { cost: 130, dmg: 115, rate: 0.38, range: 7.0 },
      { cost: 210, dmg: 180, rate: 0.42, range: 7.5 },
      { cost: 620, dmg: 290, rate: 0.48, range: 8.2 },
      { cost: 1380, dmg: 460, rate: 0.55, range: 9.0 },
      { cost: 2020, dmg: 620, rate: 0.61, range: 9.4 },
      { cost: 2840, dmg: 820, rate: 0.68, range: 9.8 },
      { cost: 3980, dmg: 1080, rate: 0.76, range: 10.2 },
    ],
  },
  venom: {
    key: 'venom', name: '毒蚀塔', hotkey: '6', icon: './assets/textures/ui/tower_venom.svg', unlockIndex: 6, cost: 120, kind: 'proj', proj: 'venom', projSpeed: 16,
    dmg: 14, rate: 0.78, range: 4.15, targets: 'ground', damageType: 'magic', targeting: 'progress',
    poison: { damage: 4, duration: 4, maxStacks: 4, healBlock: 2 }, desc: '毒弹叠层并抑制治疗，擅长消耗长路线地面目标',
    lvls: [
      null,
      { cost: 95, dmg: 21, rate: 0.84, range: 4.35, poison: { damage: 5, duration: 4.2, maxStacks: 4, healBlock: 2.2 } },
      { cost: 155, dmg: 30, rate: 0.91, range: 4.55, poison: { damage: 6, duration: 4.4, maxStacks: 5, healBlock: 2.5 } },
      { cost: 430, dmg: 43, rate: 1.0, range: 4.8, poison: { damage: 8, duration: 4.8, maxStacks: 5, healBlock: 3 } },
      { cost: 820, dmg: 60, rate: 1.1, range: 5.05, poison: { damage: 10, duration: 5.1, maxStacks: 6, healBlock: 3.5 } },
      { cost: 1260, dmg: 82, rate: 1.2, range: 5.25, poison: { damage: 13, duration: 5.4, maxStacks: 6, healBlock: 4 } },
      { cost: 1780, dmg: 110, rate: 1.31, range: 5.45, poison: { damage: 17, duration: 5.7, maxStacks: 7, healBlock: 4.5 } },
      { cost: 2480, dmg: 146, rate: 1.43, range: 5.7, poison: { damage: 22, duration: 6.0, maxStacks: 7, healBlock: 5 } },
    ],
  },
  beacon: {
    key: 'beacon', name: '指挥塔', hotkey: '7', icon: './assets/textures/ui/tower_beacon.svg', unlockIndex: 10, cost: 200, kind: 'support',
    dmg: 0, rate: 1, range: 4.5, targets: 'both', damageType: 'true', targeting: 'threat',
    aura: { damagePct: 0.12, ratePct: 0.08, skillCooldownPct: 0.06 }, desc: '区域增益火力与技能循环，不直接造成伤害',
    lvls: [
      null,
      { cost: 160, range: 4.75, aura: { damagePct: 0.16, ratePct: 0.11, skillCooldownPct: 0.08 } },
      { cost: 250, range: 5.0, aura: { damagePct: 0.2, ratePct: 0.14, skillCooldownPct: 0.1 } },
      { cost: 620, range: 5.3, aura: { damagePct: 0.25, ratePct: 0.18, skillCooldownPct: 0.12 } },
      { cost: 1080, range: 5.6, aura: { damagePct: 0.3, ratePct: 0.22, skillCooldownPct: 0.14 } },
      { cost: 1580, range: 5.9, aura: { damagePct: 0.36, ratePct: 0.26, skillCooldownPct: 0.17 } },
      { cost: 2200, range: 6.2, aura: { damagePct: 0.42, ratePct: 0.3, skillCooldownPct: 0.2 } },
      { cost: 3020, range: 6.5, aura: { damagePct: 0.5, ratePct: 0.35, skillCooldownPct: 0.24 } },
    ],
  },
};

export const TOWER_KEYS = Object.keys(TOWER_DEFS);

export function towerCost(key, level = 0) {
  const d = TOWER_DEFS[key];
  if (!d || !Number.isInteger(level) || level < 0) return null;
  if (level === 0) return d.cost;
  return d.lvls?.[level]?.cost ?? null;
}

export function towerUnlocked(key, levelIndex = 0) {
  const d = TOWER_DEFS[key];
  return !!d && levelIndex >= (d.unlockIndex ?? 0);
}

export function statsFor(key, level = 0) {
  const d = TOWER_DEFS[key];
  if (!d || !Number.isInteger(level) || level < 0 || level >= d.lvls.length) return null;
  const s = {
    kind: d.kind, // 攻击方式必须随等级快照携带：fire()/update() 依赖 s.kind 分支
    dmg: d.dmg, rate: d.rate, range: d.range, splash: d.splash,
    slow: d.slow ? { ...d.slow } : null,
    chains: d.chains, pierce: d.pierce,
    projSpeed: d.projSpeed, targets: d.targets,
    targeting: d.targeting ?? 'threat', damageType: d.damageType ?? 'physical',
    armorPenetration: d.armorPenetration ?? 0, ignoreArmor: d.ignoreArmor ?? false,
    minimumDamage: d.minimumDamage ?? 1, allowZero: d.allowZero ?? false,
    chainRange: d.chainRange,
    poison: d.poison ? { ...d.poison } : null,
    aura: d.aura ? { ...d.aura } : null,
    maxLevel: d.lvls?.length || 1,
  };
  if (level > 0 && d.lvls[level]) {
    for (const [k, v] of Object.entries(d.lvls[level])) {
      if (k === 'cost') continue;
      if (v && typeof v === 'object') s[k] = { ...v };
      else s[k] = v;
    }
  }
  return s;
}

const geoCache = new Map();
function G(name, make) { if (!geoCache.has(name)) geoCache.set(name, make()); return geoCache.get(name); }
const mat = (o) => new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.05, flatShading: true, ...o });
// 共享材质标记：Tower.dispose 释放每实例材质时跳过它们（几何全部来自 geoCache，一律不释放）
const sharedMat = (o) => { const m = mat(o); m.userData.shared = true; return m; };

const BASE_MATS = {
  stone: sharedMat({ color: 0x8a8f98 }),
  dark: sharedMat({ color: 0x3a3f47 }),
  wood: sharedMat({ color: 0x7a5a34 }),
};

function basePlatform() {
  const g = new THREE.Group();
  const c = new THREE.Mesh(G('tbase', () => new THREE.CylinderGeometry(0.44, 0.52, 0.26, 8)), BASE_MATS.stone);
  c.position.y = 0.13; c.castShadow = true; c.receiveShadow = true; g.add(c);
  const top = new THREE.Mesh(G('ttop', () => new THREE.CylinderGeometry(0.34, 0.4, 0.12, 8)), BASE_MATS.dark);
  top.position.y = 0.3; top.castShadow = true; g.add(top);
  return g;
}

export function createTowerMesh(key, level = 0) {
  const root = new THREE.Group();
  root.add(basePlatform());
  const yaw = new THREE.Group();
  yaw.position.y = 0.36;
  root.add(yaw);
  const u = root.userData;
  u.yaw = yaw;

  const add = (parent, geo, m, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  switch (key) {
    case 'arrow': {
      add(yaw, G('abody', () => new THREE.BoxGeometry(0.5, 0.16, 0.2)), BASE_MATS.wood, 0, 0.16);
      const armGeo = G('aarm', () => new THREE.BoxGeometry(0.1, 0.06, 0.5));
      const a1 = add(yaw, armGeo, BASE_MATS.dark, -0.22, 0.2, 0.1); a1.rotation.x = 0.5;
      const a2 = add(yaw, armGeo, BASE_MATS.dark, 0.22, 0.2, 0.1); a2.rotation.x = 0.5;
      u.muzzle = new THREE.Object3D(); u.muzzle.position.set(0, 0.2, 0.32); yaw.add(u.muzzle);
      break;
    }
    case 'cannon': {
      const mount = add(yaw, G('cmount', () => new THREE.CylinderGeometry(0.16, 0.2, 0.2, 8)), BASE_MATS.dark, 0, 0.1);
      const barrel = add(yaw, G('cbarrel', () => new THREE.CylinderGeometry(0.11, 0.13, 0.6, 10)),
        mat({ color: 0x4a4f58, metalness: 0.45, roughness: 0.4 }), 0, 0.26);
      barrel.rotation.x = Math.PI / 2 - 0.18; // 略上仰
      barrel.position.z = 0.18;
      u.barrel = barrel; u.recoil = 0;
      u.muzzle = new THREE.Object3D(); u.muzzle.position.set(0, 0.32, 0.48); yaw.add(u.muzzle);
      break;
    }
    case 'frost': {
      const ring = add(yaw, G('fring', () => new THREE.TorusGeometry(0.3, 0.035, 8, 24)),
        mat({ color: 0x9fd8e8, emissive: 0x59c8ff, emissiveIntensity: 0.7 }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.1;
      const crystal = add(yaw, G('fcrystal', () => new THREE.OctahedronGeometry(0.26, 0)),
        mat({ color: 0xbfeaff, emissive: 0x59c8ff, emissiveIntensity: 1.3, roughness: 0.2 }), 0, 0.5);
      u.spin = crystal;
      break;
    }
    case 'tesla': {
      add(yaw, G('tpole', () => new THREE.CylinderGeometry(0.05, 0.09, 0.5, 6)), BASE_MATS.dark, 0, 0.25);
      const r1 = add(yaw, G('tring1', () => new THREE.TorusGeometry(0.14, 0.025, 6, 16)),
        mat({ color: 0x8a6ad8, metalness: 0.5, roughness: 0.4 }), 0, 0.34);
      r1.rotation.x = Math.PI / 2;
      const ball = add(yaw, G('tball', () => new THREE.SphereGeometry(0.14, 10, 8)),
        mat({ color: 0xcfe4ff, emissive: 0x66aaff, emissiveIntensity: 1.6, roughness: 0.25 }), 0, 0.58);
      u.pulse = ball;
      break;
    }
    case 'sniper': {
      [-0.14, 0.14].forEach((x, i) => {
        const leg = add(yaw, G(`sleg${i}`, () => new THREE.CylinderGeometry(0.03, 0.035, 0.5, 5)), BASE_MATS.wood, x, 0.22, i === 0 ? 0.08 : -0.06);
        leg.rotation.z = x > 0 ? -0.16 : 0.16;
      });
      const barrel = add(yaw, G('sbarrel', () => new THREE.CylinderGeometry(0.045, 0.055, 0.85, 8)),
        mat({ color: 0x2e333b, metalness: 0.5, roughness: 0.35 }), 0, 0.5);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.z = 0.2;
      const scope = add(yaw, G('sscope', () => new THREE.BoxGeometry(0.06, 0.06, 0.2)),
        mat({ color: 0x1c2026 }), 0, 0.58, 0.05);
      u.barrel = barrel; u.recoil = 0;
      u.muzzle = new THREE.Object3D(); u.muzzle.position.set(0, 0.5, 0.62); yaw.add(u.muzzle);
      break;
    }
    case 'venom': {
      const bottle = add(yaw, G('vbottle', () => new THREE.CylinderGeometry(0.16, 0.19, 0.38, 8)),
        mat({ color: 0x3f8f4a, emissive: 0x2bbf58, emissiveIntensity: 0.65 }), 0, 0.36);
      const neck = add(yaw, G('vneck', () => new THREE.CylinderGeometry(0.08, 0.1, 0.14, 8)), BASE_MATS.dark, 0, 0.62);
      const glow = add(yaw, G('vglow', () => new THREE.SphereGeometry(0.1, 8, 6)),
        mat({ color: 0xbaff9a, emissive: 0x69ff6d, emissiveIntensity: 1.5 }), 0, 0.72);
      u.pulse = glow;
      u.muzzle = new THREE.Object3D(); u.muzzle.position.set(0, 0.7, 0.22); yaw.add(u.muzzle);
      break;
    }
    case 'beacon': {
      add(yaw, G('bpost', () => new THREE.CylinderGeometry(0.07, 0.12, 0.7, 8)), BASE_MATS.dark, 0, 0.42);
      const ring = add(yaw, G('bring', () => new THREE.TorusGeometry(0.25, 0.035, 8, 24)),
        mat({ color: 0x62d7ff, emissive: 0x2b94ff, emissiveIntensity: 1.0 }), 0, 0.48);
      ring.rotation.x = Math.PI / 2;
      const orb = add(yaw, G('borb', () => new THREE.SphereGeometry(0.16, 10, 8)),
        mat({ color: 0xd8f4ff, emissive: 0x62d7ff, emissiveIntensity: 1.8 }), 0, 0.86);
      u.pulse = orb;
      u.aura = ring;
      break;
    }
  }

  // —— Kenney 武器模型替换程序化炮塔（加载失败自动保留程序化外观）——
  const wmName = WEAPON_MODEL[key];
  if (wmName) {
    const targetH = (key === 'tesla' || key === 'frost') ? 0.5 : 0.7;
    const attach = (inst) => {
      if (!inst || u.disposed) return;
      const keep = new Set(u.muzzle ? [u.muzzle] : []);
      for (const c of [...yaw.children]) if (!keep.has(c)) yaw.remove(c);
      inst.rotation.y = WEAPON_ROT[key] ?? 0;
      inst.position.set(0, key === 'frost' ? 0.4 : 0.1, 0);
      yaw.add(inst);
      if (key === 'frost') u.spin = inst;
      if (key === 'tesla' || key === 'cannon' || key === 'sniper') { u.pulse = null; u.barrel = null; }
    };
    const buildInst = () => {
      // 克隆材质并向主题色偏移，五塔一眼可辨
      const inst = makeInstanceWithMaterials(wmName, targetH);
      if (inst) {
        const tint = new THREE.Color(WEAPON_TINT[key] ?? 0xffffff);
        inst.traverse((m) => {
          if (m.isMesh && m.material && !Array.isArray(m.material) && m.color) {
            m.color.lerp(tint, 0.68);
          }
        });
      }
      return inst;
    };
    if (hasModel(wmName)) {
      attach(buildInst());
    } else {
      loadOne(wmName).then(() => {
        if (hasModel(wmName)) attach(buildInst());
      });
    }
  }

  // 等级刻度（金色小方块）
  u.pips = new THREE.Group();
  u.pips.position.y = 0.02;
  root.add(u.pips);
  const pipGeo = G('pip', () => new THREE.BoxGeometry(0.07, 0.05, 0.07));
  const pipMat = mat({ color: 0xffcc55, emissive: 0xaa7700, emissiveIntensity: 0.5 });
  for (let i = 0; i < TOWER_DEFS[key].lvls.length; i++) {
    const p = new THREE.Mesh(pipGeo, pipMat);
    p.position.set((i % 4 - 1.5) * 0.13, 0, 0.43 + Math.floor(i / 4) * 0.1);
    u.pips.add(p);
  }
  u.tier4 = new THREE.Group(); u.tier4.name = 'tower-tier-4'; root.add(u.tier4);
  const trim = mat({ color: key === 'venom' ? 0x92dd65 : key === 'beacon' ? 0xe8b74a : 0xa6d8ec, metalness: 0.5 });
  for (const x of [-0.29, 0.29]) {
    add(u.tier4, G('tier-leg', () => new THREE.BoxGeometry(0.11, 0.5, 0.36)), trim, x, 0.5, 0);
  }
  u.tier8 = new THREE.Group(); u.tier8.name = 'tower-tier-8'; root.add(u.tier8);
  for (const x of [-0.28, 0.28]) {
    add(u.tier8, G('tier-fin', () => new THREE.BoxGeometry(0.09, 0.44, 0.12)), trim, x, 0.92, -0.24);
  }
  const crest = add(u.tier8, G('tier-crown', () => new THREE.TorusGeometry(0.31, 0.045, 6, 16)), trim, 0, 0.86, 0);
  crest.rotation.x = Math.PI / 2;
  u.branchMark = add(root, G('branch-mark', () => new THREE.OctahedronGeometry(0.095)),
    mat({ color: 0xffffff, emissive: 0x3377bb, emissiveIntensity: 0.7 }), 0, 0.35, 0.4);
  updateTowerAppearance(root, level);
  return root;
}

export function updateTowerAppearance(root, level, branch = null) {
  const u = root.userData;
  u.pips.children.forEach((pip, i) => { pip.visible = i <= level; });
  u.tier4.visible = level >= 3;
  u.tier8.visible = level >= 7;
  u.branchMark.visible = !!branch;
  u.branchMark.material.color.setHex(branch === 'B' ? 0xffa779 : 0x85e3ef);
}
