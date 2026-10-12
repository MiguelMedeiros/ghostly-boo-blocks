/** Small helpers for the tests that run two sides. */
import { Core, type CoreHooks } from "../src/core.ts";
import type { MockBroker } from "./mockBroker.ts";

/** Waits until `check` is true, or fails after `ms`. */
export async function waitFor(check: () => boolean, ms = 5000, what = "the condition"): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Opens Blocks on a side: the person opens the app, the page starts. Fast ticks, so tests run quickly. */
export async function openSide(broker: MockBroker, hooks: CoreHooks = {}): Promise<Core> {
  broker.launch();
  const core = new Core(broker, hooks, { tickMs: 20, flushMs: 50 });
  await core.open();
  return core;
}

/** Closes a side as a reload would: what is pending is written, then the app goes. */
export async function closeSide(broker: MockBroker, core: Core): Promise<void> {
  await core.close();
  broker.shutdown();
}

/** The two worlds hold the same edits and the same blocks. */
export function converged(a: Core, b: Core): boolean {
  if (a.world.edits.size !== b.world.edits.size) return false;
  for (const [cell, stamp] of a.world.edits) if (b.world.edits.get(cell) !== stamp) return false;
  return a.world.cells.every((v, i) => v === b.world.cells[i]);
}
