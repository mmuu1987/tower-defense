#!/usr/bin/env node
// 组装独立可部署目录 dist/：仅含运行所需文件，可直接上传任何静态托管
// 用法: node tools/build-dist.mjs   （产物: dist/，随后 Compress-Archive 打 zip 上传）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

// 清空 dist 但保留 .git（部署仓库历史必须存活）
if (fs.existsSync(DIST)) {
  for (const e of fs.readdirSync(DIST)) {
    if (e === '.git') continue;
    fs.rmSync(path.join(DIST, e), { recursive: true, force: true });
  }
} else {
  fs.mkdirSync(DIST, { recursive: true });
}

const COPY_LIST = [
  ['index.html', 'index.html'],
  ['css', 'css'],
  ['js', 'js'],
  ['vendor', 'vendor'],
  ['assets/models', 'assets/models'],
  ['assets/textures', 'assets/textures'],
];

let files = 0, bytes = 0;
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else {
      fs.copyFileSync(s, d);
      files++; bytes += fs.statSync(s).size;
    }
  }
}

for (const [src, dest] of COPY_LIST) {
  const s = path.join(ROOT, src);
  const d = path.join(DIST, dest);
  if (!fs.existsSync(s)) { console.error(`MISSING ${src}`); process.exit(1); }
  if (fs.statSync(s).isFile()) {
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.copyFileSync(s, d);
    files++; bytes += fs.statSync(s).size;
  } else {
    copyDir(s, d);
  }
}

fs.writeFileSync(path.join(DIST, 'version.json'), JSON.stringify({
  name: 'tri-realm-defense',
  builtAt: new Date().toISOString(),
}, null, 2));

console.log(`dist/ ready: ${files} files, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
console.log('deploy guide: DEPLOY.md (itch.io / GitHub Pages / Cloudflare Pages)');
