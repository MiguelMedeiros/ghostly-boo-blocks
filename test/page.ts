/**
 * Helpers for the tests that run the whole page (src/main.ts) in happy-dom, with the renderer stood in for (each such
 * test file mocks src/render/renderer.ts itself, since vi.mock is hoisted per file).
 */
import { AIR, BLOCKS } from "../src/blocks.ts";
import { encodePage, RECORDS_PER_PAGE } from "../src/codec.ts";
import { META_KEY, pageKey } from "../src/store.ts";
import { cellIndex, SIZE_Y } from "../src/terrain.ts";
import { DEFAULT_WORLD, stampOf, World } from "../src/world.ts";
import { waitFor } from "./helpers.ts";
import type { MockBroker } from "./mockBroker.ts";

/** A key pressed and let go on the page. */
export const press = (code: string): void => {
  window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
  window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
};

/** The default world's ground, as the page builds it from storage. */
export function defaultWorld(): World {
  const world = new World();
  world.reset(DEFAULT_WORLD);
  return world;
}

/** The y of the column's highest solid block, or -1. */
export function topSolid(world: World, x: number, z: number): number {
  for (let y = SIZE_Y - 1; y >= 0; y--) if (BLOCKS[world.get(x, y, z)]?.solid) return y;
  return -1;
}

/** A 1 by 1 shaft of air from the sky down to the bedrock at (x, z): its edits, as storage keeps them. */
export function shaft(x: number, z: number): [number, number][] {
  const edits: [number, number][] = [];
  for (let y = 1; y < SIZE_Y; y++) edits.push([cellIndex(x, y, z), stampOf(1, AIR)]);
  return edits;
}

/** Puts the default world and these edits in the broker's storage, in pages as the page writes them. */
export function storeWorld(broker: MockBroker, edits: [number, number][]): void {
  broker.stored.set(META_KEY, JSON.stringify({ v: 1, w: [DEFAULT_WORLD.generator, DEFAULT_WORLD.seed, DEFAULT_WORLD.epoch] }));
  const sorted = [...edits].sort((a, b) => a[0] - b[0]);
  for (let n = 0; n * RECORDS_PER_PAGE < sorted.length; n++) {
    broker.stored.set(pageKey(n), JSON.stringify(encodePage(sorted.slice(n * RECORDS_PER_PAGE, (n + 1) * RECORDS_PER_PAGE))));
  }
}

/** Starts the page on `broker` and waits until it is ready; answers the page's root and its status line. */
export async function openPage(broker: MockBroker): Promise<{ host: HTMLElement; toast: HTMLElement }> {
  document.body.innerHTML = `<main id="app"></main>`;
  broker.launch();
  (window as { ghostly?: unknown }).ghostly = broker;
  await import("../src/main.ts");
  const host = document.getElementById("app")!;
  await waitFor(() => host.dataset.state === "ready", 20_000, "the page to be ready");
  return { host, toast: host.querySelector<HTMLElement>(".toast")! };
}
