#!/usr/bin/env node
// 敌人模型获取：A) Quaternius Ultimate Monsters 页面抓 zip；B) three.js 官方动画模型兜底。
// 产物: assets/models/enemies/*.glb  +  assets/kenney/quaternius-monsters.zip（原始包）
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'assets/models/enemies';
const RAWZIP = 'assets/kenney';
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(RAWZIP, { recursive: true });

const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126' };

async function get(url, dest = null) {
  for (let a = 1; a <= 3; a++) {
    try {
      const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (dest) fs.writeFileSync(dest, buf);
      return buf;
    } catch (e) {
      console.log(`  retry ${a}/3 ${url} -> ${e.message}`);
      await new Promise((r) => setTimeout(r, 1200 * a));
    }
  }
  return null;
}

// —— A) Quaternius 怪物包 ——
const QPAGE = 'https://quaternius.com/packs/ultimatemonsters.html';
console.log(`PAGE ${QPAGE}`);
const page = await get(QPAGE);
let qZipCount = 0;
if (page) {
  const html = page.toString('utf8');
  const abs = html.match(/https?:\/\/[^"'\\]+\.zip/gi) || [];
  const rels = (html.match(/["']([^"']+\.zip)["']/gi) || []).map((m) => {
    const r = m.slice(1, -1);
    try { return new URL(r, QPAGE).href; } catch { return null; }
  }).filter(Boolean);
  const links = [...new Set([...abs, ...rels])];
  console.log(`  zips: ${links.length ? links.join(', ') : '(none)'}`);
  for (const z of links.slice(0, 2)) {
    const name = 'quaternius-monsters' + (qZipCount ? `-${qZipCount}` : '') + '.zip';
    const buf = await get(z, path.join(RAWZIP, name));
    if (buf && buf.length > 100000) { console.log(`OK   ${name} (${(buf.length / 1048576).toFixed(1)} MB)`); qZipCount++; }
  }
} else {
  console.log('  Quaternius 页面获取失败（走兜底方案）');
}
if (!qZipCount) console.log('  未获得 Quaternius 包，依赖 B 方案 + 程序化回退');

// —— B) three.js 官方动画模型（可靠直链）——
const R160 = 'https://raw.githubusercontent.com/mrdoob/three.js/r160/examples/models/gltf';
const BASE = [
  ['RobotExpressive/RobotExpressive.glb', 'robot.glb'],           // 动画：Walk/Run/Death/Idle...
  ['Flamingo.glb',                        'bird_flamingo.glb'],   // 飞行动画
  ['Parrot.glb',                          'bird_parrot.glb'],
  ['Stork.glb',                           'bird_stork.glb'],
  ['Horse.glb',                           'horse.glb'],
];

for (const [rel, dest] of BASE) {
  const out = path.join(OUT, dest);
  if (fs.existsSync(out)) { console.log(`SKIP ${dest}`); continue; }
  const buf = await get(`${R160}/${rel}`);
  if (buf && buf.length > 20000 && buf[0] === 0x67 && buf[1] === 0x6c) { // 'gl' magic
    fs.writeFileSync(out, buf);
    console.log(`OK   ${dest} (${(buf.length / 1024).toFixed(0)} KB)`);
  } else {
    console.log(`MISS ${rel}`);
  }
}

// —— C) Khronos glTF-Sample-Models（CC0/CC-BY 直链）——
const KHR = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0';
const KHR_BASE = [
  ['Fox/glTF-Binary/Fox.glb',               'fox.glb'],        // 动画：Survey/Walk/Run（CC0）
  ['CesiumMan/glTF-Binary/CesiumMan.glb',   'cesiumman.glb'],  // 动画：Walk（CC-BY 4.0，README 需署名）
  ['BrainStem/glTF-Binary/BrainStem.glb',   'brainstem.glb'],  // 动画：机械舞（CC-BY，Microsoft）
];
for (const [rel, dest] of KHR_BASE) {
  const out = path.join(OUT, dest);
  if (fs.existsSync(out)) { console.log(`SKIP ${dest}`); continue; }
  const buf = await get(`${KHR}/${rel}`);
  if (buf && buf.length > 20000 && buf[0] === 0x67 && buf[1] === 0x6c) {
    fs.writeFileSync(out, buf);
    console.log(`OK   ${dest} (${(buf.length / 1024).toFixed(0)} KB)`);
  } else {
    console.log(`MISS ${rel}`);
  }
}

// —— D) 沙漠装饰：从 Kenney Nature Kit 复制仙人掌到扁平模型目录 ——
for (const f of ['cactus_short.glb', 'cactus_tall.glb']) {
  const src = path.join('assets/kenney/nature/Models/GLTF format', f);
  const dst = path.join('assets/models', f);
  if (fs.existsSync(dst)) { console.log(`SKIP ${f}`); continue; }
  if (fs.existsSync(src)) { fs.copyFileSync(src, dst); console.log(`OK   ${f} -> assets/models/`); }
  else console.log(`MISS ${src}`);
}

console.log('\n--- enemies 目录 ---');
for (const f of fs.readdirSync(OUT)) console.log(' ', f);
