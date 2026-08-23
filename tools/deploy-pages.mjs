#!/usr/bin/env node
// 一键更新线上版本：打包 dist → (自愈)确保 git 仓库 → 提交 → 强推 → GitHub Pages 自动重建
// 用法: node tools/deploy-pages.mjs
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const REPO_URL = 'https://github.com/mmuu1987/tower-defense-3d.git';

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });
const runQ = (cmd, opts = {}) => execSync(cmd, { ...opts, cwd: DIST }).toString().trim();

// 1) 打包（build-dist 会保留 dist/.git）
run('node tools/build-dist.mjs');

// 2) 自愈 git 仓库（可能被早期全量清理误删）
if (!fs.existsSync(path.join(DIST, '.git'))) {
  console.log('[deploy] dist 缺少 .git —— 重新初始化并关联远程');
  run('git init -b main', { cwd: DIST });
  run('git config user.name "mmuu1987"', { cwd: DIST });
  run('git config user.email "mmuu1987@users.noreply.github.com"', { cwd: DIST });
  run(`git remote add origin ${REPO_URL}`, { cwd: DIST });
}

// 3) 提交 + 强制推送（本地以构建产物为准）
run('git add -A', { cwd: DIST });
const status = runQ('git status --porcelain');
if (status.length === 0) {
  console.log('[deploy] dist 无变化，尝试推送以确保同步…');
} else {
  const tag = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  run(`git commit -m "update ${tag}"`, { cwd: DIST });
}
run('git push -f origin main', { cwd: DIST });

console.log('\n[deploy] 已推送 → GitHub Pages 构建中（1-2 分钟）');
console.log('[deploy] 线上地址: https://mmuu1987.github.io/tower-defense-3d/');
