import * as THREE from 'three';
import { GRID, MAP_AREA_SCALE, MAP_LINEAR_SCALE, cellToWorldX, cellToWorldZ } from './config.js';

export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Round only the corners, so the road cannot overshoot into adjacent lanes.
export function roundRoute(waypoints, radius = 1.05) {
  const points = waypoints.map(([x, z]) => new THREE.Vector3(cellToWorldX(x), 0, cellToWorldZ(z)));
  const curve = new THREE.CurvePath();
  let cursor = points[0];
  const lineTo = (p) => {
    if (cursor.distanceToSquared(p) > 1e-8) curve.add(new THREE.LineCurve3(cursor, p));
    cursor = p;
  };
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1], p = points[i], next = points[i + 1];
    const cut = Math.min(radius, p.distanceTo(prev) * 0.3, p.distanceTo(next) * 0.3);
    const entry = p.clone().addScaledVector(prev.clone().sub(p).normalize(), cut);
    const exit = p.clone().addScaledVector(next.clone().sub(p).normalize(), cut);
    lineTo(entry);
    if (entry.distanceToSquared(exit) > 1e-8) curve.add(new THREE.QuadraticBezierCurve3(entry, p, exit));
    cursor = exit;
  }
  lineTo(points[points.length - 1]);
  return curve.getSpacedPoints(Math.max(2, Math.ceil(curve.getLength() / 0.24)))
    .map((p) => ({ x: p.x, z: p.z }));
}

export function distanceToRoutes(routes) {
  const segments = routes.flatMap((pts) => pts.slice(1).map((b, i) => {
    const a = pts[i], dx = b.x - a.x, dz = b.z - a.z;
    return { x: a.x, z: a.z, dx, dz, len2: dx * dx + dz * dz };
  })).filter((s) => s.len2 > 1e-10);
  return (x, z) => {
    let best = Infinity;
    for (const s of segments) {
      const t = Math.max(0, Math.min(1, ((x - s.x) * s.dx + (z - s.z) * s.dz) / s.len2));
      const dx = x - s.x - s.dx * t, dz = z - s.z - s.dz * t;
      best = Math.min(best, dx * dx + dz * dz);
    }
    return Math.sqrt(best);
  };
}

const smooth = (v) => { const t = Math.max(0, Math.min(1, v)); return t * t * (3 - 2 * t); };

export function createMapLayout(map) {
  const halfW = GRID.w * GRID.cell / 2, halfH = GRID.h * GRID.cell / 2;
  const routes = (map.routes || [map.waypoints]).map((r) => roundRoute(r, map.cornerRadius));
  const distToPath = distanceToRoutes(routes);
  const rng = seededRandom(map.seed ?? 1);
  const phase = rng() * Math.PI * 2;
  const waterWidth = [1.45, 1.55, 1.3, 1.6, 1.55][map.worldIdx ?? 0] * 1.4;
  const offset = (rng() - 0.5) * halfW * 0.36;
  const channelX = (z) => offset + Math.sin(z / MAP_LINEAR_SCALE * 0.35 + phase) * halfW * 0.19
    + Math.sin(z / MAP_LINEAR_SCALE * 0.71 + phase) * halfW * 0.041;
  const waterDistance = (x, z) => Math.abs(x - channelX(z)) - waterWidth / 2;
  const landmarks = [];
  // Reserve broad clearings, leaving the road shoulders free for towers.
  const candidates = [];
  for (let x = -halfW + 2; x <= halfW - 2; x += 1) for (let z = -halfH + 2; z <= halfH - 2; z += 1) {
    const clearance = Math.min(distToPath(x, z) - 0.9, waterDistance(x, z) - 0.55);
    if (clearance > 1.3) candidates.push({ x, z, radius: Math.min(2.5, clearance), score: clearance + rng() * 0.6 });
  }
  candidates.sort((a, b) => b.score - a.score);
  for (const c of candidates) {
    if (landmarks.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < p.radius + c.radius + 1.8)) continue;
    landmarks.push({ ...c, kind: landmarks.length % 3 === 0 ? 'ruin' : 'grove', height: 0.8 + rng() * 0.7 });
    if (landmarks.length === Math.round(3 * MAP_AREA_SCALE)) break;
  }

  const heightAt = (x, z) => {
    const wd = waterDistance(x, z);
    const bank = smooth((wd + 0.25) / 0.9);
    if (bank < 1) return -0.62 + bank * 0.62;
    const road = smooth((distToPath(x, z) - 0.9) / 1.25);
    let height = 0.05 + (Math.sin(x * 0.7 + phase) * Math.cos(z * 0.55) + 1) * 0.065;
    for (const p of landmarks) {
      const t = smooth(1 - Math.hypot(x - p.x, z - p.z) / (p.radius + 0.4));
      height += t * p.height;
    }
    const edge = smooth((Math.max(Math.abs(x) / halfW, Math.abs(z) / halfH) - 0.9) / 0.12);
    height += edge * (0.4 + (Math.sin(x * 1.3 + z + phase) + 1) * 0.15);
    return height * road;
  };

  const pathCells = new Set(), blockedCells = new Set();
  for (let cx = 0; cx < GRID.w; cx++) for (let cz = 0; cz < GRID.h; cz++) {
    const x = cellToWorldX(cx), z = cellToWorldZ(cz), key = `${cx},${cz}`;
    if (distToPath(x, z) < 1.04) pathCells.add(key);
    if (waterDistance(x, z) < 0.75 || landmarks.some((p) => Math.hypot(x - p.x, z - p.z) < p.radius + 0.45)) {
      blockedCells.add(key);
    }
  }
  return { map, halfW, halfH, routes, pts: routes[0], distToPath, pathCells, blockedCells,
    channelX, waterWidth, waterDistance, landmarks, heightAt };
}
