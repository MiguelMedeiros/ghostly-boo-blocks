/**
 * A section's mesh: one quad for each face of a block that something see-through touches, with the block's tile, a
 * shade for the face's direction and ambient occlusion at each corner. Solid and cut-out blocks go in one mesh (the
 * shader drops the transparent pixels); water in a second, drawn last with blending.
 *
 * A vertex is 6 floats: x, y, z (world), u, v (atlas), light (0 to 1).
 */
import { BLOCKS, GLASS, isOpaque, WATER } from "../blocks.ts";
import { SECTION, SECTIONS_X, SECTIONS_Z } from "../world.ts";
import { ATLAS_TILES } from "./atlas.ts";

export const FLOATS_PER_VERTEX = 6;

/** What the mesher reads: the block at any cell (outside the world: air, or bedrock below it). */
export interface BlockSource {
  get(x: number, y: number, z: number): number;
}

export interface SectionMesh {
  solid: { vertices: Float32Array; indices: Uint32Array };
  water: { vertices: Float32Array; indices: Uint32Array };
}

/** Each face: its normal, which of the block's three tiles it shows, its shade, and its corners [x, y, z, u, v]. */
const FACES: { n: [number, number, number]; slot: 0 | 1 | 2; shade: number; c: [number, number, number, number, number][] }[] = [
  { n: [1, 0, 0], slot: 1, shade: 0.8, c: [[1, 1, 1, 0, 0], [1, 1, 0, 1, 0], [1, 0, 0, 1, 1], [1, 0, 1, 0, 1]] },
  { n: [-1, 0, 0], slot: 1, shade: 0.8, c: [[0, 1, 0, 0, 0], [0, 1, 1, 1, 0], [0, 0, 1, 1, 1], [0, 0, 0, 0, 1]] },
  { n: [0, 1, 0], slot: 0, shade: 1, c: [[0, 1, 0, 0, 0], [1, 1, 0, 1, 0], [1, 1, 1, 1, 1], [0, 1, 1, 0, 1]] },
  { n: [0, -1, 0], slot: 2, shade: 0.5, c: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
  { n: [0, 0, 1], slot: 1, shade: 0.65, c: [[0, 1, 1, 0, 0], [1, 1, 1, 1, 0], [1, 0, 1, 1, 1], [0, 0, 1, 0, 1]] },
  { n: [0, 0, -1], slot: 1, shade: 0.65, c: [[1, 1, 0, 0, 0], [0, 1, 0, 1, 0], [0, 0, 0, 1, 1], [1, 0, 0, 0, 1]] },
];

/** A small inset keeps a tile's neighbours in the atlas from bleeding in at its edges. */
const INSET = 0.002;

export function tileUv(tile: number, u: number, v: number): [number, number] {
  const col = tile % ATLAS_TILES;
  const row = Math.floor(tile / ATLAS_TILES);
  return [(col + INSET + u * (1 - 2 * INSET)) / ATLAS_TILES, (row + INSET + v * (1 - 2 * INSET)) / ATLAS_TILES];
}

class Builder {
  vertices: number[] = [];
  indices: number[] = [];
  quad(corners: number[][], light: number[]): void {
    const base = this.vertices.length / FLOATS_PER_VERTEX;
    for (const c of corners) this.vertices.push(...c);
    // Split the quad along the diagonal that keeps the occlusion smooth.
    if (light[0] + light[2] < light[1] + light[3]) this.indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    else this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  done() {
    return { vertices: new Float32Array(this.vertices), indices: new Uint32Array(this.indices) };
  }
}

/** Whether a face of `block` next to `other` is seen. */
function faceShows(block: number, other: number): boolean {
  if (isOpaque(other)) return false;
  if (block === WATER) return other !== WATER;
  if (block === GLASS) return other !== GLASS;
  return true;
}

export function meshSection(world: BlockSource, section: number): SectionMesh {
  const sx = (section % SECTIONS_X) * SECTION;
  const sz = (Math.floor(section / SECTIONS_X) % SECTIONS_Z) * SECTION;
  const sy = Math.floor(section / (SECTIONS_X * SECTIONS_Z)) * SECTION;
  const solid = new Builder();
  const water = new Builder();
  const occludes = (x: number, y: number, z: number) => (isOpaque(world.get(x, y, z)) ? 1 : 0);
  for (let y = sy; y < sy + SECTION; y++) {
    for (let z = sz; z < sz + SECTION; z++) {
      for (let x = sx; x < sx + SECTION; x++) {
        const block = world.get(x, y, z);
        const kind = BLOCKS[block];
        if (!kind) continue;
        const out = block === WATER ? water : solid;
        for (const face of FACES) {
          const [nx, ny, nz] = face.n;
          if (!faceShows(block, world.get(x + nx, y + ny, z + nz))) continue;
          const tile = kind.tiles[face.slot];
          // Water's surface sits a little lower than a full block when nothing is on it.
          const lowered = block === WATER && world.get(x, y + 1, z) !== WATER ? 0.12 : 0;
          const corners: number[][] = [];
          const light: number[] = [];
          for (const [cx, cy, cz, u, v] of face.c) {
            let ao = 3;
            if (!kind.glow && block !== WATER) {
              // The three cells around this corner just outside the face.
              const ox = nx !== 0 ? 0 : cx ? 1 : -1;
              const oy = ny !== 0 ? 0 : cy ? 1 : -1;
              const oz = nz !== 0 ? 0 : cz ? 1 : -1;
              const px = x + nx;
              const py = y + ny;
              const pz = z + nz;
              const axes = [ox !== 0 ? [ox, 0, 0] : null, oy !== 0 ? [0, oy, 0] : null, oz !== 0 ? [0, 0, oz] : null].filter((a): a is number[] => a !== null);
              const s1 = occludes(px + axes[0][0], py + axes[0][1], pz + axes[0][2]);
              const s2 = occludes(px + axes[1][0], py + axes[1][1], pz + axes[1][2]);
              const corner = occludes(px + ox, py + oy, pz + oz);
              ao = s1 && s2 ? 0 : 3 - (s1 + s2 + corner);
            }
            const l = kind.glow ? 1 : face.shade * (0.45 + (ao / 3) * 0.55);
            const [tu, tv] = tileUv(tile, u, v);
            corners.push([x + cx, y + cy - (cy ? lowered : 0), z + cz, tu, tv, l]);
            light.push(l);
          }
          out.quad(corners, light);
        }
      }
    }
  }
  return { solid: solid.done(), water: water.done() };
}

/** A box's faces as quads (for the contact's ghost): tiles for the front and the rest, centred on x and z. */
export function boxMesh(w: number, h: number, d: number, front: number, rest: number): { vertices: Float32Array; indices: Uint32Array } {
  const b = new Builder();
  for (const face of FACES) {
    const tile = face.n[2] === -1 ? front : rest;
    const corners = face.c.map(([cx, cy, cz, u, v]) => {
      const [tu, tv] = tileUv(tile, u, v);
      return [(cx - 0.5) * w, cy * h, (cz - 0.5) * d, tu, tv, face.shade * 0.25 + 0.75];
    });
    b.quad(corners, [1, 1, 1, 1]);
  }
  return b.done();
}
