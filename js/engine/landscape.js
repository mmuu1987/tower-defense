import * as THREE from 'three';
import { MAP_AREA_SCALE, MAP_LINEAR_SCALE } from '../game/config.js';

const PALETTES = {
  meadow: { water: 0x368b98, bank: 0x737968, cliff: 0x52624e, particle: 0xffecc0 },
  lava: { water: 0xf55b22, bank: 0x393639, cliff: 0x3d3437, particle: 0xff9638 },
  frost: { water: 0x4689aa, bank: 0xbbdbe3, cliff: 0x8dabb6, particle: 0xe4f9ff },
  sand: { water: 0x8e7963, bank: 0xbf9c74, cliff: 0x987c65, particle: 0xf0d3a0 },
  graveyard: { water: 0x315b50, bank: 0x555c56, cliff: 0x46534e, particle: 0x9de6be },
};

const distanceToSegmentSq = (x, z, a, b) => {
  const dx = b.x - a.x, dz = b.z - a.z, lengthSq = dx * dx + dz * dz;
  if (lengthSq < 1e-8) return (x - a.x) ** 2 + (z - a.z) ** 2;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lengthSq));
  return (x - a.x - dx * t) ** 2 + (z - a.z - dz * t) ** 2;
};

// Keep bridge spans in one shared source of truth. Terrain uses the segment
// indices to remove the road/edge below each deck instead of relying on depth
// bias, while the landscape uses the same points to build the visible bridge.
export function findBridgeCrossings(routes, waterDistance) {
  const crossings = [];
  const addCrossing = (route, routeIndex, start, end) => {
    let from = start, to = end + 1, extension = 0;
    while (from > 0 && extension < 1.8 && (extension < 0.55 || waterDistance(route[from].x, route[from].z) < 0.75)) {
      extension += Math.hypot(route[from].x - route[from - 1].x, route[from].z - route[from - 1].z);
      from--;
    }
    extension = 0;
    while (to < route.length - 1 && extension < 1.8 && (extension < 0.55 || waterDistance(route[to].x, route[to].z) < 0.75)) {
      extension += Math.hypot(route[to + 1].x - route[to].x, route[to + 1].z - route[to].z);
      to++;
    }
    const points = route.slice(from, to + 1);
    if (points.length > 1) crossings.push({ points, width: 1.32, routeIndex, from, to });
  };
  for (const [routeIndex, route] of routes.entries()) {
    let wetStart = -1;
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i], b = route[i + 1];
      const wet = waterDistance((a.x + b.x) / 2, (a.z + b.z) / 2) < 0.55;
      if (wet && wetStart < 0) wetStart = i;
      if (wetStart >= 0 && (!wet || i === route.length - 2)) {
        addCrossing(route, routeIndex, wetStart, wet ? i : i - 1);
        wetStart = -1;
      }
    }
  }
  return crossings;
}

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
  if (!transforms.length) { geometry.dispose(); material.dispose(); return null; }
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
  return mesh;
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

  // Build each crossing as a road-width ribbon that follows the actual route.
  // At multi-route junctions the shared deck stays continuous while internal
  // rails are omitted, so the result reads as one intentional bridge junction.
  const rails = [], supports = [], planks = [], stones = [], markers = [];
  const crossings = findBridgeCrossings(routes, waterDistance);
  const nearOtherRoute = (routeIndex, x, z, radius) => routes.some((route, index) => index !== routeIndex &&
    route.some((point, i) => i < route.length - 1 && distanceToSegmentSq(x, z, point, route[i + 1]) < radius ** 2));
  for (const [routeIndex, route] of routes.entries()) {
    let traveled = 0, nextMarker = 2;
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i], b = route[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
      traveled += len;
      const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len, ry = Math.atan2(b.x - a.x, b.z - a.z);
      const wet = waterDistance(x, z) < 0.55;
      if (!wet && i % 4 === 0) {
        for (const sign of [-1, 1]) {
          const sx = x + nx * 0.63 * sign, sz = z + nz * 0.63 * sign;
          if (!nearOtherRoute(routeIndex, sx, sz, 0.82)) stones.push({ x: sx, z: sz,
            y: 0.025, ry: ry + rng() * 0.2, sx: 0.14, sy: 0.09 + rng() * 0.035, sz: 0.22 + rng() * 0.13 });
        }
      }
      if (traveled >= nextMarker && waterDistance(x, z) > 0.8 && !nearOtherRoute(routeIndex, x, z, 0.72)) {
        markers.push({ x, z, y: 0.044, ry, sx: 0.21, sy: 1, sz: 0.25 });
        nextMarker = traveled + 5.5;
      }
    }
  }

  const insideCrossing = (crossing, x, z, padding = 0) => {
    const radiusSq = (crossing.width / 2 + padding) ** 2;
    for (let i = 0; i < crossing.points.length - 1; i++) {
      if (distanceToSegmentSq(x, z, crossing.points[i], crossing.points[i + 1]) <= radiusSq) return true;
    }
    return false;
  };
  const deckPositions = [], deckIndices = [];
  for (const crossing of crossings) {
    const offset = deckPositions.length / 3, half = crossing.width / 2;
    for (let i = 0; i < crossing.points.length; i++) {
      const point = crossing.points[i], prev = crossing.points[Math.max(0, i - 1)], next = crossing.points[Math.min(crossing.points.length - 1, i + 1)];
      const dx = next.x - prev.x, dz = next.z - prev.z, length = Math.hypot(dx, dz) || 1;
      const nx = -dz / length, nz = dx / length;
      deckPositions.push(point.x + nx * half, 0.06, point.z + nz * half,
        point.x - nx * half, 0.06, point.z - nz * half,
        point.x + nx * half, -0.07, point.z + nz * half,
        point.x - nx * half, -0.07, point.z - nz * half);
    }
    for (let i = 0; i < crossing.points.length - 1; i++) {
      const a = offset + i * 4, b = a + 4;
      deckIndices.push(a, b, a + 1, a + 1, b, b + 1,
        a + 2, a + 3, b + 2, a + 3, b + 3, b + 2,
        a + 2, b + 2, a, a, b + 2, b,
        a + 1, b + 1, a + 3, a + 3, b + 1, b + 3);
    }
    const first = offset, last = offset + (crossing.points.length - 1) * 4;
    deckIndices.push(first, first + 1, first + 2, first + 1, first + 3, first + 2,
      last, last + 2, last + 1, last + 1, last + 2, last + 3);
  }
  const deckGeometry = new THREE.BufferGeometry();
  deckGeometry.setAttribute('position', new THREE.Float32BufferAttribute(deckPositions, 3));
  deckGeometry.setIndex(deckIndices); deckGeometry.computeVertexNormals(); deckGeometry.computeBoundingSphere();
  const wood = theme.id === 'meadow' || theme.id === 'graveyard';
  const deckMesh = new THREE.Mesh(deckGeometry, std(wood ? 0xa99573 : palette.bank, { side: THREE.DoubleSide }));
  deckMesh.name = 'bridge-decks'; deckMesh.castShadow = true; deckMesh.receiveShadow = true;
  deckMesh.userData.corridors = crossings.map(({ points, width }) => ({ width, points: points.map(({ x, z }) => ({ x, z })) }));
  deckMesh.userData.crossingCount = crossings.length;
  group.add(deckMesh);

  for (const [crossingIndex, crossing] of crossings.entries()) {
    let plankAt = 0, traveled = 0;
    for (let i = 0; i < crossing.points.length - 1; i++) {
      const a = crossing.points[i], b = crossing.points[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
      if (length < 1e-5) continue;
      const ux = dx / length, uz = dz / length, nx = -uz, nz = ux;
      const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2, ry = Math.atan2(dx, dz);
      for (const sign of [-1, 1]) {
        const offset = crossing.width / 2 + 0.02, ex = x + nx * offset * sign, ez = z + nz * offset * sign;
        const samples = [-0.45, 0, 0.45].map((along) => ({ x: ex + ux * length * along, z: ez + uz * length * along }));
        const entersJunction = crossings.some((other, index) => index !== crossingIndex &&
          samples.some((sample) => insideCrossing(other, sample.x, sample.z, 0.08)));
        if (!entersJunction) rails.push({ x: ex, z: ez, y: 0.32, ry, sx: 0.065, sy: 0.06, sz: length * 1.04, crossingIndex });
        if (!entersJunction && i % 8 === 0) supports.push({ x: ex, z: ez, y: -0.14, ry,
          sx: 0.09, sy: 0.92, sz: 0.09 });
      }
      while (plankAt <= traveled + length) {
        if (plankAt >= traveled) {
          const t = (plankAt - traveled) / length, px = a.x + dx * t, pz = a.z + dz * t;
          const atJunction = crossings.some((other, index) => index !== crossingIndex && insideCrossing(other, px, pz, 0));
          if (!atJunction) planks.push({ x: px, z: pz, y: 0.068, ry,
            sx: crossing.width * 0.94, sy: 0.012, sz: 0.025 });
        }
        plankAt += 0.42;
      }
      traveled += length;
    }
  }
  const railMesh = instanceBatch(group, 'bridge-rails', new THREE.BoxGeometry(1, 1, 1), std(wood ? 0x756958 : palette.cliff), rails);
  if (railMesh) railMesh.userData.corridorIndices = rails.map(({ crossingIndex }) => crossingIndex);
  instanceBatch(group, 'bridge-piers', new THREE.BoxGeometry(1, 1, 1), std(palette.cliff), supports);
  instanceBatch(group, 'bridge-planks', new THREE.BoxGeometry(1, 1, 1), std(wood ? 0x756958 : palette.cliff), planks, false);
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
