// @vitest-environment happy-dom
/**
 * E aimed at the cell where the contact stands: no block goes into them, and the person hears who is in the way.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { en } from "../src/strings.ts";
import { HINT_GAP_MS } from "../src/ui.ts";
import { openSide, waitFor } from "./helpers.ts";
import { MockBroker, pairBrokers } from "./mockBroker.ts";
import { defaultWorld, openPage, press, storeWorld, topSolid } from "./page.ts";

vi.mock(import("../src/render/renderer.ts"), async (original) => ({
  ...(await original()),
  Renderer: class {
    viewProjection = new Float32Array(16);
    viewProjectionFor(): Float32Array {
      return this.viewProjection;
    }
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

describe("E with the contact in the way", () => {
  afterAll(() => vi.restoreAllMocks());

  it("says the contact is in the way, by name", async () => {
    const top = topSolid(defaultWorld(), X, Z);
    expect(top).toBeGreaterThan(0);
    const [a, b] = pairBrokers(new MockBroker("ana", "1.0.1"), new MockBroker("bob", "1.0.1"));
    b.displayName = "Bob";
    storeWorld(a, []);
    storeWorld(b, []);
    // Flying four blocks over the ground, looking straight down at it.
    a.stored.set("me", JSON.stringify([X + 0.5, top + 4, Z + 0.5, 0, -1.55, 1]));
    const { host, toast } = await openPage(a);
    const bob = await openSide(b);
    await waitFor(() => host.dataset.peer === "here", 5000, "Bob to be here");
    // Bob stands on the block Ana looks at, where E would put the new one.
    bob.session.move([X + 0.5, top + 1, Z + 0.5, 0, 0]);
    await waitFor(() => toast.textContent === en.contactCame("Bob"), 5000, "Bob's arrival");
    await waitFor(() => toast.textContent === "", 5000, "the arrival notice to go");

    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    now += HINT_GAP_MS;
    press("KeyE");
    expect(toast.textContent, "a word after E placed nothing").toBe(en.noRoomContact("Bob"));
    await bob.close();
    b.shutdown();
  }, 30_000);
});
