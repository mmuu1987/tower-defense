#!/usr/bin/env node
// 从已解压的 Kenney 包中拷贝精选模型到 assets/models/（平铺），供 GLTFLoader 使用
import fs from 'node:fs';
import path from 'node:path';

const PICKS = [
  // [源相对路径(包内自动搜索文件名), 目标名]
  ['tree_pineTallA_detailed.glb', 'tree_pine_tall.dat'],
  ['tree_pineRoundC.glb', 'tree_pine_round.dat'],
  ['tree_oak.glb', 'tree_oak.dat'],
  ['tree_default.glb', 'tree_default.dat'],
  ['tree_fat.glb', 'tree_fat.dat'],
  ['plant_bushDetailed.glb', 'bush_detailed.dat'],
  ['plant_bushLarge.glb', 'bush_large.dat'],
  ['grass_large.glb', 'grass_large.dat'],
  ['grass_leafsLarge.glb', 'grass_leafs.dat'],
  ['flower_redA.glb', 'flower_red.dat'],
  ['flower_yellowB.glb', 'flower_yellow.dat'],
  ['flower_purpleC.glb', 'flower_purple.dat'],
  ['rock_largeA.glb', 'rock_large_a.dat'],
  ['rock_largeD.glb', 'rock_large_b.dat'],
  ['stone_smallB.glb', 'stone_small.dat'],
  ['mushroom_redGroup.glb', 'mushroom_red.dat'],
  ['mushroom_tanGroup.glb', 'mushroom_tan.dat'],
  ['stump_old.glb', 'stump_old.dat'],
  ['path_stone.glb', 'path_stone.dat'],
  ['log.glb', 'log.dat'],
  // TD 包
  ['tower-round-base.glb', 'tower_base.dat'],
  ['weapon-ballista.glb', 'weapon_ballista.dat'],
  ['weapon-cannon.glb', 'weapon_cannon.dat'],
  ['weapon-turret.glb', 'weapon_turret.dat'],
  ['tower-round-crystals.glb', 'tower_crystals.dat'],
  ['detail-crystal-large.glb', 'crystal_large.dat'],
  ['snow-detail-tree-large.glb', 'snow_tree.dat'],
  ['snow-detail-rocks-large.glb', 'snow_rocks.dat'],
  ['spawn-round.glb', 'spawn_pad.dat'],
];

const ROOTS = ['assets/kenney/nature', 'assets/kenney/td'];
const OUT = 'assets/models';
fs.mkdirSync(OUT, { recursive: true });

let ok = 0, miss = [];
for (const [name, dest] of PICKS) {
  let found = null;
  for (const root of ROOTS) {
    const dir = root;
    if (!fs.existsSync(dir)) continue;
    const stack = [dir];
    while (stack.length && !found) {
      const d = stack.pop();
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) stack.push(full);
        else if (e.name === name) { found = full; break; }
      }
    }
    if (found) break;
  }
  if (!found) { miss.push(name); continue; }
  fs.copyFileSync(found, path.join(OUT, dest));
  ok++;
}
console.log(`copied ${ok}/${PICKS.length}` + (miss.length ? `; MISSING: ${miss.join(', ')}` : ''));
