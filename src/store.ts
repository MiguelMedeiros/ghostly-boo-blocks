/**
 * The world in the app's storage, which the client keeps per app and per chat (or for the app opened alone), up to
 * 5 MiB. Kept:
 *
 *   world   {v: 1, w: [generator, seed, epoch], o?: [generator, seed, epoch]}
 *   p0, p1… the edits, in pages of up to RECORDS_PER_PAGE records (src/codec.ts), each under the 64 KiB a value may be
 *
 * A cell stays in the page it was first written to, so an edit rewrites one page. Pages are written at most once a
 * second (and when the page is hidden), through the limiter, after chat frames.
 *
 * The pages are `w`'s, unless `o` is there: then they are still the world `o` names, which a new world (here or the
 * contact's) replaced before all its pages were deleted. New world writes `w` with `o` in one write, deletes every
 * page, then writes `w` alone; no page of the new world is written while `o` is stored (its edits wait in memory).
 * The page can close at any of those steps: the next open finds `o`, reads no page and finishes the deletes. A delete
 * that fails is tried again at the next flush and the next open. Boo Blocks 1.0.1 never wrote `o`: its pages are `w`'s.
 */
import type { MiniAppApi, MiniAppJson } from "./vendor/miniApp.ts";
import { miniAppErrorCode } from "./vendor/miniApp.ts";
import { decodePage, encodePage, RECORDS_PER_PAGE } from "./codec.ts";
import type { Limiter } from "./limiter.ts";
import { GENERATOR } from "./terrain.ts";
import { DEFAULT_WORLD, sameWorld, type World, type WorldId } from "./world.ts";

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
  /** The world the store holds (the one in `w`). */
  private current: WorldId;
  /** The world the pages in storage still belong to while they are being deleted after a reset, else null. */
  private oldPages: WorldId | null = null;
  /** `o` naming `oldPages` is stored, with `current` as `w`. */
  private marked = false;
  /** The last write was refused for room (`full`): the person is told, and nothing more is lost than what did not fit. */
  storageFull = false;
  /** A write failed for another reason. */
  failed = false;

  constructor(
    private readonly api: MiniAppApi,
    private readonly limiter: Limiter,
    private readonly world: World,
  ) {
    this.current = world.id;
  }

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
    this.current = id;
    const old = readOld(meta, id);
    if (old) {
      // A new world was cut short: the pages are the old one's. None is read; they go before anything is written.
      this.oldPages = old;
      this.marked = true;
      await this.flush();
      return "loaded";
    }
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

  /**
   * The world was started again (here or by the contact): the new world's id is written, marked as not owning the
   * pages, the old pages go, then the mark. Never rejects: what is left is tried again at the next flush or open.
   */
  async reset(id: WorldId): Promise<void> {
    this.generation++;
    this.pages = [];
    this.pageOf.clear();
    this.dirty.clear();
    this.metaDirty = false;
    this.storageFull = false;
    // The stored pages stay the old world's (the first one, if a reset was itself cut short) until all are gone.
    this.oldPages ??= this.current;
    this.current = id;
    this.marked = false;
    await this.flush();
  }

  get pending(): boolean {
    return this.dirty.size > 0 || this.metaDirty || this.oldPages !== null;
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
    // No page of this world is written while another world's pages are stored: a close would mix them.
    if (this.oldPages && !(await this.dropOldPages(generation))) return;
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

  /**
   * Deletes the pages of `oldPages`: the mark first (`o` beside `w`, one write), then every page, then `w` alone.
   * True when all went. A failed call is noted (`failed`, `storageFull`) and the rest still tried; what is left is
   * tried at the next flush. False also when another reset came meanwhile (its flush takes over).
   */
  private async dropOldPages(generation: number): Promise<boolean> {
    const old = this.oldPages!;
    const id = this.current;
    const cut = () => generation !== this.generation;
    let keys: string[];
    try {
      keys = (await this.call(() => this.api.storage.keys())).filter((k) => PAGE.test(k));
    } catch {
      this.failed = true;
      return false;
    }
    keys.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    while (!this.marked) {
      if (cut()) return false;
      try {
        await this.call(() => this.api.storage.set(META_KEY, metaOf(id, old)));
        if (cut()) return false;
        this.marked = true;
      } catch (error) {
        const full = miniAppErrorCode(error) === "full";
        if (!full || !keys.length) {
          if (full) this.storageFull = true;
          else this.failed = true;
          return false;
        }
        // No room for the mark's few bytes: the last old page goes first. A close now leaves the old world short of
        // that page, never mixed with the new one.
        const key = keys.pop()!;
        try {
          await this.call(() => this.api.storage.delete(key));
        } catch {
          this.failed = true;
          return false;
        }
      }
    }
    let left = 0;
    for (const key of keys) {
      if (cut()) return false;
      try {
        await this.call(() => this.api.storage.delete(key));
      } catch {
        this.failed = true;
        left++;
      }
    }
    if (left || cut()) return false;
    try {
      await this.call(() => this.api.storage.set(META_KEY, metaOf(id)));
    } catch (error) {
      if (miniAppErrorCode(error) === "full") this.storageFull = true;
      else this.failed = true;
      return false;
    }
    if (cut()) return false;
    this.oldPages = null;
    this.marked = false;
    return true;
  }
}

function metaOf(id: WorldId, old: WorldId | null = null): MiniAppJson {
  const tag = (w: WorldId) => [w.generator, w.seed, w.epoch];
  return old ? { v: 1, w: tag(id), o: tag(old) } : { v: 1, w: tag(id) };
}

function readMeta(value: MiniAppJson | undefined): WorldId | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return readId(value.w);
}

/** The world whose pages are stored, when a reset to `id` did not finish (`o`); null when they are `id`'s. */
function readOld(value: MiniAppJson | undefined, id: WorldId): WorldId | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const old = readId(value.o);
  return old && !sameWorld(old, id) ? old : null;
}

function readId(w: MiniAppJson | undefined): WorldId | null {
  if (!Array.isArray(w) || w.length !== 3 || !w.every((n) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 0xffffffff)) return null;
  const [generator, seed, epoch] = w as number[];
  return generator >= 1 ? { generator, seed, epoch } : { ...DEFAULT_WORLD };
}
