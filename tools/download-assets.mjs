#!/usr/bin/env node
// Resumable asset downloader (idempotent): skips complete files, resumes partial ones
// via HTTP Range, retries with backoff. Exit codes: 0 = ok/partial-ok, 2 = critical missing.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG = path.join(ROOT, 'logs', 'assets-download.log');
fs.mkdirSync(path.dirname(LOG), { recursive: true });
const log = (m) => {
  const line = `[${new Date().toISOString()}] ${m}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch {}
};

const FILES = [
  { name: 'three-core',    critical: true,  minBytes: 600000, out: 'vendor/three/three.module.js',
    url: 'https://unpkg.com/three@0.160.0/build/three.module.js' },
  { name: 'three-license', critical: false, minBytes: 1000,   out: 'vendor/three/LICENSE',
    url: 'https://unpkg.com/three@0.160.0/LICENSE' },
  { name: 'tex-grass',     critical: false, minBytes: 80000,  out: 'assets/textures/grass.jpg',
    url: 'https://raw.githubusercontent.com/mrdoob/three.js/r160/examples/textures/terrain/grasslight-big.jpg' },
  { name: 'tex-stone',     critical: false, minBytes: 30000,  out: 'assets/textures/stone.jpg',
    url: 'https://raw.githubusercontent.com/mrdoob/three.js/r160/examples/textures/brick_diffuse.jpg' },
  { name: 'tex-lava',      critical: false, minBytes: 10000,  out: 'assets/textures/lava.jpg',
    url: 'https://raw.githubusercontent.com/mrdoob/three.js/r160/examples/textures/lava/lavatile.jpg' },
  { name: 'particle-disc', critical: false, minBytes: 800,    out: 'assets/textures/particle-disc.png',
    url: 'https://raw.githubusercontent.com/mrdoob/three.js/r160/examples/textures/sprites/disc.png' },
];

const FORCE = process.argv.includes('--force');
const ATTEMPTS = 4;

function sizeOf(p) { try { return fs.statSync(p).size; } catch { return 0; } }

async function fetchOnce(item, dest) {
  const have = sizeOf(dest);
  const headers = {};
  if (have > 0) headers['Range'] = `bytes=${have}-`; // resume
  const res = await fetch(item.url, { headers, redirect: 'follow' });
  if (res.status !== 200 && res.status !== 206) throw new Error(`HTTP ${res.status}`);
  const resumed = res.status === 206 && have > 0;
  const target = resumed ? dest : `${dest}.part`;
  const ws = fs.createWriteStream(target, resumed ? { flags: 'a' } : { flags: 'w' });
  await new Promise((resolve, reject) => {
    const src = Readable.fromWeb(res.body); // Node >=18: convert WHATWG stream -> Node stream
    src.on('error', reject);
    ws.on('error', reject);
    ws.on('finish', resolve);
    src.pipe(ws);
  });
  if (!resumed) fs.renameSync(target, dest);
}

async function getItem(item) {
  const dest = path.join(ROOT, item.out);
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const existing = sizeOf(dest);
  if (!FORCE && existing >= item.minBytes) {
    log(`SKIP ${item.name} (${existing} bytes)`);
    return true;
  }

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      log(`GET  ${item.name} <- ${item.url}${sizeOf(dest) ? ` (resume @ ${sizeOf(dest)})` : ''}`);
      await fetchOnce(item, dest);
      const sz = sizeOf(dest);
      if (sz >= item.minBytes) { log(`OK   ${item.name} (${sz} bytes)`); return true; }
      log(`PARTIAL ${item.name}: ${sz} < min ${item.minBytes}, will retry`);
    } catch (e) {
      log(`RETRY ${item.name} attempt ${attempt}/${ATTEMPTS} failed: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }

  log(`FAIL ${item.name}`);
  return false;
}

let criticalMissing = false;
for (const item of FILES) {
  const ok = await getItem(item);
  if (!ok) {
    if (item.critical) criticalMissing = true;
    const dest = path.join(ROOT, item.out);
    try { if (fs.existsSync(dest) && sizeOf(dest) < item.minBytes) fs.unlinkSync(dest); } catch {}
  }
}
log(criticalMissing ? 'RESULT: PARTIAL (critical missing - rerun this script)' : 'RESULT: SUCCESS');
process.exit(criticalMissing ? 2 : 0);
