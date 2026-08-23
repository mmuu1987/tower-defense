#!/usr/bin/env node
// 从 kenney.nl 抓取 CC0 资源包：解析资产页找到 .zip 直链并下载（重试x3）。
// 用法: node tools/fetch-kenney.mjs   （产物: assets/kenney/*.zip）
import fs from 'node:fs';
import path from 'node:path';

const PACKS = [
  { slug: 'tower-defense-kit', out: 'assets/kenney/td.zip' },
  { slug: 'nature-kit',        out: 'assets/kenney/nature.zip' },
];
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
};

async function getBuffer(url, referer) {
  for (let a = 1; a <= 3; a++) {
    try {
      const res = await fetch(url, { headers: { ...HEADERS, ...(referer ? { Referer: referer } : {}) }, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      console.log(`  retry ${a}/3 ${url} -> ${e.message}`);
      await new Promise((r) => setTimeout(r, 1500 * a));
    }
  }
  return null;
}

fs.mkdirSync('assets/kenney', { recursive: true });
for (const p of PACKS) {
  if (fs.existsSync(p.out) && fs.statSync(p.out).size > 100000) {
    console.log(`SKIP ${p.out}`);
    continue;
  }
  console.log(`PAGE https://kenney.nl/assets/${p.slug}`);
  const page = await getBuffer(`https://kenney.nl/assets/${p.slug}`);
  if (!page) { console.log(`FAIL page ${p.slug}`); continue; }
  const html = page.toString('utf8');
  const links = [...new Set(html.match(/https?:\/\/[^"'\\]+\.zip/g) || [])];
  console.log(`  zips found: ${links.length ? links.join(', ') : '(none)'}`);
  const pick = links.find((u) => u.includes(p.slug)) || links[0];
  if (!pick) continue;
  console.log(`GET  ${pick}`);
  const buf = await getBuffer(pick, `https://kenney.nl/assets/${p.slug}`);
  if (!buf || buf.length < 50000) { console.log(`FAIL download (${buf ? buf.length : 0} bytes)`); continue; }
  fs.writeFileSync(p.out, buf);
  console.log(`OK   ${p.out} (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
}
console.log('DONE');
