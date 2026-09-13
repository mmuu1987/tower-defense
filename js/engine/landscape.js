import * as THREE from 'three';
import { MAP_AREA_SCALE, MAP_LINEAR_SCALE } from '../game/config.js';

const PALETTES = {
  meadow: { water: 0x368b98, bank: 0x737968, cliff: 0x52624e, particle: 0xffecc0 },
  lava: { water: 0xf55b22, bank: 0x393639, cliff: 0x3d3437, particle: 0xff9638 },
  frost: { water: 0x4689aa, bank: 0xbbdbe3, cliff: 0x8dabb6, particle: 0xe4f9ff },
  sand: { water: 0x8e7963, bank: 0xbf9c74, cliff: 0x987c65, particle: 0xf0d3a0 },
  graveyard: { water: 0x315b50, bank: 0x555c56, cliff: 0x46534e, particle: 0x9de6be },
};

function flowTexture(rng) {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#97a6a4'; ctx.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 360; i++) {
    const shade = Math.round(130 + rng() * 110);
    ctx.strokeStyle = `rgba(${shade},${shade},${shade},0.35)`;
    ctx.lineWidth = 0.4 + rng() * 1.6;
    const x = rng() * 128, y = rng() * 256;
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + rng() * 8, y + 12, x - 2, y + 8 + rng() * 45);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 3);
  return texture;
}

function instanceBatch(group, name, geometry, material, transforms, shadow = true) {
  if (!transforms.length) { geometry.dispose(); material.dispose(); return; }
  const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
  mesh.name = name;
  const dummy = new THREE.Object3D();
  transforms.forEach((p, i) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(p.rx || 0, p.ry || 0, p.rz || 0);
    dummy.scale.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1);
    dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = shadow; mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  group.add(mesh);
}

