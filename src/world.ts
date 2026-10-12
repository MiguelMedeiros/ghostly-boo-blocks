/**
 * The world: the ground made from its seed (src/terrain.ts), and on top of it every block people changed, the edits.
 *
 * Each edited cell keeps a stamp: a Lamport clock and the block. Of two stamps for one cell the higher clock wins, and
 * on equal clocks the higher block id, so applying the same edits in any order, any number of times, on either side,
 * ends in the same world (a last-writer-wins register per cell). That is the whole of conflict handling: two people
 * editing at once, or one building alone while the other is away, merge cell by cell.
 *
 * Only the edits are stored and sent. For sync the world is cut in sections of 16 x 16 x 16; each has a hash of its
 * edits, so two sides find which sections differ by swapping 256 numbers.
 */
import { AIR, BEDROCK } from "./blocks.ts";
import { CELLS, DEFAULT_SEED, GENERATOR, SIZE_X, SIZE_Y, SIZE_Z, cellIndex, generate, inWorld } from "./terrain.ts";

export const SECTION = 16;
export const SECTIONS_X = SIZE_X / SECTION;
export const SECTIONS_Y = SIZE_Y / SECTION;
export const SECTIONS_Z = SIZE_Z / SECTION;
export const SECTION_COUNT = SECTIONS_X * SECTIONS_Y * SECTIONS_Z;
/** The most edited cells a world keeps: about 4.3 MB in storage, under the 5 MiB a chat's app may keep. */
export const MAX_EDITS = 400_000;
/** The highest clock a stamp may carry (32 bits on the wire and in storage). */
export const MAX_CLOCK = 0xffffffff;

/** Which world this is: its generator, its seed, and how many times it was started again. */
export interface WorldId {
  generator: number;
  seed: number;
  epoch: number;
}

export const DEFAULT_WORLD: WorldId = { generator: GENERATOR, seed: DEFAULT_SEED, epoch: 0 };

export const sameWorld = (a: WorldId, b: WorldId): boolean => a.generator === b.generator && a.seed === b.seed && a.epoch === b.epoch;

/**
 * Which of two worlds both sides keep when they differ: the one started again more recently (higher epoch), then the
 * higher seed, then the higher generator. Both sides decide alike, so they end in one world.
 */
export function newerWorld(a: WorldId, b: WorldId): WorldId {
  if (a.epoch !== b.epoch) return a.epoch > b.epoch ? a : b;
  if (a.seed !== b.seed) return a.seed > b.seed ? a : b;
  return a.generator >= b.generator ? a : b;
}

export const stampOf = (clock: number, block: number): number => clock * 256 + block;
export const clockOf = (stamp: number): number => Math.floor(stamp / 256);
export const blockOf = (stamp: number): number => stamp % 256;

export const sectionOf = (cell: number): number => {
  const x = cell % SIZE_X;
  const z = Math.floor(cell / SIZE_X) % SIZE_Z;
  const y = Math.floor(cell / (SIZE_X * SIZE_Z));
  return ((y >> 4) * SECTIONS_Z + (z >> 4)) * SECTIONS_X + (x >> 4);
};

/** A cell's index inside its section (0 to 4095), and back. */
export const localOf = (cell: number): number => {
  const x = cell % SIZE_X;
  const z = Math.floor(cell / SIZE_X) % SIZE_Z;
  const y = Math.floor(cell / (SIZE_X * SIZE_Z));
  return ((y & 15) * SECTION + (z & 15)) * SECTION + (x & 15);
};
export const cellOfLocal = (section: number, local: number): number => {
  const sx = section % SECTIONS_X;
  const sz = Math.floor(section / SECTIONS_X) % SECTIONS_Z;
  const sy = Math.floor(section / (SECTIONS_X * SECTIONS_Z));
  return cellIndex(sx * SECTION + (local & 15), sy * SECTION + (local >> 8), sz * SECTION + ((local >> 4) & 15));
};

