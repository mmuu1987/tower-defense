#!/usr/bin/env node
// 4399 素材生成器：用真实游戏渲染器摆拍（放塔/刷Boss/调镜头）+ Canvas 合成标题 → 图标/宣传图
// 产物: release/4399/art/{icon-512.png, banner-1..5}.png；原始截图存 logs/art/
// 前置: 开发服务器 8137 已启动（本工具只读游戏页面）
// 用法: node tools/make-art.mjs [--only=stage|compose|all]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = path.join(ROOT, 'logs', 'art');
const OUT_DIR = path.join(ROOT, 'release', '4399', 'art');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7) || 'all';
const BASE = 'http://127.0.0.1:8137';

const W = 1280, H = 720;

// ———— 场景定义 ————
const SCENES = [
  {
    id: 'meadow-hero', level: '0,2',             // 螺旋地图：主视觉 + 图标共用
    towers: 13, towerTypes: ['arrow', 'cannon', 'frost', 'tesla', 'sniper'],
    pool: ['grunt', 'runner', 'tank', 'flyer'], boss: 'meadow', clusterAt: 0.42,
    cam: { pitch: 0.78, yaw: 0.55, dist: 13.5 }, hideHud: true,
  },
  {
    id: 'lava-boss', level: '1,8',               // 漩涡地图：熔岩 + 熔火之心
    towers: 12, towerTypes: ['cannon', 'tesla', 'arrow', 'frost', 'sniper'],
    pool: ['tank', 'splitter', 'flyer', 'grunt'], boss: 'lava', clusterAt: 0.5,
    cam: { pitch: 0.82, yaw: 2.2, dist: 14.5 }, hideHud: true,
  },
  {
    id: 'frost-boss', level: '2,9',              // 之字地图：冰霜君王（护盾）
    towers: 12, towerTypes: ['tesla', 'sniper', 'arrow', 'frost', 'cannon'],
    pool: ['mummy', 'stork', 'healer', 'dancer'], boss: 'frost', clusterAt: 0.55,
    cam: { pitch: 0.88, yaw: 4.0, dist: 14 }, hideHud: true,
  },
  {
    id: 'sand-boss', level: '3,9',               // 长蛇地图：沙暴法老 + 干尸
    towers: 12, towerTypes: ['arrow', 'tesla', 'cannon', 'frost', 'sniper'],
    pool: ['mummy', 'stork', 'fox', 'flamingo'], boss: 'sand', clusterAt: 0.48,
    cam: { pitch: 0.8, yaw: 1.15, dist: 14.5 }, hideHud: true,
  },
  {
    id: 'ui-feature', level: '0,1',              // UI 功能图：保留 HUD（提前开战按钮+下一波预览）
    towers: 8, towerTypes: ['arrow', 'frost', 'cannon', 'tesla', 'sniper'],
    pool: [], boss: null, clusterAt: 0.45,
    cam: { pitch: 0.94, yaw: 0, dist: 16.5 }, hideHud: false, ui: true,
  },
];

