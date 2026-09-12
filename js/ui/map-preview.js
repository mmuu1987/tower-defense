import { createMapLayout } from '../game/map-layout.js';

const PALETTES = [
  ['#375345', '#64917a', '#3998a3'], ['#463c3e', '#776363', '#f4723f'],
  ['#728f98', '#cfdee0', '#458ba6'], ['#907e63', '#c3b394', '#736f60'],
  ['#344b44', '#718378', '#386d63'],
];
const cache = new Map();

export function mapPreview(map) {
  if (cache.has(map.id)) return cache.get(map.id);
  const layout = createMapLayout(map);
  const canvas = document.createElement('canvas');
  canvas.width = 220; canvas.height = 150;
  const ctx = canvas.getContext('2d');
  const [ground, ridge, water] = PALETTES[map.worldIdx];
  ctx.fillStyle = ground; ctx.fillRect(0, 0, 220, 150);
  const sx = canvas.width / (layout.halfW * 2), sz = canvas.height / (layout.halfH * 2);
  const x = (v) => (v + layout.halfW) * sx, z = (v) => (v + layout.halfH) * sz;
  for (const p of layout.landmarks) {
    ctx.fillStyle = ridge; ctx.beginPath();
    ctx.ellipse(x(p.x), z(p.z), p.radius * sx, p.radius * sz * 0.8, 0.4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = water; ctx.lineWidth = layout.waterWidth * sx;
  ctx.beginPath();
  for (let i = 0; i <= 100; i++) {
    const wz = -layout.halfH - 0.5 + i * (layout.halfH * 2 + 1) / 100;
    if (i === 0) ctx.moveTo(x(layout.channelX(wz)), z(wz));
    else ctx.lineTo(x(layout.channelX(wz)), z(wz));
  }
  ctx.stroke();
  ctx.lineJoin = ctx.lineCap = 'round';
  for (const route of layout.routes) {
    ctx.beginPath();
    route.forEach((p, i) => i ? ctx.lineTo(x(p.x), z(p.z)) : ctx.moveTo(x(p.x), z(p.z)));
    ctx.strokeStyle = '#273430'; ctx.lineWidth = Math.max(5, sx * 1.2); ctx.stroke();
    ctx.strokeStyle = '#ded5b6'; ctx.lineWidth = Math.max(3, sx * 0.7); ctx.stroke();
  }
  [layout.pts[0], layout.pts.at(-1)].forEach((p, i) => {
    ctx.fillStyle = i ? '#f47775' : '#83efad';
    ctx.beginPath(); ctx.arc(x(p.x), z(p.z), 5, 0, Math.PI * 2); ctx.fill();
  });
  const url = canvas.toDataURL();
  cache.set(map.id, url);
  return url;
}
