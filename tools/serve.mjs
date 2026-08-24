#!/usr/bin/env node
// 本地服务器：静态文件 + 健康检查 + 客户端错误上报（供断线/故障排查与自动化验证使用）
// 环境变量：PORT(默认8137)、TD_ROOT(可指向 dist/ 验证部署包，默认为项目根)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = process.env.TD_ROOT ? path.resolve(process.env.TD_ROOT) : DEFAULT_ROOT;
const PORT = Number(process.env.PORT || 8137);
const HOST = process.env.HOST || '127.0.0.1';
const LOG_DIR = path.join(DEFAULT_ROOT, 'logs');
const CLIENT_LOG = path.join(LOG_DIR, 'client.log');
fs.mkdirSync(LOG_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.dat': 'application/octet-stream', // glTF-Binary 改名版（4399 白名单合规）
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8',
};

function send(res, code, body) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}

function safeJoin(root, rel) {
  const p = path.normalize(path.join(root, decodeURIComponent(rel)));
  return p.startsWith(root) ? p : null;
}

const server = http.createServer((req, res) => {
  let u;
  try { u = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
  catch { return send(res, 400, { error: 'bad url' }); }
  const p = u.pathname;

  if (p === '/healthz') {
    return send(res, 200, { ok: true, root: ROOT, pid: process.pid, uptime: process.uptime(), ts: Date.now() });
  }

  if (p === '/api/log' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 256 * 1024) req.destroy(); });
    req.on('end', () => {
      const line = `[${new Date().toISOString()}] ${body.replace(/\s+/g, ' ').slice(0, 4000)}\n`;
      fs.appendFile(CLIENT_LOG, line, () => {});
      res.writeHead(204); res.end();
    });
    return;
  }

  if (p === '/api/logs') {
    if (!fs.existsSync(CLIENT_LOG)) return send(res, 200, { lines: [] });
    const lines = fs.readFileSync(CLIENT_LOG, 'utf8').trimEnd().split('\n').filter(Boolean);
    const n = Math.max(1, Math.min(1000, Number(u.searchParams.get('n')) || 100));
    return send(res, 200, { lines: lines.slice(-n) });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });

  const rel = p === '/' ? '/index.html' : p;
  const file = safeJoin(ROOT, rel);
  if (!file) return send(res, 403, { error: 'forbidden' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { error: 'not found', path: p });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[serve] TowerDefense ready: http://${HOST}:${PORT}/  (root=${ROOT}, pid=${process.pid})`);
});
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
