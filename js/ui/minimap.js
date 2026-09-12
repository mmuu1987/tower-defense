import * as THREE from 'three';
import { GRID } from '../game/config.js';
import { mapPreview } from './map-preview.js';

export function createMinimap({ battle, rig, camera, onOverview }) {
  const root = document.createElement('div');
  root.id = 'battle-map';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', '战场导航');
  root.innerHTML = `
    <canvas id="battle-map-canvas" width="252" height="168" tabindex="0" role="button" aria-label="小地图定位" title="定位防线"></canvas>
    <div class="map-tools">
      <span>${GRID.w} &times; ${GRID.h}</span>
      <button id="map-zoom-in" aria-label="放大" title="放大"><img src="./vendor/lucide/zoom-in.svg" alt=""></button>
      <button id="map-zoom-out" aria-label="缩小" title="缩小"><img src="./vendor/lucide/zoom-out.svg" alt=""></button>
      <button id="map-overview" aria-label="全图" title="全图"><img src="./vendor/lucide/maximize.svg" alt=""></button>
    </div>`;
  const canvas = root.querySelector('canvas'), ctx = canvas.getContext('2d');
  const background = new Image();
  background.src = mapPreview(battle.level.map);
  const sx = canvas.width / GRID.w, sz = canvas.height / GRID.h;
  const mapX = (x) => (x + GRID.w / 2) * sx, mapZ = (z) => (z + GRID.h / 2) * sz;
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ray = new THREE.Raycaster(), point = new THREE.Vector3(), ndc = new THREE.Vector2();
  let elapsed = 1, pointer = null;

  const locate = (event) => {
    const bounds = canvas.getBoundingClientRect();
    const u = THREE.MathUtils.clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
    const v = THREE.MathUtils.clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
    rig.focusAt((u - 0.5) * GRID.w, (v - 0.5) * GRID.h);
    if (rig.dist > rig.overviewDistance * 0.9) rig.dist = Math.max(20, Math.min(32, rig.overviewDistance * 0.72));
    elapsed = 1;
  };
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    pointer = event.pointerId;
    canvas.setPointerCapture(pointer);
    locate(event);
  });
  canvas.addEventListener('pointermove', (event) => { if (event.pointerId === pointer) locate(event); });
  const release = () => { pointer = null; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', release);
  canvas.addEventListener('keydown', (event) => {
    const movement = { ArrowLeft: [-2,0], ArrowRight: [2,0], ArrowUp: [0,-2], ArrowDown: [0,2] }[event.code];
    if (movement) { event.preventDefault(); event.stopPropagation(); rig.focusAt(rig.cur.focus.x + movement[0], rig.cur.focus.z + movement[1]); }
    if (event.code === 'Enter' || event.code === 'Space') { event.preventDefault(); event.stopPropagation(); onOverview(); }
  });
  root.querySelector('#map-zoom-in').onclick = () => rig.zoomBy(0.8);
  root.querySelector('#map-zoom-out').onclick = () => rig.zoomBy(1.25);
  root.querySelector('#map-overview').onclick = onOverview;
  root.addEventListener('keydown', (event) => {
    if (event.code === 'Enter' || event.code === 'Space') event.stopPropagation();
  });

  return {
    root,
    destroy() { root.remove(); },
    update(dt) {
      const hidden = innerWidth < 700 && !!(battle.selectedTower || battle.selectedType);
      root.classList.toggle('map-context-hidden', hidden);
      elapsed += dt;
      if (hidden || elapsed < 0.1) return;
      elapsed = 0;
      ctx.fillStyle = '#293e37'; ctx.fillRect(0,0,canvas.width,canvas.height);
      if (background.complete && background.naturalWidth) ctx.drawImage(background,0,0,canvas.width,canvas.height);
      ctx.save();
      ctx.beginPath(); ctx.rect(0,0,canvas.width,canvas.height); ctx.clip();
      ctx.beginPath();
      let vertices = 0;
      for (const [x, y] of [[-1,1],[1,1],[1,-1],[-1,-1]]) {
        ray.setFromCamera(ndc.set(x,y), camera);
        if (!ray.ray.intersectPlane(ground, point)) continue;
        if (vertices++ === 0) ctx.moveTo(mapX(point.x),mapZ(point.z));
        else ctx.lineTo(mapX(point.x),mapZ(point.z));
      }
      if (vertices >= 3) {
        ctx.closePath(); ctx.fillStyle = '#ffffff12'; ctx.fill();
        ctx.strokeStyle = '#ffffffd9'; ctx.lineWidth = 1.6; ctx.stroke();
      }
      for (const tower of battle.towers) {
        ctx.fillStyle = '#8fd7ff'; ctx.fillRect(mapX(tower.pos.x)-2,mapZ(tower.pos.z)-2,4,4);
      }
      for (const enemy of battle.enemies) {
        if (!enemy.alive) continue;
        ctx.fillStyle = enemy.def.shape === 'boss' ? '#ffd079' : '#ff6969';
        ctx.beginPath(); ctx.arc(mapX(enemy.pos.x),mapZ(enemy.pos.z),enemy.def.shape === 'boss' ? 3 : 1.8,0,Math.PI*2); ctx.fill();
      }
      ctx.restore();
    },
  };
}
