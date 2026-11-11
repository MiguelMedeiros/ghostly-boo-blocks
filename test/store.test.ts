import { describe, expect, it } from "vitest";
import { BRICK, GLASS } from "../src/blocks.ts";
import { Limiter } from "../src/limiter.ts";
import { META_KEY, WorldStore } from "../src/store.ts";
import { encodePage, RECORDS_PER_PAGE } from "../src/codec.ts";
import { cellIndex } from "../src/terrain.ts";
import { stampOf, World } from "../src/world.ts";
import { waitFor } from "./helpers.ts";
import { MockBroker } from "./mockBroker.ts";

function fresh(broker: MockBroker) {
  const world = new World();
  const store = new WorldStore(broker, new Limiter(), world);
  world.onEdit = (cell) => store.track(cell);
  return { world, store };
}

describe("storage", () => {
  it("keeps the edits and the world's id, and reads them back", async () => {
    const broker = new MockBroker("ana", "0.1.0", false);
    const a = fresh(broker);
    expect(await a.store.load()).toBe("empty");
    a.world.edit(5, 40, 5, BRICK);
    a.world.edit(6, 40, 5, GLASS);
    await a.store.flush();
    expect(JSON.parse(broker.stored.get(META_KEY)!)).toEqual({ v: 1, w: [1, a.world.id.seed, 0] });
    const b = fresh(broker);
    expect(await b.store.load()).toBe("loaded");
    expect(b.world.edits).toEqual(a.world.edits);
    expect(b.world.get(5, 40, 5)).toBe(BRICK);
    expect(b.world.clock).toBe(2);
  });

  it("splits many edits over pages under the value limit, rewriting only the page an edit is in", async () => {
    const broker = new MockBroker("ana", "0.1.0", false);
    const a = fresh(broker);
    await a.store.load();
    const n = RECORDS_PER_PAGE * 2 + 10;
    for (let i = 0; i < n; i++) a.world.apply(i, stampOf(i + 1, BRICK));
    await a.store.flush();
    expect([...broker.stored.keys()].sort()).toEqual(["p0", "p1", "p2", META_KEY]);
    const before = broker.requests;
    a.world.apply(3, stampOf(n + 5, GLASS));
    await a.store.flush();
    expect(broker.requests - before).toBe(2);
    const b = fresh(broker);
    await b.store.load();
    expect(b.world.edits.size).toBe(n);
    expect(b.world.edits.get(3)).toBe(stampOf(n + 5, GLASS));
    expect(broker.overLimit).toBe(0);
  }, 20_000);

  it("says when storage is full, and writes the page once there is room", async () => {
    const broker = new MockBroker("ana", "0.1.0", false);
    const a = fresh(broker);
    await a.store.load();
    broker.storageBytes = 400;
    for (let i = 0; i < 100; i++) a.world.apply(cellIndex(i, 40, 0), stampOf(i + 1, BRICK));
    await a.store.flush();
    expect(a.store.storageFull).toBe(true);
    expect(a.store.pending).toBe(true);
    broker.storageBytes = 5 * 1024 * 1024;
    await a.store.flush();
    expect(a.store.storageFull).toBe(false);
    expect(broker.stored.has("p0")).toBe(true);
  });

  it("drops the old pages when the world starts again", async () => {
    const broker = new MockBroker("ana", "0.1.0", false);
    const a = fresh(broker);
    await a.store.load();
    a.world.edit(5, 40, 5, BRICK);
    await a.store.flush();
    const id = { generator: 1, seed: 99, epoch: 1 };
    a.world.reset(id);
    await a.store.reset(id);
    expect([...broker.stored.keys()]).toEqual([META_KEY]);
    const b = fresh(broker);
    await b.store.load();
    expect(b.world.id).toEqual(id);
    expect(b.world.edits.size).toBe(0);
  });

  it("leaves a world made by a later generator alone", async () => {
    const broker = new MockBroker("ana", "0.1.0", false);
    broker.stored.set(META_KEY, JSON.stringify({ v: 2, w: [7, 1, 1] }));
    expect(await fresh(broker).store.load()).toBe("newer");
  });
});

/** A world of 12 000 edits in three pages, stored by a closed session. */
const OLD_EDITS = RECORDS_PER_PAGE * 2 + 2000;
async function storedWorld(broker: MockBroker) {
  const a = fresh(broker);
  await a.store.load();
  for (let i = 0; i < OLD_EDITS; i++) a.world.apply(i, stampOf(i + 1, BRICK));
  await a.store.flush();
  expect(pageKeys(broker)).toEqual(["p0", "p1", "p2"]);
  return a;
}
const NEW = { generator: 1, seed: 4242, epoch: 1 };
const pageKeys = (broker: MockBroker) => [...broker.stored.keys()].filter((k) => /^p\d+$/.test(k)).sort();
const meta = (broker: MockBroker) => JSON.parse(broker.stored.get(META_KEY)!);

/** What the next open finds: the storage as the closed page left it. */
function reopened(broker: MockBroker): MockBroker {
  const next = new MockBroker("ana", "0.1.0", false);
  for (const [key, value] of broker.stored) next.stored.set(key, value);
  return next;
}

