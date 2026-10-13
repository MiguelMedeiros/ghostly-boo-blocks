// Draws Boo Blocks's icon by code: a 32 x 32 pixel picture (a blocky ghost holding a grass block over the ground),
// scaled 16 times to assets/icon.png, 512 x 512. No image library: the PNG is written here (zlib from Node). The
// same code always gives the same bytes; test/icon.test.ts checks the committed file is this script's output.
//
//   npm run gen:icon            writes assets/icon.png
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const GRID = 32;
export const SCALE = 16;

const C = {
  sky0: [126, 190, 238],
  sky1: [150, 205, 244],
  sky2: [176, 219, 248],
  sky3: [201, 232, 251],
  grass: [92, 168, 72],
  grassDark: [70, 140, 56],
  grassLight: [120, 190, 90],
  dirt: [134, 96, 67],
  dirtDark: [100, 70, 48],
  dirtLight: [160, 120, 86],
  shadow: [62, 120, 50],
  ink: [43, 37, 64],
  ghost: [246, 245, 252],
  ghostShade: [216, 212, 238],
  white: [255, 255, 255],
  blush: [244, 170, 196],
};

/** The picture, one [r, g, b] per pixel, row by row. */
export function drawIcon() {
  const px = Array.from({ length: GRID * GRID }, () => C.sky0);
  const set = (x, y, c) => {
    if (x >= 0 && y >= 0 && x < GRID && y < GRID) px[y * GRID + x] = c;
  };
  const get = (x, y) => px[y * GRID + x];
  // A seeded speckle, the same every run.
  let seed = 0x6b0c;
  const rand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };

  // Sky in four bands, lighter toward the ground.
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) set(x, y, [C.sky0, C.sky1, C.sky2, C.sky3][Math.min(3, Math.floor(y / 7))]);
  // A small cloud.
  for (const [x, y] of [[3, 4], [4, 4], [5, 4], [2, 5], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5]]) set(x, y, C.white);
  for (const [x, y] of [[25, 7], [26, 7], [27, 7], [24, 8], [25, 8], [26, 8], [27, 8], [28, 8]]) set(x, y, C.white);

  // The ground: grass on dirt, the grass hanging over the edge unevenly.
  for (let y = 26; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const k = rand();
      if (y < 28) set(x, y, k < 0.2 ? C.grassDark : k > 0.85 ? C.grassLight : C.grass);
      else set(x, y, k < 0.2 ? C.dirtDark : k > 0.85 ? C.dirtLight : C.dirt);
    }
  }
  for (let x = 0; x < GRID; x++) if (rand() < 0.45) set(x, 28, C.grassDark);
  // The ghost's shadow on the grass.
  for (let x = 10; x <= 21; x++) set(x, 26, C.shadow);
  for (let x = 12; x <= 19; x++) set(x, 27, C.shadow);

  // The ghost: a body 14 wide with its top corners rounded and a wavy hem, outlined in ink.
  const inBody = (x, y) => {
    if (x < 9 || x > 22 || y < 4 || y > 22) return false;
    if (y === 4 && (x < 11 || x > 20)) return false;
    if (y === 5 && (x < 10 || x > 21)) return false;
    // The hem: tabs of two columns, long and short in turn.
    if (y >= 21) return Math.floor((x - 9) / 2) % 2 === 0 ? true : y === 21;
    return true;
  };
  const outline = (inside, keep = () => false) => {
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (inside(x, y) || keep(x, y)) continue;
        if (inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) || inside(x, y + 1)) set(x, y, C.ink);
      }
    }
  };
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) if (inBody(x, y)) set(x, y, x >= 20 ? C.ghostShade : C.ghost);
  outline(inBody);
  // Eyes with a shine, cheeks, a small smile.
  for (const ex of [12, 18]) {
    for (let y = 8; y <= 10; y++) for (let x = ex; x <= ex + 1; x++) set(x, y, C.ink);
    set(ex, 8, C.white);
  }
  set(11, 11, C.blush);
  set(20, 11, C.blush);
  for (const [x, y] of [[14, 11], [17, 11], [15, 12], [16, 12]]) set(x, y, C.ink);

  // The grass block it holds in front of it: 10 x 10, outlined.
  const bx = 11;
  const by = 15;
  const inBlock = (x, y) => x >= bx && x < bx + 10 && y >= by && y < by + 10;
  for (let y = by; y < by + 10; y++) {
    for (let x = bx; x < bx + 10; x++) {
      const k = rand();
      let c = y < by + 3 ? (k < 0.25 ? C.grassDark : k > 0.85 ? C.grassLight : C.grass) : k < 0.25 ? C.dirtDark : k > 0.85 ? C.dirtLight : C.dirt;
      if (y === by + 3 && k < 0.5) c = C.grassDark;
      set(x, y, c);
    }
  }
  outline(inBlock);
  // Two little hands gripping its sides.
  const hands = [[bx - 2, by + 4], [bx - 1, by + 4], [bx - 2, by + 5], [bx - 1, by + 5], [bx + 10, by + 4], [bx + 11, by + 4], [bx + 10, by + 5], [bx + 11, by + 5]];
  const isHand = (x, y) => hands.some(([hx, hy]) => hx === x && hy === y);
  for (const [x, y] of hands) set(x, y, C.ghost);
  outline(isHand, inBlock);
  void get;
  return px;
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(bytes) {
  let c = -1;
  for (const b of bytes) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, crc]);
}

/** The icon as PNG bytes: RGB, 8 bits, GRID * SCALE on a side. */
export function iconPng() {
  const px = drawIcon();
  const size = GRID * SCALE;
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 3);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = px[Math.floor(y / SCALE) * GRID + Math.floor(x / SCALE)];
      raw.set([r, g, b], row + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

export const ICON = resolve(fileURLToPath(new URL("..", import.meta.url)), "assets/icon.png");

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const png = iconPng();
  writeFileSync(ICON, png);
  console.log(`assets/icon.png ${png.length} bytes, ${GRID * SCALE} x ${GRID * SCALE}`);
}
