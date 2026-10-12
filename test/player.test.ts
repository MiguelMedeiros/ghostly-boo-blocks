import { describe, expect, it } from "vitest";
import { AIR, BRICK, STONE } from "../src/blocks.ts";
import { Player } from "../src/player.ts";
import { raycast } from "../src/raycast.ts";
import { forward, project, multiply, perspective, view } from "../src/render/math.ts";
import type { BlockSource } from "../src/render/mesher.ts";
import { meshSection } from "../src/render/mesher.ts";
import { drawAtlas } from "../src/render/atlas.ts";
import { World } from "../src/world.ts";

/** A flat floor of stone at y = 9 (its top at y = 10), and a wall at x = 20. */
const flat: BlockSource = { get: (x, y) => (y < 10 || (x === 20 && y < 14) ? STONE : AIR) };
const idle = { forward: 0, strafe: 0, jump: false, down: false };

describe("the person", () => {
  it("falls to the ground and stands on it", () => {
    const p = new Player([10.5, 20, 10.5]);
    p.update(flat, idle, 2);
    expect(p.y).toBeCloseTo(10, 5);
    expect(p.onGround).toBe(true);
  });

  it("jumps a little over one block high", () => {
    const p = new Player([10.5, 10, 10.5]);
    p.update(flat, idle, 0.1);
    let top = p.y;
    p.update(flat, { ...idle, jump: true }, 0.02);
    for (let i = 0; i < 60; i++) {
      p.update(flat, idle, 0.02);
      top = Math.max(top, p.y);
    }
    expect(top - 10).toBeGreaterThan(1.1);
    expect(top - 10).toBeLessThan(1.6);
  });

  it("walks forward (-z at yaw 0) and stops at a wall", () => {
    const p = new Player([10.5, 10, 10.5]);
    p.update(flat, { ...idle, forward: 1 }, 1);
    expect(p.z).toBeLessThan(8);
    expect(p.x).toBeCloseTo(10.5, 3);
    p.yaw = -Math.PI / 2;
    p.update(flat, { ...idle, forward: 1 }, 5);
    expect(p.x).toBeLessThan(20 - 0.3 + 1e-3);
    expect(p.x).toBeGreaterThan(19.5);
  });

  it("flies up and down when flying", () => {
    const p = new Player([10.5, 10, 10.5]);
    p.flying = true;
    p.update(flat, { ...idle, jump: true }, 1);
    expect(p.y).toBeGreaterThan(15);
    p.update(flat, { ...idle, down: true }, 5);
    expect(p.y).toBeCloseTo(10, 3);
  });

  it("rises out of a block placed on it", () => {
    const world = new World();
    const p = new Player([10.5, 30, 10.5]);
    world.edit(10, 30, 10, BRICK);
    world.edit(10, 31, 10, BRICK);
    p.unstick(world);
    expect(p.y).toBe(32);
  });
});

describe("pointing", () => {
  it("hits the first block along the ray, with the cell before it", () => {
    const hit = raycast(flat, [10.5, 11.6, 10.5], forward(0, -Math.PI / 2 + 0.01))!;
    expect(hit.cell).toEqual([10, 9, 10]);
    expect(hit.before).toEqual([10, 10, 10]);
    const wall = raycast(flat, [15.5, 11.5, 10.5], [1, 0, 0])!;
    expect(wall.cell).toEqual([20, 11, 10]);
    expect(wall.before).toEqual([19, 11, 10]);
    expect(raycast(flat, [15.5, 11.5, 10.5], [-1, 0, 0])).toBeNull();
  });

  it("projects what is ahead to the middle of the screen", () => {
    const vp = multiply(perspective(1.2, 1.5, 0.1, 100), view([0, 0, 0], 0, 0));
    const [x, y] = project(vp, [0, 0, -5], 300, 200)!;
    expect(x).toBeCloseTo(150, 3);
    expect(y).toBeCloseTo(100, 3);
    expect(project(vp, [0, 0, 5], 300, 200)).toBeNull();
  });
});

describe("drawing", () => {
  it("draws the same atlas every time", () => {
    expect(drawAtlas()).toEqual(drawAtlas());
  });

  it("meshes only the faces that show", () => {
    const one: BlockSource = { get: (x, y, z) => (x === 1 && y === 1 && z === 1 ? STONE : AIR) };
    const mesh = meshSection(one, 0);
    expect(mesh.solid.indices.length).toBe(6 * 6);
    const two: BlockSource = { get: (x, y, z) => ((x === 1 || x === 2) && y === 1 && z === 1 ? STONE : AIR) };
    expect(meshSection(two, 0).solid.indices.length).toBe(10 * 6);
  });
});
