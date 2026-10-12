/**
 * The blocks' pictures, drawn by code: 16 x 16 pixel tiles in an 8 x 8 atlas (128 x 128 RGBA). Every tile comes from
 * a seeded random generator, so the atlas is the same bytes on every run; nothing is a file and nothing is anyone
 * else's art.
 */
import { TILE, TILE_COUNT } from "../blocks.ts";

export const TILE_PX = 16;
export const ATLAS_TILES = 8;
export const ATLAS_PX = TILE_PX * ATLAS_TILES;

type RGBA = [number, number, number, number];

/** A small seeded generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const shade = ([r, g, b, a]: RGBA, k: number): RGBA => [clamp(r * k), clamp(g * k), clamp(b * k), a];

class Tile {
  readonly px = new Uint8ClampedArray(TILE_PX * TILE_PX * 4);
  readonly random: () => number;
  constructor(seed: number) {
    this.random = rng(seed);
  }
  set(x: number, y: number, [r, g, b, a]: RGBA): void {
    if (x < 0 || y < 0 || x >= TILE_PX || y >= TILE_PX) return;
    const i = (y * TILE_PX + x) * 4;
    this.px[i] = r;
    this.px[i + 1] = g;
    this.px[i + 2] = b;
    this.px[i + 3] = a;
  }
  /** Every pixel the colour, lighter or darker at random by up to `spread`. */
  noise(color: RGBA, spread: number): this {
    for (let y = 0; y < TILE_PX; y++) for (let x = 0; x < TILE_PX; x++) this.set(x, y, shade(color, 1 + (this.random() * 2 - 1) * spread));
    return this;
  }
  /** Scattered pixels of a colour. */
  specks(color: RGBA, count: number, spread = 0.08): this {
    for (let i = 0; i < count; i++) this.set(Math.floor(this.random() * TILE_PX), Math.floor(this.random() * TILE_PX), shade(color, 1 + (this.random() * 2 - 1) * spread));
    return this;
  }
}

const GRASS: RGBA = [92, 168, 72, 255];
const DIRT: RGBA = [134, 96, 67, 255];
const STONE: RGBA = [128, 128, 132, 255];
const SAND: RGBA = [222, 207, 150, 255];
const BARK: RGBA = [104, 78, 50, 255];
const WOOD: RGBA = [186, 146, 92, 255];
const SNOW: RGBA = [240, 244, 250, 255];

function grassTop(t: Tile): void {
  t.noise(GRASS, 0.12).specks([70, 140, 56, 255], 30).specks([120, 190, 90, 255], 14);
}

function dirt(t: Tile): void {
  t.noise(DIRT, 0.1).specks([100, 70, 48, 255], 24).specks([160, 120, 86, 255], 10);
}

/** A side with a band of `top` hanging over dirt, ragged at its lower edge. */
function sideWithTop(t: Tile, top: RGBA, spread: number): void {
  dirt(t);
  for (let x = 0; x < TILE_PX; x++) {
    const depth = 3 + Math.floor(t.random() * 3);
    for (let y = 0; y < depth; y++) t.set(x, y, shade(top, 1 + (t.random() * 2 - 1) * spread));
  }
}

function stone(t: Tile): void {
  t.noise(STONE, 0.07);
  for (let i = 0; i < 7; i++) {
    const x = Math.floor(t.random() * 14);
    const y = Math.floor(t.random() * 15);
    const len = 2 + Math.floor(t.random() * 3);
    for (let k = 0; k < len; k++) t.set(x + k, y, shade(STONE, 0.75));
  }
}

function cobble(t: Tile): void {
  t.noise([96, 96, 100, 255], 0.05);
  // Rounded stones on a grid jittered per row, with dark gaps between.
  for (let row = 0; row < 4; row++) {
    const offset = Math.floor(t.random() * 4);
    for (let col = -1; col < 4; col++) {
      const x0 = col * 5 + offset;
      const y0 = row * 4;
      const tone = 0.85 + t.random() * 0.4;
      for (let y = y0; y < y0 + 3; y++) {
        for (let x = x0; x < x0 + 4; x++) {
          const corner = (y === y0 || y === y0 + 2) && (x === x0 || x === x0 + 3);
          if (!corner) t.set(x, y, shade(STONE, tone * (1 + (t.random() * 2 - 1) * 0.06)));
        }
      }
    }
  }
}

function sand(t: Tile): void {
  t.noise(SAND, 0.06).specks([200, 184, 128, 255], 20).specks([240, 228, 180, 255], 12);
}

function logSide(t: Tile): void {
  for (let x = 0; x < TILE_PX; x++) {
    const k = 0.8 + t.random() * 0.35;
    for (let y = 0; y < TILE_PX; y++) t.set(x, y, shade(BARK, k * (1 + (t.random() * 2 - 1) * 0.08)));
  }
  for (let i = 0; i < 5; i++) {
    const x = Math.floor(t.random() * TILE_PX);
    const y = Math.floor(t.random() * 12);
    for (let k = 0; k < 4; k++) t.set(x, y + k, shade(BARK, 0.6));
  }
}

function logTop(t: Tile): void {
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (d > 6.5) t.set(x, y, shade(BARK, 0.9 + t.random() * 0.1));
      else t.set(x, y, shade(WOOD, (Math.floor(d) % 2 ? 0.88 : 1.02) * (1 + (t.random() * 2 - 1) * 0.04)));
    }
  }
}