// ———— 摆拍脚本（注入游戏页面）————
function stageScript(cfg) {
  return `(() => {
    const b = __TD_DEBUG.battle();
    const rig = __TD_DEBUG.rig;
    document.getElementById('fps').style.display = 'none';
    ${cfg.hideHud ? `document.getElementById('hud').style.display = 'none';` : ''}
    b.gold = 99999;
    // 沿路放塔（混型 + 部分升级，等级刻度入镜）
    const types = ${JSON.stringify(cfg.towerTypes)};
    const OFFS = [[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1]];
    let placed = 0;
    for (let d = 3; d < b.sampler.total - 3 && placed < ${cfg.towers}; d += 2.6) {
      const p = b.sampler.at(d);
      const cx = Math.round(p.x + 10.5), cz = Math.round(p.z + 7);
      for (const [dx, dz] of OFFS) {
        if (b.isBuildable(cx + dx, cz + dz)) {
          b.selectedType = types[placed % types.length];
          if (b.tryPlace(cx + dx, cz + dz) === true) {
            const t = b.towers[b.towers.length - 1];
            b.upgradeTower(t);
            if (placed % 3 === 0) b.upgradeTower(t);
            placed++;
          }
          break;
        }
      }
    }
    ${cfg.ui ? '' : 'b.clearSelection();'}
    // 敌群 + Boss：血量锁定（塔持续开火但敌人不死，弹幕/闪电常驻），慢速行军
    const cd = b.sampler.total * ${cfg.clusterAt};
    let i = 0;
    for (const type of ${JSON.stringify(cfg.pool)}) {
      for (let k = 0; k < 3; k++) {
        b.spawnEnemy(type);
        const e = b.enemies[b.enemies.length - 1];
        e.dist = Math.max(1, cd - 3 + i * 0.85);
        e.maxHp = e.hp = 999999;
        e.baseSpeed = 0.42;
        i++;
      }
    }
    ${cfg.boss ? `
    b.spawnEnemy(${JSON.stringify(cfg.boss)});
    const boss = b.enemies[b.enemies.length - 1];
    boss.dist = cd + 1.3; boss.maxHp = boss.hp = 999999; boss.baseSpeed = 0.28;
    if (boss.shieldMax) { boss.shield = boss.shieldMax = 999999; }` : ''}
    // 相机：直接落位（目标值与平滑值同写，免运镜等待）
    const fp = b.sampler.at(cd + 0.8);
    rig.pitch = ${cfg.cam.pitch}; rig.yaw = ${cfg.cam.yaw}; rig.dist = ${cfg.cam.dist};
    rig.cur.yaw = ${cfg.cam.yaw}; rig.cur.dist = ${cfg.cam.dist};
    rig.cur.focus.set(fp.x, 0, fp.z);
    ${cfg.ui ? `
    // UI 功能图：伪造成第 3 波后的休整期——预览条显示第 4 波(含⚔️倍率)，按钮显示提前开战奖励
    b.waveIdx = 2;
    b.gold = 312;
    b.hooks.onGold?.(312);
    b.hooks.onWave?.(3, b.level.waves.length, false);
    b.state = 'intermission'; b.intermission = 5.9; b.speed = 0; // 冻结倒计时，按钮文案稳定
    ` : ''}
    return { towers: placed, enemies: b.enemies.filter((e) => e.alive).length };
  })()`;
}

// ———— 合成脚本（注入 about:blank 页，bg 以 dataURL 传入避免跨域污染画布）————
const FONT = '"Microsoft YaHei", "PingFang SC", sans-serif';
function composeHelpers() {
  return `
    const loadImg = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
    function gradText(g, text, x, y, size, o = {}) {
      g.font = '900 ' + size + 'px ${FONT}';
      g.textAlign = o.align || 'left';
      g.textBaseline = o.baseline || 'alphabetic';
      try { g.letterSpacing = (o.ls || 0) + 'px'; } catch {}
      g.lineJoin = 'round';
      g.strokeStyle = o.stroke || '#170f05';
      g.lineWidth = o.strokeW ?? Math.max(4, Math.round(size * 0.075));
      g.strokeText(text, x, y);
      const grad = g.createLinearGradient(0, y - size * 0.95, 0, y + size * 0.28);
      (o.stops || [['#fff6cf', 0], ['#ffd76a', 0.42], ['#f0951f', 0.72], ['#b45e10', 1]])
        .forEach(([c, p]) => grad.addColorStop(p, c));
      g.fillStyle = grad;
      g.shadowColor = o.shadow || 'rgba(0,0,0,0.85)';
      g.shadowBlur = o.shadowBlur ?? 16;
      g.shadowOffsetY = 4;
      g.fillText(text, x, y);
      g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0;
    }
    function chip(g, text, x, y, size, bgFill, border) {
      g.font = '700 ' + size + 'px ${FONT}';
      g.textBaseline = 'middle'; g.textAlign = 'left';
      const pad = size * 0.62, w = g.measureText(text).width + pad * 2, h = size * 1.9, r = h / 2;
      g.beginPath(); g.roundRect(x, y, w, h, r);
      g.fillStyle = bgFill; g.fill();
      g.lineWidth = 2; g.strokeStyle = border; g.stroke();
      g.fillStyle = '#f2f6ff';
      g.fillText(text, x + pad, y + h / 2 + 1);
      return w;
    }
  `;
}

