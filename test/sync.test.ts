import { afterEach, describe, expect, it } from "vitest";
import { BRICK, GLASS, PLANKS, STONE } from "../src/blocks.ts";
import type { Core } from "../src/core.ts";
import { cellIndex } from "../src/terrain.ts";
import { MockBroker, pairBrokers } from "./mockBroker.ts";
import { closeSide, converged, openSide, waitFor } from "./helpers.ts";

const open: [MockBroker, Core][] = [];
async function side(broker: MockBroker): Promise<Core> {
  const core = await openSide(broker);
  open.push([broker, core]);
  return core;
}
afterEach(async () => {
  for (const [broker, core] of open.splice(0)) if (broker.isOpen) await closeSide(broker, core);
});

describe("building together", () => {
  it("shows each side's edits to the other live, and the contact's name and position", async () => {
    const [a, b] = pairBrokers();
    a.displayName = "Ana";
    const ana = await side(a);
    const bob = await side(b);
    await waitFor(() => bob.session.contact?.name === "Ana", 2000, "Ana's name");
    expect(ana.place(60, 40, 60, BRICK)).toBe(true);
    expect(bob.place(61, 40, 60, GLASS)).toBe(true);
    ana.session.move([60.5, 41, 60.5, 1, 0]);
    await waitFor(() => converged(ana, bob), 2000, "both worlds to match");
    expect(bob.world.get(60, 40, 60)).toBe(BRICK);
    expect(ana.world.get(61, 40, 60)).toBe(GLASS);
    await waitFor(() => bob.session.contact?.pose?.[3] === 1, 2000, "Ana's pose");
    expect(a.overLimit + b.overLimit).toBe(0);
  });

  it("converges when both change the same block at the same moment", async () => {
    const [a, b] = pairBrokers();
    a.latency = b.latency = 30;
    const ana = await side(a);
    const bob = await side(b);
    await waitFor(() => ana.session.state === "here" && bob.session.state === "here");
    for (let i = 0; i < 20; i++) {
      ana.place(50 + i, 45, 50, BRICK);
      bob.place(50 + i, 45, 50, i % 2 ? GLASS : STONE);
    }
    await waitFor(() => converged(ana, bob), 3000, "both worlds to match");
    expect(ana.world.get(50, 45, 50)).toBe(bob.world.get(50, 45, 50));
  });

  it("gives a contact who opens later what was built alone, and merges what both built apart", async () => {
    const [a, b] = pairBrokers();
    let ana = await side(a);
    for (let i = 0; i < 30; i++) ana.place(10 + i, 50, 10, PLANKS);
    await closeSide(a, ana);
    let bob = await side(b);
    for (let i = 0; i < 30; i++) bob.place(10 + i, 51, 12, BRICK);
    // The same cell, built by both while apart: Bob's later clock wins on both sides.
    bob.place(10, 50, 10, GLASS);
    await closeSide(b, bob);
    ana = await side(a);
    bob = await side(b);
    await waitFor(() => converged(ana, bob), 3000, "both worlds to match");
    expect(ana.world.get(39, 51, 12)).toBe(BRICK);
    expect(bob.world.get(39, 50, 10)).toBe(PLANKS);
    expect(ana.world.get(10, 50, 10)).toBe(bob.world.get(10, 50, 10));
  });

  it("finds the same world again after a reload", async () => {
    const [a, b] = pairBrokers();
    let ana = await side(a);
    const bob = await side(b);
    ana.place(64, 50, 64, BRICK);
    bob.place(65, 50, 64, GLASS);
    await waitFor(() => converged(ana, bob), 2000);
    await closeSide(a, ana);
    ana = await side(a);
    expect(ana.world.get(64, 50, 64)).toBe(BRICK);
    expect(ana.world.get(65, 50, 64)).toBe(GLASS);
    await waitFor(() => converged(ana, bob), 2000);
  });

  it("catches up thousands of edits under the broker's rate, in frames under 32 KiB", async () => {
    const [a, b] = pairBrokers();
    const ana = await side(a);
    let n = 0;
    for (let x = 0; x < 128 && n < 12_000; x++) for (let z = 0; z < 128 && n < 12_000; z += 1) if (ana.place(x, 58 + (x % 3), z, STONE)) n++;
    await ana.store.flush();
    const bob = await side(b);
    await waitFor(() => converged(ana, bob), 15_000, "Bob to have every edit");
    expect(bob.world.edits.size).toBe(12_000);
    expect(a.overLimit + b.overLimit).toBe(0);
  }, 30_000);

  it("takes the contact's new world, and drops the edits of the old one", async () => {
    const [a, b] = pairBrokers();
    const ana = await side(a);
    const bob = await side(b);
    bob.place(64, 50, 64, BRICK);
    await waitFor(() => converged(ana, bob), 2000);
    await ana.newWorld(4242);
    await waitFor(() => bob.world.id.seed === 4242 && converged(ana, bob), 3000, "Bob to take the new world");
    expect(bob.world.edits.size).toBe(0);
    expect(bob.world.id.epoch).toBe(1);
    ana.place(10, 55, 10, GLASS);
    await waitFor(() => bob.world.get(10, 55, 10) === GLASS, 2000);
    // Bob reloads and finds the new world, not the old.
    await closeSide(b, bob);
    const again = await side(b);
    expect(again.world.id.seed).toBe(4242);
    expect(again.world.get(10, 55, 10)).toBe(GLASS);
  });

  it("drops a hostile contact's frames and keeps working", async () => {
    const [a, b] = pairBrokers();
    const ana = await side(a);
    const bob = await side(b);
    await waitFor(() => ana.session.state === "here");
    const before = ana.world.edits.size;
    for (const frame of [{ t: "tick", w: [1, 1, 1] }, { t: "sec", w: [1, 27404, 0], k: 1, e: "%%%" }, { t: "hello" }, "x", null, { t: "tick", w: [1, 27404, 0], p: [0, 0, 0, 0, 99] }]) a.inject(frame);
    await a.settled();
    expect(ana.world.edits.size).toBe(before);
    expect(ana.session.counts.dropped).toBe(5);
    bob.place(3, 50, 3, BRICK);
    await waitFor(() => ana.world.get(3, 50, 3) === BRICK, 2000);
  });

  it("plays alone, out of a chat, and keeps the world", async () => {
    const solo = new MockBroker("ana", "0.1.0", false);
    let core = await side(solo);
    expect(core.session.state).toBe("alone");
    core.place(20, 50, 20, BRICK);
    await closeSide(solo, core);
    core = await side(solo);
    expect(core.world.get(20, 50, 20)).toBe(BRICK);
    expect(solo.sent.length).toBe(0);
  });

  it("loses no edit when a frame is lost: the next open catches up", async () => {
    const [a, b] = pairBrokers();
    const ana = await side(a);
    let bob = await side(b);
    // Both hellos are in: nothing more would carry the edit but its tick.
    await waitFor(() => ana.session.counts.received > 0 && bob.session.counts.received > 0);
    await new Promise((r) => setTimeout(r, 50));
    a.drop = () => true;
    ana.place(30, 50, 30, BRICK);
    await new Promise((r) => setTimeout(r, 100));
    expect(bob.world.get(30, 50, 30)).not.toBe(BRICK);
    a.drop = () => false;
    await closeSide(b, bob);
    bob = await side(b);
    await waitFor(() => bob.world.get(30, 50, 30) === BRICK, 2000);
    expect(cellIndex(30, 50, 30)).toBeGreaterThan(0);
  });
});