export function createLandscape({ theme, layout, rng }) {
  const group = new THREE.Group();
  group.name = `landscape-${theme.id}`;
  const palette = PALETTES[theme.id];
  const hot = theme.id === 'lava', dry = theme.id === 'sand', frozen = theme.id === 'frost';
  const { halfW, halfH, channelX, waterWidth, waterDistance, distToPath, heightAt, routes } = layout;
  const std = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true, ...opts });

  const positions = [], uv = [], indices = [];
  const riverEnd = halfH + 0.8, riverSteps = Math.ceil(riverEnd * 12);
  for (let i = 0; i <= riverSteps; i++) {
    const z = -riverEnd + i * riverEnd * 2 / riverSteps, x = channelX(z);
    positions.push(x - waterWidth / 2 - 0.06, -0.27, z, x + waterWidth / 2 + 0.06, -0.27, z);
    uv.push(0, i / riverSteps, 1, i / riverSteps);
    if (i < riverSteps) { const a = i * 2; indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const waterGeo = new THREE.BufferGeometry();
  waterGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  waterGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  waterGeo.setIndex(indices); waterGeo.computeVertexNormals();
  const flow = flowTexture(rng);
  flow.repeat.y *= MAP_LINEAR_SCALE;
  const waterMat = std(palette.water, { map: flow, roughness: dry ? 1 : 0.26, metalness: dry ? 0 : 0.18,
    emissive: hot ? 0xff330a : 0x000000, emissiveIntensity: hot ? 1.35 : 0,
    emissiveMap: hot ? flow : null, side: THREE.DoubleSide });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.name = dry ? 'dry-riverbed' : hot ? 'lava-flow' : frozen ? 'glacier-crevasse' : 'river';
  group.add(water);

  const banks = [], cliffs = [];
  for (let i = 0; i < Math.round(84 * MAP_LINEAR_SCALE); i++) {
    const z = -riverEnd + rng() * riverEnd * 2, side = i % 2 ? -1 : 1;
    const x = channelX(z) + side * (waterWidth / 2 + 0.35 + rng() * 0.45);
    if (distToPath(x, z) < 1.25) continue;
    banks.push({ x, z, y: heightAt(x, z) + 0.06, ry: rng() * 6.28,
      sx: 0.22 + rng() * 0.3, sy: 0.15 + rng() * 0.3, sz: 0.25 + rng() * 0.35 });
  }
  for (let i = 0; i < Math.round(120 * MAP_LINEAR_SCALE); i++) {
    const side = i % 4, t = rng() * 2 - 1;
    const x = side < 2 ? t * (halfW + 1) : (side === 2 ? -1 : 1) * (halfW + 0.4 + rng() * 0.7);
    const z = side < 2 ? (side === 0 ? -1 : 1) * (halfH + 0.6 + rng() * 0.5) : t * (halfH + 0.5);
    if (waterDistance(x, z) < 0.45 || distToPath(x, z) < 1.3) continue;
    cliffs.push({ x, z, y: -0.7 - rng() * 0.35, ry: rng() * 6.28,
      sx: 0.5 + rng() * 0.55, sy: 0.9 + rng() * 0.7, sz: 0.55 + rng() * 0.5 });
  }
  instanceBatch(group, 'riverbank-rocks', new THREE.DodecahedronGeometry(1, 0), std(palette.bank), banks);
  instanceBatch(group, 'weathered-cliffs', new THREE.DodecahedronGeometry(1, 0), std(palette.cliff), cliffs);

  // The deck follows the exact enemy route, including curved crossings.
  const decks = [], rails = [], supports = [], stones = [], markers = [];
  const seen = new Map();
  for (const [routeIndex, route] of routes.entries()) {
    let traveled = 0, nextMarker = 2;
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i], b = route[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
      const key = `${Math.round(x * 3)},${Math.round(z * 3)}`;
      traveled += len;
      const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len, ry = Math.atan2(b.x - a.x, b.z - a.z);
      if (seen.has(key) && seen.get(key) !== routeIndex) continue;
      seen.set(key, routeIndex);
      if (waterDistance(x, z) < 0.55) {
        decks.push({ x, z, y: -0.025, ry, sx: 1.32, sy: 0.13, sz: len * 0.94 });
        for (const sign of [-1, 1]) {
          rails.push({ x: x + nx * 0.68 * sign, z: z + nz * 0.68 * sign,
            y: 0.36, ry, sx: 0.07, sy: 0.075, sz: len * 1.12 });
          if (i % 4 === 0) supports.push({ x: x + nx * 0.68 * sign, z: z + nz * 0.68 * sign,
            y: -0.14, ry, sx: 0.11, sy: 1.05, sz: 0.11 });
        }
      } else if (i % 4 === 0) {
        for (const sign of [-1, 1]) stones.push({ x: x + nx * 0.63 * sign, z: z + nz * 0.63 * sign,
          y: 0.025, ry: ry + rng() * 0.2, sx: 0.14, sy: 0.09 + rng() * 0.035, sz: 0.22 + rng() * 0.13 });
      }
      if (traveled >= nextMarker && waterDistance(x, z) > 0.8) {
        markers.push({ x, z, y: 0.044, ry, sx: 0.21, sy: 1, sz: 0.25 });
        nextMarker = traveled + 5.5;
      }
    }
  }
  const wood = theme.id === 'meadow' || theme.id === 'graveyard';
  instanceBatch(group, 'bridge-decks', new THREE.BoxGeometry(1, 1, 1), std(wood ? 0xa99573 : palette.bank), decks);
  instanceBatch(group, 'bridge-rails', new THREE.BoxGeometry(1, 1, 1), std(wood ? 0x756958 : palette.cliff), rails);
  instanceBatch(group, 'bridge-piers', new THREE.BoxGeometry(1, 1, 1), std(palette.cliff), supports);
  instanceBatch(group, 'road-curbstones', new THREE.BoxGeometry(1, 1, 1), std(palette.bank), stones);
  const arrowGeo = new THREE.BufferGeometry();
  arrowGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1,0,-1, 0,0,0, 0,0,1, 0,0,1, 0,0,0, 1,0,-1], 3));
  instanceBatch(group, 'route-directions', arrowGeo,
    new THREE.MeshBasicMaterial({ color: 0xf3e5bd, transparent: true, opacity: 0.48, side: THREE.DoubleSide }), markers, false);

  // Ambient motes stay above the terrain and never obscure the marching lanes.
  const count = Math.round((frozen ? 170 : hot ? 95 : 60) * MAP_AREA_SCALE);
  const particles = new Float32Array(count * 3), origins = [], speeds = [];
  for (let i = 0; i < count; i++) {
    const x = (rng() * 2 - 1) * (halfW + 1.5), z = (rng() * 2 - 1) * (halfH + 2), y = rng() * 7;
    origins.push(x, y, z); speeds.push(0.25 + rng() * 0.6);
  }
  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute('position', new THREE.BufferAttribute(particles, 3));
  const particlesMat = new THREE.PointsMaterial({ color: palette.particle, size: frozen ? 0.045 : 0.035,
    transparent: true, opacity: frozen ? 0.7 : 0.48, depthWrite: false,
    blending: hot ? THREE.AdditiveBlending : THREE.NormalBlending });
  const motes = new THREE.Points(particleGeo, particlesMat);
  motes.name = frozen ? 'snowfall' : hot ? 'embers' : dry ? 'sand-drift' : 'ambient-motes';
  motes.frustumCulled = false;
  group.add(motes);

  // A continuous water curtain connects the stream to the canyon below.
  if (!dry && !frozen) {
    const waterfall = new THREE.Mesh(new THREE.PlaneGeometry(waterWidth, 3.2, 8, 1), waterMat);
    waterfall.position.set(channelX(riverEnd - 0.05), -1.87, riverEnd - 0.02);
    waterfall.name = 'waterfall';
    group.add(waterfall);
  }

  const flowSpeed = hot ? 0.025 : frozen ? 0.035 : dry ? 0.055 : theme.id === 'graveyard' ? 0.065 : 0.08;
  const update = (time) => {
    // Every themed channel is animated. Frost moves more slowly like meltwater,
    // while the sand channel keeps a visible but restrained muddy-current drift.
    flow.offset.y = -time * flowSpeed;
    if (hot) waterMat.emissiveIntensity = 1.3 + Math.sin(time * 1.1) * 0.12;
    for (let i = 0; i < count; i++) {
      const j = i * 3, speed = speeds[i];
      particles[j] = origins[j] + Math.sin(time * 0.3 + i) * 0.25 + (dry ? Math.sin(time * 0.2) * 1.8 : 0);
      particles[j + 1] = frozen ? 7 - ((origins[j + 1] + time * speed) % 7)
        : hot ? (origins[j + 1] + time * speed) % 7 : 0.5 + origins[j + 1] * 0.3 + Math.sin(time + i) * 0.15;
      particles[j + 2] = origins[j + 2] + Math.cos(time * 0.25 + i) * 0.2;
    }
    particleGeo.attributes.position.needsUpdate = true;
  };
  update(0);
  return { group, update };
}
