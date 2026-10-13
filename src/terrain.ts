/**
 * The world's ground, made from a seed. Both sides make it themselves, so it must come out the same, block for block,
 * in every browser: the noise is integer hashing (Math.imul), and the floating point is only +, -, * and / on small
 * values, which IEEE 754 rounds the same everywhere. No Math.sin, Math.pow or Math.random. A pinned hash of the
 * default world in test/terrain.test.ts fails if any of it changes.
 *
 * A world keeps the generator it was made with (`GENERATOR`): a later version that draws the ground differently gets
 * a new number and keeps this one for worlds made with it, or every block built on the old ground would float.
 */
import { AIR, BEDROCK, CLAY, DIRT, GRASS, LEAVES, LOG, SAND, SNOW, STONE, WATER } from "./blocks.ts";

export const SIZE_X = 128;
export const SIZE_Z = 128;
export const SIZE_Y = 64;
export const CELLS = SIZE_X * SIZE_Y * SIZE_Z;
export const SEA_LEVEL = 20;
/** The generator this version makes worlds with. */
export const GENERATOR = 1;
/** The seed of a chat's first world, the same for everyone: two people who each start alone build on the same ground. */
export const DEFAULT_SEED = 0x6b0c;

/** The index of a cell: x first, then z, then y. */
export const cellIndex = (x: number, y: number, z: number): number => (y * SIZE_Z + z) * SIZE_X + x;
export const inWorld = (x: number, y: number, z: number): boolean => x >= 0 && y >= 0 && z >= 0 && x < SIZE_X && y < SIZE_Y && z < SIZE_Z;

/** A 32-bit hash of integers (a mix in the manner of murmur3's finalizer). */
export function hash3(seed: number, x: number, y: number, z: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ Math.imul(x, 0x27d4eb2d), 0xc2b2ae35);
  h = Math.imul(h ^ Math.imul(y, 0x165667b1), 0x85ebca6b);
  h = Math.imul(h ^ Math.imul(z, 0x9e3779b1), 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A value in [0, 1) at an integer point. */
const unit = (seed: number, x: number, z: number): number => hash3(seed, x, 0, z) / 4294967296;
const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Value noise in [0, 1): the lattice values around (x, z) / scale, smoothly mixed. `scale` is a whole number. */
function valueNoise(seed: number, x: number, z: number, scale: number): number {
  const gx = Math.floor(x / scale);
  const gz = Math.floor(z / scale);
  const tx = smooth((x - gx * scale) / scale);
  const tz = smooth((z - gz * scale) / scale);
  const a = unit(seed, gx, gz);
  const b = unit(seed, gx + 1, gz);
  const c = unit(seed, gx, gz + 1);
  const d = unit(seed, gx + 1, gz + 1);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * tz;
}

/** The ground's height at a column: the top solid block's y. */
export function heightAt(seed: number, x: number, z: number): number {
  const continent = valueNoise(seed, x, z, 64);
  const hills = valueNoise(seed + 1, x, z, 24);
  const detail = valueNoise(seed + 2, x, z, 8);
  const ridged = hills * hills;
  const h = 9 + continent * 22 + ridged * 22 + detail * 4;
  return Math.max(3, Math.min(SIZE_Y - 10, Math.floor(h)));
}

const SNOW_LINE = 44;

/** Makes the whole world's ground for a seed: one byte per cell, the block id. */
export function generate(seed: number): Uint8Array {
  const cells = new Uint8Array(CELLS);
  const heights = new Int32Array(SIZE_X * SIZE_Z);
  for (let z = 0; z < SIZE_Z; z++) {
    for (let x = 0; x < SIZE_X; x++) {
      const h = heightAt(seed, x, z);
      heights[z * SIZE_X + x] = h;
      const beach = h <= SEA_LEVEL + 1;
      const clay = h < SEA_LEVEL - 2 && hash3(seed + 7, x >> 2, 0, z >> 2) % 5 === 0;
      for (let y = 0; y <= h; y++) {
        let block: number;
        if (y === 0) block = BEDROCK;
        else if (y < h - 3) block = STONE;
        else if (y < h) block = beach ? (clay ? CLAY : SAND) : DIRT;
        else if (beach) block = clay ? CLAY : SAND;
        else if (h >= SNOW_LINE) block = SNOW;
        else block = GRASS;
        cells[cellIndex(x, y, z)] = block;
      }
      for (let y = h + 1; y <= SEA_LEVEL; y++) cells[cellIndex(x, y, z)] = WATER;
    }
  }
  // Trees: on grass, away from the world's edge, at most one in each 5 x 5 patch so they never grow into each other.
  for (let pz = 0; pz < SIZE_Z / 5; pz++) {
    for (let px = 0; px < SIZE_X / 5; px++) {
      const r = hash3(seed + 3, px, 0, pz);
      if (r % 100 >= 22) continue;
      const x = px * 5 + 2 + ((r >>> 8) % 2) - 0;
      const z = pz * 5 + 2 + ((r >>> 12) % 2);
      if (x < 3 || z < 3 || x > SIZE_X - 4 || z > SIZE_Z - 4) continue;
      const h = heights[z * SIZE_X + x];
      if (cells[cellIndex(x, h, z)] !== GRASS || h + 8 >= SIZE_Y) continue;
      const trunk = 4 + ((r >>> 16) % 2);
      for (let y = h + 1; y <= h + trunk; y++) cells[cellIndex(x, y, z)] = LOG;
      const top = h + trunk;
      for (let dy = -2; dy <= 1; dy++) {
        const radius = dy >= 0 ? 1 : 2;
        for (let dz = -radius; dz <= radius; dz++) {
          for (let dx = -radius; dx <= radius; dx++) {
            // The corners of the wide layers are left out at random, so the crowns are round-ish.
            if (radius === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2 && hash3(seed + 4, x + dx, top + dy, z + dz) % 2 === 0) continue;
            const i = cellIndex(x + dx, top + dy, z + dz);
            if (cells[i] === AIR) cells[i] = LEAVES;
          }
        }
      }
      const crown = cellIndex(x, top + 2, z);
      if (cells[crown] === AIR) cells[crown] = LEAVES;
    }
  }
  return cells;
}

/**
 * Where a person starts: near the middle of the world, `dx` and `dz` blocks from it, on the ground (or the water).
 * Each side picks its own small offset, so two people who arrive together do not stand inside each other.
 */
export function spawnPoint(cells: Uint8Array, dx = 0, dz = 0): [number, number, number] {
  const x = SIZE_X / 2 + dx;
  const z = SIZE_Z / 2 + dz;
  let y = SIZE_Y - 1;
  while (y > 0 && cells[cellIndex(x, y, z)] === AIR) y--;
  return [x + 0.5, y + 1, z + 0.5];
}
