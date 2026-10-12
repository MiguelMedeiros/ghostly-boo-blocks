import { describe, expect, it } from "vitest";
import { AIR, BRICK, GLASS, STONE } from "../src/blocks.ts";
import { cellIndex, SIZE_X, SIZE_Y, SIZE_Z } from "../src/terrain.ts";
import { cellOfLocal, localOf, MAX_EDITS, newerWorld, sectionOf, SECTION_COUNT, stampOf, World } from "../src/world.ts";

describe("world", () => {
  it("maps cells to sections and back", () => {
    for (const [x, y, z] of [[0, 0, 0], [15, 15, 15], [16, 0, 0], [127, 63, 127], [33, 47, 90]]) {
      const cell = cellIndex(x, y, z);
      expect(cellOfLocal(sectionOf(cell), localOf(cell))).toBe(cell);
    }
    expect(sectionOf(cellIndex(SIZE_X - 1, SIZE_Y - 1, SIZE_Z - 1))).toBe(SECTION_COUNT - 1);
  });

  it("keeps the higher stamp of a cell whatever the order, the higher block on equal clocks", () => {
    const cell = cellIndex(10, 30, 10);
    const stamps = [stampOf(3, BRICK), stampOf(5, GLASS), stampOf(5, STONE), stampOf(4, AIR)];
    const results = new Set<number>();
    for (const order of [[0, 1, 2, 3], [3, 2, 1, 0], [2, 0, 3, 1], [1, 3, 0, 2]]) {
      const world = new World();
      for (const i of order) world.apply(cell, stamps[i]);
      for (const i of order) world.apply(cell, stamps[i]);
      results.add(world.edits.get(cell)!);
      expect(world.cells[cell]).toBe(GLASS > STONE ? GLASS : STONE);
      expect(world.clock).toBe(5);
    }
    expect(results.size).toBe(1);
  });

  it("stamps a local edit above every clock seen, and ignores one that changes nothing", () => {
    const world = new World();
    world.apply(cellIndex(1, 40, 1), stampOf(41, BRICK));
    const done = world.edit(2, 40, 2, GLASS)!;
    expect(done.stamp).toBe(stampOf(42, GLASS));
    expect(world.edit(2, 40, 2, GLASS)).toBeNull();
    expect(world.edit(-1, 40, 2, GLASS)).toBeNull();
  });

  it("hashes a section by its edits only, the same whatever order they came in", () => {
    const a = new World();
    const b = new World();
    expect(a.hashes32().every((h) => h === 0)).toBe(true);
    const edits: [number, number][] = [[cellIndex(1, 40, 1), stampOf(1, BRICK)], [cellIndex(2, 40, 1), stampOf(2, GLASS)], [cellIndex(3, 41, 1), stampOf(3, AIR)]];
    for (const [c, s] of edits) a.apply(c, s);
    for (const [c, s] of [...edits].reverse()) b.apply(c, s);
    expect(a.hashes32()).toEqual(b.hashes32());
    expect(a.sectionHash(sectionOf(edits[0][0]))).not.toBe(0);
    b.apply(edits[0][0], stampOf(9, STONE));
    expect(a.sectionHash(sectionOf(edits[0][0]))).not.toBe(b.sectionHash(sectionOf(edits[0][0])));
  });

  it("takes no new cell past MAX_EDITS, but still changes cells it has", () => {
    const world = new World();
    for (let cell = 0; cell < MAX_EDITS; cell++) world.edits.set(cell, stampOf(1, STONE));
    expect(world.full).toBe(true);
    expect(world.apply(MAX_EDITS + 5, stampOf(2, BRICK))).toBe("full");
    expect(world.apply(5, stampOf(2, BRICK))).toBe(true);
  });

  it("picks the same world from two on both sides", () => {
    const a = { generator: 1, seed: 7, epoch: 2 };
    const b = { generator: 1, seed: 9, epoch: 1 };
    const c = { generator: 1, seed: 3, epoch: 2 };
    expect(newerWorld(a, b)).toBe(a);
    expect(newerWorld(b, a)).toBe(a);
    expect(newerWorld(a, c)).toBe(a);
    expect(newerWorld(c, a)).toBe(a);
  });
});