/** Why an edit was not taken. */
export type Refusal = "older" | "full" | "outside";

export class World {
  id: WorldId;
  /** The block in every cell: the ground with the edits on it. */
  cells: Uint8Array;
  /** Every edited cell's stamp. */
  readonly edits = new Map<number, number>();
  /** The highest clock seen, from this side or the contact's. */
  clock = 0;
  /** The edited cells of each section. */
  private readonly sectionCells: Set<number>[] = Array.from({ length: SECTION_COUNT }, () => new Set());
  private readonly hashes = new Int32Array(SECTION_COUNT);
  private readonly hashDirty = new Uint8Array(SECTION_COUNT);
  /** Called with each cell whose block changed, to redraw it. */
  onChange: (cell: number, block: number) => void = () => {};
  /** Called with each cell whose stamp changed, to store it. */
  onEdit: (cell: number) => void = () => {};

  constructor(id: WorldId = DEFAULT_WORLD) {
    this.id = id;
    this.cells = generate(id.seed);
  }

  /** Starts over as another world: its ground, no edits. */
  reset(id: WorldId): void {
    this.id = id;
    this.cells = generate(id.seed);
    this.edits.clear();
    for (const set of this.sectionCells) set.clear();
    this.hashes.fill(0);
    this.hashDirty.fill(0);
    this.clock = 0;
  }

  get(x: number, y: number, z: number): number {
    if (!inWorld(x, y, z)) return y < 0 ? BEDROCK : AIR;
    return this.cells[cellIndex(x, y, z)];
  }

  /** An edit made here: the next clock, and the block. Null when it changes nothing or the world is full. */
  edit(x: number, y: number, z: number, block: number): { cell: number; stamp: number } | null {
    if (!inWorld(x, y, z) || this.clock >= MAX_CLOCK) return null;
    const cell = cellIndex(x, y, z);
    if (this.cells[cell] === block) return null;
    const stamp = stampOf(this.clock + 1, block);
    return this.apply(cell, stamp) === true ? { cell, stamp } : null;
  }

  /** Takes an edit (from here, from storage or from the contact) if it wins over what the cell has. */
  apply(cell: number, stamp: number): true | Refusal {
    if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) return "outside";
    const had = this.edits.get(cell);
    if (had !== undefined && had >= stamp) return "older";
    if (had === undefined && this.edits.size >= MAX_EDITS) return "full";
    this.edits.set(cell, stamp);
    const section = sectionOf(cell);
    this.sectionCells[section].add(cell);
    this.hashDirty[section] = 1;
    const clock = clockOf(stamp);
    if (clock > this.clock) this.clock = clock;
    this.onEdit(cell);
    const block = blockOf(stamp);
    if (this.cells[cell] !== block) {
      this.cells[cell] = block;
      this.onChange(cell, block);
    }
    return true;
  }

  /** The edited cells of a section, in order, with their stamps. */
  sectionEdits(section: number): [number, number][] {
    return [...this.sectionCells[section]].sort((a, b) => a - b).map((cell) => [cell, this.edits.get(cell)!]);
  }

  /** A section's hash: FNV-1a of its edits in order, 0 for a section with none. */
  sectionHash(section: number): number {
    if (this.hashDirty[section]) {
      let h = 0;
      if (this.sectionCells[section].size) {
        h = 0x811c9dc5 | 0;
        for (const [cell, stamp] of this.sectionEdits(section)) {
          for (const n of [cell, clockOf(stamp), blockOf(stamp)]) {
            for (let shift = 0; shift < 32; shift += 8) {
              h ^= (n >>> shift) & 255;
              h = Math.imul(h, 0x01000193);
            }
          }
        }
      }
      this.hashes[section] = h;
      this.hashDirty[section] = 0;
    }
    return this.hashes[section];
  }

  hashes32(): number[] {
    return Array.from({ length: SECTION_COUNT }, (_, s) => this.sectionHash(s));
  }

  get full(): boolean {
    return this.edits.size >= MAX_EDITS;
  }
}