describe("New world and storage", () => {
  it("a reload at any step of New world finds the new world without the old edits, and finishes dropping them", async () => {
    let finished = false;
    for (let step = 0; !finished; step++) {
      expect(step, "New world takes a handful of writes").toBeLessThan(12);
      const broker = new MockBroker("ana", "0.1.0", false);
      const a = await storedWorld(broker);
      let writes = 0;
      // The page goes after `step` storage writes: the next one is never made.
      broker.hang = () => ++writes > step;
      a.world.reset(NEW);
      void a.store.reset(NEW).then(() => (finished = true));
      await waitFor(() => finished || writes > step, 5000, `New world to reach write ${step + 1}`);
      const next = reopened(broker);
      const b = fresh(next);
      expect(await b.store.load()).toBe("loaded");
      if (step === 0) {
        // Closed before anything was written: the old world, whole.
        expect(b.world.id).not.toEqual(NEW);
        expect(b.world.edits.size).toBe(OLD_EDITS);
        continue;
      }
      expect(b.world.id, `closed after ${step} writes`).toEqual(NEW);
      expect(b.world.edits.size, `old edits read as the new world's, closed after ${step} writes`).toBe(0);
      expect(pageKeys(next), `old pages left, closed after ${step} writes`).toEqual([]);
      expect(meta(next)).toEqual({ v: 1, w: [1, 4242, 1] });
      expect(next.overLimit).toBe(0);
    }
  }, 30_000);

  it("keeps the new world's edits made while the old pages go, written once they are gone", async () => {
    const broker = new MockBroker("ana", "0.1.0", false);
    const a = await storedWorld(broker);
    a.world.reset(NEW);
    const reset = a.store.reset(NEW);
    a.world.edit(5, 40, 5, GLASS);
    a.world.edit(6, 40, 5, BRICK);
    await Promise.all([reset, a.store.flush()]);
    await a.store.flush();
    const b = fresh(reopened(broker));
    await b.store.load();
    expect(b.world.id).toEqual(NEW);
    expect(b.world.edits).toEqual(a.world.edits);
    expect(b.world.get(5, 40, 5)).toBe(GLASS);
    expect(pageKeys(broker)).toEqual(["p0"]);
  });

  it("a delete that fails does not stop New world: the rest is dropped at the next write or the next open", async () => {
    const broker = new MockBroker("ana", "0.1.0", false);
    const a = await storedWorld(broker);
    broker.fail = (op, key) => (op === "delete" && key === "p1" ? "failed" : null);
    a.world.reset(NEW);
    await a.store.reset(NEW);
    expect(a.store.failed).toBe(true);
    expect(pageKeys(broker)).toEqual(["p1"]);
    // Opened again now: the new world, none of the old page's edits, and the page goes.
    const next = reopened(broker);
    const b = fresh(next);
    await b.store.load();
    expect(b.world.id).toEqual(NEW);
    expect(b.world.edits.size).toBe(0);
    expect(pageKeys(next)).toEqual([]);
    expect(meta(next)).toEqual({ v: 1, w: [1, 4242, 1] });
    // Still open: the next flush drops it, then writes the new world's edits.
    broker.fail = () => null;
    a.world.edit(5, 40, 5, GLASS);
    await a.store.flush();
    expect(pageKeys(broker)).toEqual(["p0"]);
    expect(meta(broker)).toEqual({ v: 1, w: [1, 4242, 1] });
    const c = fresh(reopened(broker));
    await c.store.load();
    expect(c.world.edits).toEqual(a.world.edits);
  });

  it("a second New world before the first finished drops the first world's pages too", async () => {
    const broker = new MockBroker("ana", "0.1.0", false);
    const a = await storedWorld(broker);
    a.world.reset(NEW);
    const first = a.store.reset(NEW);
    const again = { generator: 1, seed: 5, epoch: 2 };
    a.world.reset(again);
    await Promise.all([first, a.store.reset(again)]);
    expect(pageKeys(broker)).toEqual([]);
    expect(meta(broker)).toEqual({ v: 1, w: [1, 5, 2] });
  });

  it("makes room for the mark when storage is full, deleting an old page first", async () => {
    const broker = new MockBroker("ana", "0.1.0", false);
    const a = await storedWorld(broker);
    broker.storageBytes = broker.usedBytes();
    a.world.reset(NEW);
    await a.store.reset(NEW);
    expect(a.store.storageFull).toBe(false);
    expect(a.store.failed).toBe(false);
    expect(pageKeys(broker)).toEqual([]);
    expect(meta(broker)).toEqual({ v: 1, w: [1, 4242, 1] });
  });

  it("reads a store written by Boo Blocks 1.0.1 as it was, and writes nothing", async () => {
    const broker = new MockBroker("ana", "0.1.0", false);
    const p0: [number, number][] = [[cellIndex(5, 40, 5), stampOf(1, BRICK)], [cellIndex(6, 40, 5), stampOf(2, GLASS)]];
    const p1: [number, number][] = [[cellIndex(7, 40, 5), stampOf(3, BRICK)]];
    broker.stored.set(META_KEY, JSON.stringify({ v: 1, w: [1, 77, 2] }));
    broker.stored.set("p0", JSON.stringify(encodePage(p0)));
    broker.stored.set("p1", JSON.stringify(encodePage(p1)));
    const before = new Map(broker.stored);
    const writes: string[] = [];
    broker.hang = (op, key) => (writes.push(`${op} ${key}`), false);
    const a = fresh(broker);
    expect(await a.store.load()).toBe("loaded");
    expect(a.world.id).toEqual({ generator: 1, seed: 77, epoch: 2 });
    expect(new Map(a.world.edits)).toEqual(new Map([...p0, ...p1]));
    expect(writes).toEqual([]);
    expect(broker.stored).toEqual(before);
  });
});
