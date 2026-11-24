// @vitest-environment happy-dom
/**
 * Q and E at the bottom of a shaft, looking down at the bedrock: Q can't break it and E would put a block where the
 * person stands. Both say so, since nothing happened and no sound came.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { BEDROCK } from "../src/blocks.ts";
import { en } from "../src/strings.ts";
import { HINT_GAP_MS } from "../src/ui.ts";
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

describe("Q and E at the bedrock, standing in the way", () => {
  afterAll(() => vi.restoreAllMocks());

  it("say the block can't be broken, and that there is no room where the person stands", async () => {
    expect(defaultWorld().get(X, 0, Z)).toBe(BEDROCK);
    const broker = new MockBroker("ana", "1.0.1", false);
    storeWorld(broker, shaft(X, Z));
    // On the bedrock at the bottom of the shaft, looking straight down.
    broker.stored.set("me", JSON.stringify([X + 0.5, 1, Z + 0.5, 0, -1.55, 0]));
    const { toast } = await openPage(broker);

    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    press("KeyQ");
    expect(toast.textContent, "a word after Q broke nothing").toBe(en.cannotBreak);
    now += HINT_GAP_MS;
    press("KeyE");
    expect(toast.textContent, "a word after E placed nothing").toBe(en.noRoomYou);
  }, 30_000);
});
