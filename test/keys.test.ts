// @vitest-environment happy-dom
/**
 * Q and E on the whole page (src/main.ts), with a stand-in for the WebGL renderer: a key that breaks or places nothing
 * says why in the status region, since the sounds were the only answer and they only come when something happened.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { en } from "../src/strings.ts";
import { SIZE_X, SIZE_Y, SIZE_Z } from "../src/terrain.ts";
import { HINT_GAP_MS } from "../src/ui.ts";
import { waitFor } from "./helpers.ts";
import { MockBroker } from "./mockBroker.ts";

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

const press = (code: string) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
  window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
};

describe("Q and E with nothing in reach", () => {
  afterAll(() => vi.restoreAllMocks());

  it("say so, once in a while, instead of nothing at all", async () => {
    document.body.innerHTML = `<main id="app"></main>`;
    const broker = new MockBroker("ana", "1.0.1", false);
    // High over the world, flying, looking straight up: nothing in reach at the centre of the screen.
    broker.stored.set("me", JSON.stringify([SIZE_X / 2, SIZE_Y + 10, SIZE_Z / 2, 0, 1.55, 1]));
    broker.launch();
    (window as { ghostly?: unknown }).ghostly = broker;
    await import("../src/main.ts");
    const host = document.getElementById("app")!;
    await waitFor(() => host.dataset.state === "ready", 20_000, "the page to be ready");
    const toast = host.querySelector<HTMLElement>(".toast")!;

    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    press("KeyQ");
    expect(toast.textContent, "a word after Q broke nothing").not.toBe("");
    expect(toast.textContent).toBe(en.nothingToBreak);
    press("KeyE");
    expect(toast.textContent).toBe(en.nothingToBreak);
    now += HINT_GAP_MS;
    press("KeyE");
    expect(toast.textContent).toBe(en.nothingToPlace);
  }, 30_000);
});
