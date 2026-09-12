// 固定尺寸均匀网格：为长地图上的范围攻击、治疗和光环提供可复用的局部查询。
export class SpatialIndex {
  constructor(cellSize = 4) {
    this.cellSize = Math.max(1, cellSize);
    this.buckets = new Map();
    this.members = new Map();
  }

  _key(x, z) { return String(Math.floor(x / this.cellSize)) + ',' + String(Math.floor(z / this.cellSize)); }

  _bucket(key, create = false) {
    let bucket = this.buckets.get(key);
    if (!bucket && create) { bucket = new Set(); this.buckets.set(key, bucket); }
    return bucket;
  }

  insert(item, x = item?.pos?.x, z = item?.pos?.z) {
    if (!item || !Number.isFinite(x) || !Number.isFinite(z)) return false;
    this.remove(item);
    const key = this._key(x, z);
    this._bucket(key, true).add(item);
    this.members.set(item, key);
    return true;
  }

  update(item, x = item?.pos?.x, z = item?.pos?.z) {
    if (!item || !Number.isFinite(x) || !Number.isFinite(z)) return false;
    const next = this._key(x, z), prev = this.members.get(item);
    if (prev === next) return true;
    if (prev) {
      const old = this._bucket(prev);
      old?.delete(item);
      if (old?.size === 0) this.buckets.delete(prev);
    }
    this._bucket(next, true).add(item);
    this.members.set(item, next);
    return true;
  }

  remove(item) {
    const key = this.members.get(item);
    if (!key) return false;
    const bucket = this._bucket(key);
    bucket?.delete(item);
    if (bucket?.size === 0) this.buckets.delete(key);
    this.members.delete(item);
    return true;
  }

  queryRadius(x, z, radius, predicate = null) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius) || radius < 0) return [];
    const minX = Math.floor((x - radius) / this.cellSize), maxX = Math.floor((x + radius) / this.cellSize);
    const minZ = Math.floor((z - radius) / this.cellSize), maxZ = Math.floor((z + radius) / this.cellSize);
    const out = [], r2 = radius * radius;
    for (let ix = minX; ix <= maxX; ix++) for (let iz = minZ; iz <= maxZ; iz++) {
      const bucket = this.buckets.get(String(ix) + ',' + String(iz));
      if (!bucket) continue;
      for (const item of bucket) {
        const p = item.pos;
        if (!p) continue;
        const dx = p.x - x, dz = p.z - z;
        if (dx * dx + dz * dz > r2) continue;
        if (predicate && !predicate(item)) continue;
        out.push(item);
      }
    }
    return out;
  }

  clear() { this.buckets.clear(); this.members.clear(); }
  get size() { return this.members.size; }
}