function iconScript(bgData) {
  return `(async () => {
    ${composeHelpers()}
    const W = 512, H = 512;
    document.body.style.cssText = 'margin:0;overflow:hidden;background:#000';
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    cv.style.cssText = 'width:' + W + 'px;height:' + H + 'px;display:block';
    document.body.appendChild(cv);
    const g = cv.getContext('2d');
    const bg = await loadImg('data:image/png;base64,${bgData}');
    if (!bg) return { error: 'bg load fail' };
    // 中心方形裁切（拍摄时主体已居中）
    const S = Math.min(bg.width, bg.height);
    g.drawImage(bg, (bg.width - S) / 2, 0, S, S, 0, 0, W, H);
    // 暗角 + 底部渐变
    const vg = g.createRadialGradient(W/2, H/2, W*0.36, W/2, H/2, W*0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(3,8,16,0.5)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    const bt = g.createLinearGradient(0, H*0.52, 0, H);
    bt.addColorStop(0, 'rgba(4,10,20,0)'); bt.addColorStop(1, 'rgba(4,10,20,0.9)');
    g.fillStyle = bt; g.fillRect(0, H*0.5, W, H*0.5);
    // 游戏名（小尺寸下仍可读：粗字重+描边+渐变）
    gradText(g, '三境守卫', W/2, H*0.875, 112, { align: 'center', ls: 8, strokeW: 10 });
    return { ok: true, titleW: g.measureText('三境守卫').width };
  })()`;
}

