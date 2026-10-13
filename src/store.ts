/**
 * The world in the app's storage, which the client keeps per app and per chat (or for the app opened alone), up to
 * 5 MiB. Kept:
 *
 *   world   {v: 1, w: [generator, seed, epoch]}
 *   p0, p1… the edits, in pages of up to RECORDS_PER_PAGE records (src/codec.ts), each under the 64 KiB a value may be
 *
 * A cell stays in the page it was first written to, so an edit rewrites one page. Pages are written at most once a
 * second (and when the page is hidden), through the limiter, after chat frames.
 */
import type { MiniAppApi, MiniAppJson } from "./vendor/miniApp.ts";
import { miniAppErrorCode } from "./vendor/miniApp.ts";
import { decodePage, encodePage, RECORDS_PER_PAGE } from "./codec.ts";
import type { Limiter } from "./limiter.ts";
import { GENERATOR } from "./terrain.ts";
import { DEFAULT_WORLD, type World, type WorldId } from "./world.ts";

export const META_KEY = "world";
const PAGE = /^p(0|[1-9]\d{0,5})$/;
export const pageKey = (n: number): string => `p${n}`;

/** What load found. */
export type Loaded = "empty" | "loaded" | "newer";

export class WorldStore {
  /** The cells of each page. */
  private pages: Set<number>[] = [];
  private readonly pageOf = new Map<number, number>();
  private readonly dirty = new Set<number>();
  private metaDirty = false;
  private generation = 0;
  private flushing: Promise<void> | null = null;
  /** The last write was refused for room (`full`): the person is told, and nothing more is lost than what did not fit. */
  storageFull = false;
  /** A write failed for another reason. */
  failed = false;

  constructor(
    private readonly api: MiniAppApi,
    private readonly limiter: Limiter,
    private readonly world: World,
  ) {}

  private call<T>(make: () => Promise<T>): Promise<T> {
    return this.limiter.run(make);
  }

  /** Reads the world from storage into `world`. "newer" when a later Boo Blocks made it (a generator this one lacks). */
  async load(): Promise<Loaded> {
    const meta = await this.call(() => this.api.storage.get(META_KEY));
    const id = readMeta(meta);
    if (!id) return "empty";
    if (id.generator > GENERATOR) return "newer";
    this.world.reset(id);
    const keys = await this.call(() => this.api.storage.keys());
    const numbers = keys.filter((k) => PAGE.test(k)).map((k) => Number(k.slice(1))).sort((a, b) => a - b);
    for (const n of numbers) {
      const text = await this.call(() => this.api.storage.get(pageKey(n)));
      const entries = typeof text === "string" ? decodePage(text) : null;
      const cells = new Set<number>();
      this.pages[n] = cells;
      if (!entries) continue;
      for (const [cell, stamp] of entries) {
        if (this.pageOf.has(cell)) continue;
        cells.add(cell);
        this.pageOf.set(cell, n);
        this.world.apply(cell, stamp);
      }
    }
    for (let n = 0; n < this.pages.length; n++) this.pages[n] ??= new Set();
    return "loaded";
  }

  /** A cell's stamp changed: its page is written at the next flush. */
  track(cell: number): void {
    let page = this.pageOf.get(cell);
    if (page === undefined) {
      page = this.pages.findIndex((cells) => cells.size < RECORDS_PER_PAGE);
      if (page < 0) {
        page = this.pages.length;
        this.pages.push(new Set());
      }
      this.pages[page].add(cell);
      this.pageOf.set(cell, page);
    }
    this.dirty.add(page);
  }

  /** The world was started again (here or by the contact): the old pages go, the new world's id is written. */
  async reset(id: WorldId): Promise<void> {
    const old = this.pages.length;
    this.generation++;
    this.pages = [];
    this.pageOf.clear();
    this.dirty.clear();
    this.metaDirty = false;
    this.storageFull = false;
    await this.call(() => this.api.storage.set(META_KEY, metaOf(id)));
    for (let n = 0; n < old; n++) await this.call(() => this.api.storage.delete(pageKey(n)));
  }

  get pending(): boolean {
    return this.dirty.size > 0 || this.metaDirty;
  }

  /** Writes what changed. One flush at a time; a call during one waits for it and then writes what is left. */
  async flush(): Promise<void> {
    while (this.flushing) await this.flushing;
    if (!this.pending) return;
    this.flushing = this.write().finally(() => (this.flushing = null));
    await this.flushing;
  }

  private async write(): Promise<void> {
    const generation = this.generation;
    const pages = [...this.dirty];
    this.dirty.clear();
    const writes: [string, MiniAppJson][] = [];
    if (this.metaDirty || pages.length) {
      this.metaDirty = false;
      writes.push([META_KEY, metaOf(this.world.id)]);
    }
    for (const n of pages) {
      const entries = [...this.pages[n]].sort((a, b) => a - b).map((cell): [number, number] => [cell, this.world.edits.get(cell)!]);
      writes.push([pageKey(n), encodePage(entries)]);
    }
    for (const [key, value] of writes) {
      if (generation !== this.generation) return;
      try {
        await this.call(() => this.api.storage.set(key, value));
        if (key !== META_KEY) this.storageFull = false;
      } catch (error) {
        if (key !== META_KEY) this.dirty.add(Number(key.slice(1)));
        if (miniAppErrorCode(error) === "full") this.storageFull = true;
        else this.failed = true;
      }
    }
  }
}

function metaOf(id: WorldId): MiniAppJson {
  return { v: 1, w: [id.generator, id.seed, id.epoch] };
}

function readMeta(value: MiniAppJson | undefined): WorldId | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const w = value.w;
  if (!Array.isArray(w) || w.length !== 3 || !w.every((n) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 0xffffffff)) return null;
  const [generator, seed, epoch] = w as number[];
  return generator >= 1 ? { generator, seed, epoch } : { ...DEFAULT_WORLD };
}
