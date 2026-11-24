import { describe, expect, it } from "vitest";
import { createWheelStepper, type WheelDelta } from "../src/wheel.ts";

/** A stepper on a hand-turned clock, and a helper that feeds it events at given times and sums the slots moved. */
function wheel(pageHeight?: number) {
  let now = 1000;
  const step = createWheelStepper({ now: () => now, pageHeight: pageHeight === undefined ? undefined : () => pageHeight });
  return {
    /** Waits `ms` on the clock, then sends the event; answers the slots it moved. */
    send(e: Partial<WheelDelta>, ms = 0): number {
      now += ms;
      return step({ deltaX: 0, deltaY: 0, deltaMode: 0, ...e });
    },
    /** `count` events `every` ms apart (the first after `pause` ms); answers the slots moved in all. */
    burst(e: Partial<WheelDelta>, count: number, every: number, pause = 1000): number {
      let total = 0;
      for (let i = 0; i < count; i++) total += this.send(e, i === 0 ? pause : every);
      return total;
    },
  };
}

describe("wheel stepper", () => {
  it("moves one slot for a mouse notch of 100 px, and one per notch when turned on", () => {
    const w = wheel();
    expect(w.send({ deltaY: 100 }, 1000)).toBe(1);
    expect(w.send({ deltaY: -100 }, 1000)).toBe(-1);
    // A wheel turned on fast: a slot a notch, never two.
    expect(w.burst({ deltaY: 100 }, 5, 40)).toBe(5);
  });

  it("moves a trackpad swipe of 20 events of 4 px in 80 ms by 1 or 2 slots, not 20", () => {
    const moved = wheel().burst({ deltaY: 4 }, 20, 4);
    expect(moved).toBeGreaterThanOrEqual(1);
    expect(moved).toBeLessThanOrEqual(2);
  });

  it("moves a sideways event (deltaX 60, deltaY 0) forward one slot, not back", () => {
    const w = wheel();
    expect(w.send({ deltaX: 60 }, 1000)).toBe(1);
    expect(w.send({ deltaX: -60 }, 1000)).toBe(-1);
    // Both axes: the vertical one counts.
    expect(w.send({ deltaX: -60, deltaY: 30 }, 1000)).toBe(1);
  });

  it("moves nothing for an event with no delta", () => {
    const w = wheel();
    expect(w.send({}, 1000)).toBe(0);
    expect(w.send({ deltaMode: 1 }, 1000)).toBe(0);
    expect(w.send({ deltaY: Number.NaN }, 1000)).toBe(0);
  });

  it("moves one slot for a 3 px notch after a 300 ms pause, at once", () => {
    const w = wheel();
    expect(w.send({ deltaY: 3 }, 300)).toBe(1);
    expect(w.send({ deltaY: 3 }, 300)).toBe(1);
    expect(w.send({ deltaY: -3 }, 300)).toBe(-1);
    // But 3 px right after one (a trackpad's next step) waits for more.
    expect(w.send({ deltaY: 3 }, 10)).toBe(0);
  });

  it("counts lines as 40 px and pages as the page's height: one slot per event at most", () => {
    const w = wheel();
    // Firefox on Windows and Linux: 3 lines a notch.
    expect(w.send({ deltaY: 3, deltaMode: 1 }, 1000)).toBe(1);
    expect(w.burst({ deltaY: 3, deltaMode: 1 }, 4, 50)).toBe(4);
    // One line is 40 px, under a slot: the second one within the turn makes it.
    expect(w.send({ deltaY: 1, deltaMode: 1 }, 1000)).toBe(1);
    expect(w.send({ deltaY: 1, deltaMode: 1 }, 20)).toBe(0);
    expect(w.send({ deltaY: 1, deltaMode: 1 }, 20)).toBe(1);
    // A page: one slot, however tall the page is.
    expect(wheel(600).burst({ deltaY: 1, deltaMode: 2 }, 3, 50)).toBe(3);
    expect(wheel().burst({ deltaY: -1, deltaMode: 2 }, 3, 50)).toBe(-3);
  });

  it("reads deltaMode before the delta, so Firefox gives its notch in lines, not in pixels under a slot", () => {
    // Firefox's WheelEvent: a notch is 3 lines, but reading deltaX or deltaY before deltaMode switches the event to
    // pixels (deltaMode 0) at the font's line height, about 48 px for 3 lines of 16 px: under a slot.
    const firefoxNotch = (): WheelDelta => {
      let modeRead = false;
      let pixels = false;
      const delta = (lines: number) => {
        if (!modeRead) pixels = true;
        return pixels ? lines * 16 : lines;
      };
      return {
        get deltaMode() {
          modeRead = true;
          return pixels ? 0 : 1;
        },
        get deltaY() {
          return delta(3);
        },
        get deltaX() {
          return delta(0);
        },
      };
    };
    let now = 1000;
    const step = createWheelStepper({ now: () => now });
    // Four notches of a quick turn, 50 ms apart: a slot each, as on Chromium's 100 px notches.
    let moved = 0;
    for (let i = 0; i < 4; i++) {
      now += i === 0 ? 1000 : 50;
      moved += step(firefoxNotch());
    }
    expect(moved).toBe(4);
  });

  it("starts the sum again when the wheel turns the other way", () => {
    const w = wheel();
    expect(w.send({ deltaY: 4 }, 1000)).toBe(1);
    expect(w.send({ deltaY: 40 }, 10)).toBe(0); // 40 px summed forward
    // Back: the 40 forward don't take 30 back to -10, nor do they count against the next 30 back.
    expect(w.send({ deltaY: -30 }, 10)).toBe(0);
    expect(w.send({ deltaY: -30 }, 10)).toBe(-1);
    // Forward again: the 10 px left over back are dropped, so 45 forward is still under a slot.
    expect(w.send({ deltaY: 45 }, 10)).toBe(0);
    expect(w.send({ deltaY: 5 }, 10)).toBe(1);
  });

  it("starts a new turn after a pause of 200 ms, not before", () => {
    const w = wheel();
    expect(w.send({ deltaY: 4 }, 1000)).toBe(1);
    expect(w.send({ deltaY: 4 }, 199)).toBe(0);
    expect(w.send({ deltaY: 4 }, 200)).toBe(1);
    // An event with no delta is not counted as a turn: 250 ms after the last real one is still a pause.
    expect(w.send({}, 150)).toBe(0);
    expect(w.send({ deltaY: 4 }, 100)).toBe(1);
  });
});