function bannerScript(bgData, opts) {
  return `(async () => {
    ${composeHelpers()}
    const W = ${W}, H = ${H};
    document.body.style.cssText = 'margin:0;overflow:hidden;background:#000';
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    cv.style.cssText = 'width:' + W + 'px;height:' + H + 'px;display:block';
    document.body.appendChild(cv);
    const g = cv.getContext('2d');
    const bg = await loadImg('data:image/png;base64,${bgData}');
    if (!bg) return { error: 'bg load fail' };
    g.drawImage(bg, 0, 0, W, H);
    ${opts.kind === 'hero' ? `
    // 主视觉：左侧压暗 + 大标题 + 特性角标
    const lg = g.createLinearGradient(0, 0, W*0.72, 0);
    lg.addColorStop(0, 'rgba(4,9,18,0.93)'); lg.addColorStop(0.4, 'rgba(4,9,18,0.58)'); lg.addColorStop(0.7, 'rgba(4,9,18,0)');
    g.fillStyle = lg; g.fillRect(0, 0, W, H);
    const tg = g.createLinearGradient(0, H*0.58, 0, H);
    tg.addColorStop(0, 'rgba(3,8,16,0)'); tg.addColorStop(1, 'rgba(3,8,16,0.82)');
    g.fillStyle = tg; g.fillRect(0, H*0.58, W, H*0.42);
    gradText(g, '三境守卫', 70, 296, 150, { ls: 14, strokeW: 12 });
    g.font = '600 36px ${FONT}';
    g.fillStyle = '#dce8ff'; g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 10;
    g.fillText('3D 塔防 · 四大世界 · 40 关 · 免费', 78, 366);
    g.shadowBlur = 0; g.shadowOffsetY = 0;
    let cx = 72;
    for (const t of ['五塔布阵', '12 种敌人', '4 大 BOSS', '三星挑战']) {
      cx += chip(g, t, cx, H - 100, 26, 'rgba(10,18,34,0.85)', 'rgba(255,205,90,0.55)') + 14;
    }
    ` : opts.kind === 'ui' ? `
    // UI 功能图：不加压暗渐变（HUD 按钮行/塔坞/面板保持原亮度），仅轻微暗角；
    // 功能角标放左下角（避开居中塔坞 x434-846 与右下选中塔面板）
    const vg = g.createRadialGradient(W/2, H/2, H*0.55, W/2, H/2, H*1.05);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(2,6,14,0.30)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    chip(g, ${JSON.stringify(opts.chip)}, 40, H - 62, 26, 'rgba(10,18,34,0.88)', 'rgba(255,205,90,0.6)');
    ` : `
    // 场景图：底部压暗 + 左上角世界标签 + 右下角游戏名水印
    const tg = g.createLinearGradient(0, H*0.5, 0, H);
    tg.addColorStop(0, 'rgba(3,8,16,0)'); tg.addColorStop(1, 'rgba(3,8,16,0.85)');
    g.fillStyle = tg; g.fillRect(0, H*0.5, W, H*0.5);
    const tgd = g.createLinearGradient(0, 0, 0, H*0.22);
    tgd.addColorStop(0, 'rgba(3,8,16,0.62)'); tgd.addColorStop(1, 'rgba(3,8,16,0)');
    g.fillStyle = tgd; g.fillRect(0, 0, W, H*0.22);
    chip(g, ${JSON.stringify(opts.chip)}, 40, 40, 30, 'rgba(10,18,34,0.82)', 'rgba(255,205,90,0.6)');
    gradText(g, '三境守卫', W - 56, H - 92, 56, { align: 'right', ls: 5, strokeW: 6, shadowBlur: 10 });
    g.font = '600 24px ${FONT}'; g.textAlign = 'right'; g.fillStyle = '#cfe0ff';
    g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 8;
    g.fillText('3D 塔防', W - 58, H - 52);
    g.shadowBlur = 0;
    `}
    // 诊断：亮度/色彩分布（确认非空图 + 文字确实画上去了）
    const d = g.getImageData(0, 0, W, H).data;
    let bright = 0, colored = 0, total = 0;
    for (let p = 0; p < d.length; p += 160) {
      total++;
      const r = d[p], gg = d[p+1], bb = d[p+2];
      if (r + gg + bb > 220) bright++;
      if (Math.abs(r - gg) > 45 || Math.abs(gg - bb) > 45 || Math.abs(r - bb) > 45) colored++;
    }
    return { ok: true, bright: +(bright / total * 100).toFixed(1), colored: +(colored / total * 100).toFixed(1) };
  })()`;
}

// ———— CDP 基座 ————
const BROWSERS = [
  process.env.TD_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const exe = BROWSERS.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!exe) { console.error('[art] no browser found'); process.exit(3); }

const PORT = 9341;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'td-art-'));
const child = spawn(exe, [
  '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${PORT}`,
  `--window-size=${W},${H}`, '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' });
const cleanup = () => { try { child.kill(); } catch {} try { fs.rmSync(prof, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanup);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function findTarget() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(300);
  }
  throw new Error('devtools not reachable');
}
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const data = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8');
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  };
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('cdp timeout ' + method)); } }, 60000);
  });
  return { ready, call };
}
async function evalJs(call, expr) {
  const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 300));
  return r.result?.value;
}
async function navigate(call, url) {
  await call('Page.navigate', { url });
  const t = Date.now();
  while (Date.now() - t < 30000) {
    const st = await evalJs(call, 'document.readyState');
    if (st === 'complete') return;
    await sleep(250);
  }
  throw new Error('nav timeout ' + url);
}
async function capture(call, file, clip) {
  const shot = await call('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' });
  const buf = Buffer.from(shot.data, 'base64');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return buf.length;
}

