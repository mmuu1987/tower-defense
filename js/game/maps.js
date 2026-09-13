// Campaign map registry. Route topology lives in map-routes.js so it can be
// reviewed independently from coordinate scaling and runtime metadata.
import { GRID, MAP_DESIGN_GRID } from './config.js';
import { WORLD_MAPS } from './map-routes.js';

const WORLD_IDS = ['meadow', 'lava', 'frost', 'sand', 'graveyard'];

export const MAPS = WORLD_MAPS.flatMap((layouts, worldIdx) =>
  layouts.map(([name, waypoints, branch], lvlIdx) => {
    const authoredRoutes = [waypoints];
    if (branch) {
      const [from, to, via] = branch;
      authoredRoutes.push([...waypoints.slice(0, from + 1), ...via, ...waypoints.slice(to)]);
    }
    // Stretch the battlefield, not cell, road, tower or enemy dimensions.
    const routes = authoredRoutes.map((route) => route.map(([x, z]) => [
      x / (MAP_DESIGN_GRID.w - 1) * (GRID.w - 1),
      z / (MAP_DESIGN_GRID.h - 1) * (GRID.h - 1),
    ]));
    return {
      id: `${WORLD_IDS[worldIdx]}-${lvlIdx + 1}`,
      name,
      worldIdx,
      lvlIdx,
      seed: 71237 + worldIdx * 1009 + lvlIdx * 137,
      waypoints: routes[0],
      routes,
      cornerRadius: [1.35, 0.78, 1.18, 1.02, 0.9][worldIdx] + (lvlIdx % 3) * 0.06,
    };
  }),
);

export function mapForLevel(worldIdx, lvlIdx) {
  const w = Math.max(0, Math.min(WORLD_MAPS.length - 1, Math.floor(worldIdx) || 0));
  const l = Math.max(0, Math.min(9, Math.floor(lvlIdx) || 0));
  return MAPS[w * 10 + l];
}
