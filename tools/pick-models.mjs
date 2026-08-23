#!/usr/bin/env node
// 从已解压的 Kenney 包中拷贝精选模型到 assets/models/（平铺），供 GLTFLoader 使用
import fs from 'node:fs';
import path from 'node:path';

const PICKS = [
  // [源相对路径(包内自动搜索文件名), 目标名]
  ['tree_pineTallA_detailed.glb', 'tree_pine_tall.glb'],
  ['tree_pineRoundC.glb',         'tree_pine_round.glb'],
  ['tree_oak.glb',                'tree_oak.glb'],
  ['tree_default.glb',            'tree_default.glb'],
  ['tree_fat.glb',                'tree_fat.glb'],
  ['plant_bushDetailed.glb',      'bush_detailed.glb'],
  ['plant_bushLarge.glb',         'bush_large.glb'],
  ['grass_large.glb',             'grass_large.glb'],
  ['grass_leafsLarge.glb',        'grass_leafs.glb'],
  ['flower_redA.glb',             'flower_red.glb'],
  ['flower_yellowB.glb',          'flower_yellow.glb'],
  ['flower_purpleC.glb',          'flower_purple.glb'],
  ['rock_largeA.glb',             'rock_large_a.glb'],
  ['rock_largeD.glb',             'rock_large_b.glb'],
  ['stone_smallB.glb',            'stone_small.glb'],
  ['mushroom_redGroup.glb',       'mushroom_red.glb'],
  ['mushroom_tanGroup.glb',       'mushroom_tan.glb'],
  ['stump_old.glb',               'stump_old.glb'],
  ['path_stone.glb',              'path_stone.glb'],
  ['log.glb',                     'log.glb'],
  // TD 包
  ['tower-round-base.glb',        'tower_base.glb'],
  ['weapon-ballista.glb',         'weapon_ballista.glb'],
  ['weapon-cannon.glb',           'weapon_cannon.glb'],
  ['weapon-turret.glb',           'weapon_turret.glb'],
  ['tower-round-crystals.glb',    'tower_crystals.glb'],
  ['detail-crystal-large.glb',    'crystal_large.glb'],
  ['snow-detail-tree-large.glb',  'snow_tree.glb'],
  ['snow-detail-rocks-large.glb', 'snow_rocks.glb'],
  ['spawn-round.glb',             'spawn_pad.glb'],
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