function planks(t: Tile): void {
  for (let board = 0; board < 4; board++) {
    const k = 0.9 + t.random() * 0.2;
    const seam = Math.floor(t.random() * TILE_PX);
    for (let y = board * 4; y < board * 4 + 4; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const edge = y === board * 4 + 3 || x === seam;
        t.set(x, y, shade(WOOD, edge ? 0.62 : k * (1 + (t.random() * 2 - 1) * 0.05)));
      }
    }
  }
}

function leaves(t: Tile): void {
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      if (t.random() < 0.2) t.set(x, y, [0, 0, 0, 0]);
      else t.set(x, y, shade([58, 132, 52, 255], 0.75 + t.random() * 0.45));
    }
  }
}

function glass(t: Tile): void {
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const frame = x === 0 || y === 0 || x === TILE_PX - 1 || y === TILE_PX - 1;
      t.set(x, y, frame ? [200, 226, 236, 255] : [0, 0, 0, 0]);
    }
  }
  for (let k = 0; k < 4; k++) {
    t.set(3 + k, 6 - k, [236, 248, 252, 255]);
    t.set(5 + k, 6 - k, [236, 248, 252, 255]);
  }
}

function brick(t: Tile): void {
  const mortar: RGBA = [196, 186, 172, 255];
  for (let y = 0; y < TILE_PX; y++) {
    const row = Math.floor(y / 4);
    const shift = row % 2 ? 4 : 0;
    for (let x = 0; x < TILE_PX; x++) {
      if (y % 4 === 3 || (x + shift) % 8 === 7) t.set(x, y, shade(mortar, 1 + (t.random() * 2 - 1) * 0.05));
      else t.set(x, y, shade([164, 72, 56, 255], 0.9 + t.random() * 0.2));
    }
  }
}

function snow(t: Tile): void {
  t.noise(SNOW, 0.03).specks([220, 228, 240, 255], 18);
}

function water(t: Tile): void {
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const wave = (x + y * 2 + Math.floor(t.random() * 2)) % 9 === 0;
      t.set(x, y, wave ? [120, 176, 236, 200] : shade([52, 108, 200, 180], 0.92 + t.random() * 0.12));
    }
  }
}

function lantern(t: Tile): void {
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const frame = x < 2 || y < 2 || x > 13 || y > 13 || x === 7 || x === 8;
      const glow = 1 - Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) / 12;
      t.set(x, y, frame ? shade([70, 58, 46, 255], 0.9 + t.random() * 0.2) : [255, clamp(200 + glow * 50), clamp(110 + glow * 90), 255]);
    }
  }
}

function clay(t: Tile): void {
  t.noise([158, 164, 178, 255], 0.04).specks([140, 146, 160, 255], 10);
}

function bedrock(t: Tile): void {
  t.noise([60, 60, 62, 255], 0.35).specks([20, 20, 22, 255], 40);
}

const GHOST: RGBA = [244, 244, 252, 255];

function ghostBody(t: Tile): void {
  for (let y = 0; y < TILE_PX; y++) for (let x = 0; x < TILE_PX; x++) t.set(x, y, shade(GHOST, 0.94 + (y / TILE_PX) * -0.08 + t.random() * 0.03));
}

function ghostFace(t: Tile): void {
  ghostBody(t);
  const eye: RGBA = [34, 30, 48, 255];
  for (const cx of [4, 10]) {
    for (let y = 4; y < 8; y++) for (let x = cx; x < cx + 2; x++) t.set(x, y, eye);
    t.set(cx, 4, [255, 255, 255, 255]);
  }
  for (let x = 6; x < 10; x++) t.set(x, 10, [120, 90, 130, 255]);
  t.set(6, 9, [120, 90, 130, 255]);
  t.set(9, 9, [120, 90, 130, 255]);
}

const DRAW: Record<number, (t: Tile) => void> = {
  [TILE.grassTop]: grassTop,
  [TILE.grassSide]: (t) => sideWithTop(t, GRASS, 0.12),
  [TILE.dirt]: dirt,
  [TILE.stone]: stone,
  [TILE.cobble]: cobble,
  [TILE.sand]: sand,
  [TILE.logSide]: logSide,
  [TILE.logTop]: logTop,
  [TILE.planks]: planks,
  [TILE.leaves]: leaves,
  [TILE.glass]: glass,
  [TILE.brick]: brick,
  [TILE.snow]: snow,
  [TILE.snowSide]: (t) => sideWithTop(t, SNOW, 0.03),
  [TILE.water]: water,
  [TILE.lantern]: lantern,
  [TILE.clay]: clay,
  [TILE.bedrock]: bedrock,
  [TILE.ghostFace]: ghostFace,
  [TILE.ghostBody]: ghostBody,
};

/** One tile's pixels, RGBA. */
export function drawTile(tile: number): Uint8ClampedArray {
  const t = new Tile(0x51ed + tile * 7919);
  DRAW[tile](t);
  return t.px;
}

/** The whole atlas, RGBA, ATLAS_PX on a side. */
export function drawAtlas(): Uint8ClampedArray {
  const out = new Uint8ClampedArray(ATLAS_PX * ATLAS_PX * 4);
  for (let tile = 0; tile < TILE_COUNT; tile++) {
    const px = drawTile(tile);
    const ox = (tile % ATLAS_TILES) * TILE_PX;
    const oy = Math.floor(tile / ATLAS_TILES) * TILE_PX;
    for (let y = 0; y < TILE_PX; y++) out.set(px.subarray(y * TILE_PX * 4, (y + 1) * TILE_PX * 4), ((oy + y) * ATLAS_PX + ox) * 4);
  }
  return out;
}
