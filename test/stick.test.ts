// src/stick.ts: a finger on the touch stick as walking controls.
import { describe, expect, it } from "vitest";
import { Player } from "../src/player.ts";
import type { BlockSource } from "../src/render/mesher.ts";
import { readStick } from "../src/stick.ts";
import { AIR, STONE } from "../src/blocks.ts";

const R = 60;

describe("the touch stick", () => {
  it("stands still near the centre", () => {
    expect(readStick(0, 0, R)).toMatchObject({ forward: 0, strafe: 0 });
    expect(readStick(5, -5, R)).toMatchObject({ forward: 0, strafe: 0 });
  });

  it("walks forward when pushed up, right when pushed right, at full speed on the rim", () => {
    const up = readStick(0, -R, R);
    expect(up.forward).toBeCloseTo(1);
    expect(up.strafe).toBeCloseTo(0);
    const right = readStick(R, 0, R);
    expect(right.strafe).toBeCloseTo(1);
    expect(right.forward).toBeCloseTo(0);
    const back = readStick(0, R * 3, R);
    expect(back.forward).toBeCloseTo(-1);
    expect(back.knob).toEqual([0, R]);
  });

  it("goes slower halfway, in any direction, never past full speed", () => {
    const half = readStick(0, -R / 2, R);
    expect(half.forward).toBeGreaterThan(0.3);
    expect(half.forward).toBeLessThan(0.5);
    const diagonal = readStick(R * 2, -R * 2, R);
    expect(Math.hypot(diagonal.forward, diagonal.strafe)).toBeCloseTo(1);
    expect(diagonal.forward).toBeCloseTo(diagonal.strafe);
    expect(Math.hypot(...diagonal.knob)).toBeCloseTo(R);
  });

  it("moves the person slower with the stick halfway than on the rim", () => {
    const flat: BlockSource = { get: (_x, y) => (y < 10 ? STONE : AIR) };
    const walk = (forward: number) => {
      const p = new Player([64.5, 10, 64.5]);
      p.update(flat, { forward, strafe: 0, jump: false, down: false }, 1);
      return Math.hypot(p.x - 64.5, p.z - 64.5);
    };
    const full = walk(readStick(0, -R, R).forward);
    const half = walk(readStick(0, -R / 2, R).forward);
    expect(full).toBeGreaterThan(3);
    expect(half).toBeGreaterThan(0.5);
    expect(half).toBeLessThan(full * 0.6);
  });
});
