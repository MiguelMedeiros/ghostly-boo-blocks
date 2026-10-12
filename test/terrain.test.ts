import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AIR, BEDROCK, BLOCKS, WATER } from "../src/blocks.ts";
import { CELLS, DEFAULT_SEED, SEA_LEVEL, SIZE_X, SIZE_Y, SIZE_Z, cellIndex, generate, hash3, heightAt, spawnPoint } from "../src/terrain.ts";

describe("terrain", () => {
  it("makes the same ground for a seed, pinned: a change here changes every world already built on", () => {
    const cells = generate(DEFAULT_SEED);
    expect(cells.length).toBe(CELLS);
    // Pinned: if this changes, the generator changed, and GENERATOR must be raised with the old one kept.
    expect(createHash("sha256").update(cells).digest("base64url")).toMatchInlineSnapshot(`"WYCNp-p4FNqEJj8KQXow9vOH3YdHLUxtAX5w86s2-Ko"`);
    expect(generate(DEFAULT_SEED)).toEqual(cells);
  });

  it("hashes integers with integer math only", () => {
    expect(hash3(1, 2, 3, 4)).toBe(hash3(1, 2, 3, 4));
    expect(hash3(1, 2, 3, 4)).not.toBe(hash3(1, 2, 3, 5));
    expect(Number.isInteger(hash3(-5, -6, 7, 8))).toBe(true);
  });

  it("has a bedrock floor, ground under the sea level filled with water, and only known blocks", () => {
    const cells = generate(12345);
    for (let z = 0; z < SIZE_Z; z += 7) {
      for (let x = 0; x < SIZE_X; x += 7) {
        expect(cells[cellIndex(x, 0, z)]).toBe(BEDROCK);
        const h = heightAt(12345, x, z);
        expect(h).toBeGreaterThanOrEqual(3);
        expect(h).toBeLessThan(SIZE_Y - 8);
        for (let y = h + 1; y <= SEA_LEVEL; y++) expect(cells[cellIndex(x, y, z)]).toBe(WATER);
      }
    }
    for (const id of new Set(cells)) expect(id === AIR || BLOCKS[id] !== undefined).toBe(true);
  });

  it("starts a person in the middle, standing on something", () => {
    const cells = generate(DEFAULT_SEED);
    const [x, y, z] = spawnPoint(cells);
    expect(x).toBe(SIZE_X / 2 + 0.5);
    expect(cells[cellIndex(Math.floor(x), y - 1, Math.floor(z))]).not.toBe(AIR);
    expect(cells[cellIndex(Math.floor(x), y, Math.floor(z))]).toBe(AIR);
  });

  it("differs from one seed to another", () => {
    expect(generate(1)).not.toEqual(generate(2));
  });
});