// ———— 主流程 ————
const ARTS = [
  { out: 'icon-512.png', raw: 'meadow-hero', kind: 'icon', w: 512, h: 512 },
  { out: 'banner-1-hero.png', raw: 'meadow-hero', kind: 'hero', w: W, h: H },
  { out: 'banner-2-lava.png', raw: 'lava-boss', kind: 'scene', chip: '🌋 熔岩荒地 · 熔火之心', w: W, h: H },
  { out: 'banner-3-frost.png', raw: 'frost-boss', kind: 'scene', chip: '❄️ 霜寒要塞 · 冰霜君王', w: W, h: H },
  { out: 'banner-4-sand.png', raw: 'sand-boss', kind: 'scene', chip: '🏜️ 黄沙戈壁 · 沙暴法老', w: W, h: H },
  { out: 'banner-5-ui.png', raw: 'ui-feature', kind: 'ui', chip: '提前开战 · 波次预览', w: W, h: H },
];

try {
  const wsUrl = await findTarget();
  const { ready, call } = cdp(wsUrl);
  await ready;
  await call('Page.enable');
  await call('Runtime.enable');
  // 强制精确视口：Edge 无头模式的 --window-size 含浏览器装饰（实测 1280×720 → 视口仅 1256×627），
  // 底部素材会被切掉；用 CDP 覆盖为真实 1280×720
  await call('Emulation.setDeviceMetricsOverride', {
    width: W, height: H, deviceScaleFactor: 1, mobile: false,
  });

  // 阶段一：游戏内摆拍
  if (ONLY === 'all' || ONLY === 'stage') {
    fs.mkdirSync(RAW_DIR, { recursive: true });
    for (const sc of SCENES) {
      await navigate(call, `${BASE}/?level=${sc.level}`);
      // 等战斗就绪 + 敌人模型预载完成
      const t = Date.now();
      while (Date.now() - t < 40000) {
        const ok = await evalJs(call, `!!(window.__TD_READY && window.__TD_DEBUG && __TD_DEBUG.battle && __TD_DEBUG.battle())`);
        if (ok) break;
        await sleep(350);
      }
      await sleep(1400);
      const r = await evalJs(call, stageScript(sc));
      await sleep(sc.ui ? 1200 : 3400);   // 弹幕/闪电/行走动画入镜
      const bytes = await capture(call, path.join(RAW_DIR, `raw-${sc.id}.png`));
      console.log(`[stage] ${sc.id}: towers=${r.towers} enemies=${r.enemies} raw=${(bytes / 1024).toFixed(0)}KB`);
    }
  }

  // 阶段二：合成
  if (ONLY === 'all' || ONLY === 'compose') {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const art of ARTS) {
      const rawPath = path.join(RAW_DIR, `raw-${art.raw}.png`);
      if (!fs.existsSync(rawPath)) { console.error(`[compose] 缺原始截图 ${rawPath}`); process.exit(1); }
      const bgData = fs.readFileSync(rawPath).toString('base64');
      await navigate(call, 'about:blank');
      const script = art.kind === 'icon' ? iconScript(bgData) : bannerScript(bgData, art);
      const r = await evalJs(call, script);
      if (!r || r.error || !r.ok) { console.error(`[compose] ${art.out} 失败: ${JSON.stringify(r)}`); process.exit(1); }
      const bytes = await capture(call, path.join(OUT_DIR, art.out), { x: 0, y: 0, width: art.w, height: art.h, scale: 1 });
      console.log(`[compose] ${art.out}: ${(bytes / 1024).toFixed(0)}KB ${r.bright != null ? `亮区${r.bright}% 彩区${r.colored}%` : ''}`);
    }
  }

  console.log('\n[art] 完成 → ' + OUT_DIR);
  process.exit(0);
} catch (e) {
  console.error('[art] ' + e.message);
  process.exit(1);
}
