/**
 * Which block a ray hits, cell by cell (Amanatides and Woo's traversal): the first block one can point at, and the
 * cell in front of the face it entered by, where a new block would go. Water and air are passed through.
 */
import { BLOCKS, WATER } from "./blocks.ts";
import type { BlockSource } from "./render/mesher.ts";
import type { Vec3 } from "./render/math.ts";

export interface Hit {
  /** The block pointed at. */
  cell: Vec3;
  /** The cell before it along the ray: where a placed block goes. */
  before: Vec3;
}

export const REACH = 8;

export function raycast(world: BlockSource, origin: Vec3, dir: Vec3, reach = REACH): Hit | null {
  let x = Math.floor(origin[0]);
  let y = Math.floor(origin[1]);
  let z = Math.floor(origin[2]);
  const step = dir.map((d) => (d > 0 ? 1 : d < 0 ? -1 : 0)) as Vec3;
  const delta = dir.map((d) => (d === 0 ? Infinity : Math.abs(1 / d))) as Vec3;
  const next = [0, 1, 2].map((i) => {
    const p = origin[i];
    const cell = Math.floor(p);
    if (step[i] > 0) return (cell + 1 - p) * delta[i];
    if (step[i] < 0) return (p - cell) * delta[i];
    return Infinity;
  });
  let before: Vec3 = [x, y, z];
  for (let travelled = 0; travelled <= reach; ) {
    const block = world.get(x, y, z);
    if (block !== WATER && BLOCKS[block] && !(x === Math.floor(origin[0]) && y === Math.floor(origin[1]) && z === Math.floor(origin[2]))) {
      return { cell: [x, y, z], before };
    }
    before = [x, y, z];
    const axis = next[0] < next[1] ? (next[0] < next[2] ? 0 : 2) : next[1] < next[2] ? 1 : 2;
    travelled = next[axis];
    next[axis] += delta[axis];
    if (axis === 0) x += step[0];
    else if (axis === 1) y += step[1];
    else z += step[2];
  }
  return null;
}
