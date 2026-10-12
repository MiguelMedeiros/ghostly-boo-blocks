import { describe, expect, it } from "vitest";
import { BRICK, GLASS } from "../src/blocks.ts";
import { Limiter } from "../src/limiter.ts";
import { META_KEY, WorldStore } from "../src/store.ts";
import { RECORDS_PER_PAGE } from "../src/codec.ts";
import { cellIndex } from "../src/terrain.ts";
import { stampOf, World } from "../src/world.ts";
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
