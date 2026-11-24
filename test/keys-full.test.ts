// @vitest-environment happy-dom
/**
 * Q in a full world (MAX_EDITS changes kept): breaking a block nobody changed yet would be one change more, so nothing
 * happens, and the person is told the world is full, as a notice.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { AIR, BLOCKS } from "../src/blocks.ts";
import { en } from "../src/strings.ts";
import { cellIndex, SIZE_X, SIZE_Y, SIZE_Z } from "../src/terrain.ts";
import { MAX_EDITS, stampOf } from "../src/world.ts";
import { MockBroker } from "./mockBroker.ts";
import { defaultWorld, openPage, press, shaft, storeWorld } from "./page.ts";

vi.mock(import("../src/render/renderer.ts"), async (original) => ({
  ...(await original()),
  Renderer: class {
    viewProjection = new Float32Array(16);
    markAll(): void {}
    markCell(): void {}
    rebuild(): number {
      return 0;
    }
    draw(): void {}
  } as never,
}));

const X = 64;
const Z = 64;

describe("Q in a full world", () => {
  afterAll(() => vi.restoreAllMocks());

  it("says the world is full", async () => {
    const ground = defaultWorld();
    // The shaft's walls at eye height are ground nobody changed, and can be broken.
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const block = BLOCKS[ground.get(X + dx, 2, Z + dz)];
      expect(block?.solid && !block.fixed).toBe(true);
    }
    // The shaft, then air written over the sky from the top layer down until the world holds MAX_EDITS changes.
    const edits = shaft(X, Z);
    const taken = new Set(edits.map(([cell]) => cell));
    for (let y = SIZE_Y - 1; y > 2 && edits.length < MAX_EDITS; y--) {
      for (let z = 0; z < SIZE_Z && edits.length < MAX_EDITS; z++) {
        for (let x = 0; x < SIZE_X && edits.length < MAX_EDITS; x++) {
          const cell = cellIndex(x, y, z);
          if (!taken.has(cell)) edits.push([cell, stampOf(1, AIR)]);
        }
      }
    }
    expect(edits.length).toBe(MAX_EDITS);
    const broker = new MockBroker("ana", "1.0.1", false);
    broker.storageBytes = 64 * 1024 * 1024;
    storeWorld(broker, edits);
    // At the bottom of the shaft, looking level at its wall.
    broker.stored.set("me", JSON.stringify([X + 0.5, 1, Z + 0.5, 0, 0, 0]));
    const { toast } = await openPage(broker);

    press("KeyQ");
    expect(toast.textContent, "a word after Q broke nothing in a full world").toBe(en.worldFull);
  }, 60_000);
});
