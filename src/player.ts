/**
 * The person: a box 0.6 wide and 1.8 tall that walks, jumps, swims and flies, and stops at solid blocks one axis at
 * a time. The world's edges are walls; below the world is solid.
 */
import { isSolid, WATER } from "./blocks.ts";
import type { BlockSource } from "./render/mesher.ts";
import { SIZE_X, SIZE_Y, SIZE_Z } from "./terrain.ts";

export const HALF_WIDTH = 0.3;
export const HEIGHT = 1.8;
export const EYE = 1.62;
const GRAVITY = 28;
const JUMP = 8.6;
const WALK = 4.4;
const FLY = 10;
const SWIM = 2.4;

export interface Controls {
  /** -1 to 1: back to forward. */
  forward: number;
  /** -1 to 1: left to right. */
  strafe: number;
  jump: boolean;
  /** Down, when flying. */
  down: boolean;
}

export class Player {
  x: number;
  y: number;
  z: number;
  vx = 0;
  vy = 0;
  vz = 0;
  yaw = 0;
  pitch = -0.2;
  flying = false;
  onGround = false;
  /** Feet in water. */
  inWater = false;
  /** Distance walked on the ground, for footsteps. */
  walked = 0;

  constructor(at: [number, number, number]) {
    [this.x, this.y, this.z] = at;
  }

  /** Whether the player's box overlaps a cell. */
  overlaps(cx: number, cy: number, cz: number): boolean {
    return cx + 1 > this.x - HALF_WIDTH && cx < this.x + HALF_WIDTH && cy + 1 > this.y && cy < this.y + HEIGHT && cz + 1 > this.z - HALF_WIDTH && cz < this.z + HALF_WIDTH;
  }

  private collides(world: BlockSource, x: number, y: number, z: number): boolean {
    for (let cy = Math.floor(y); cy <= Math.floor(y + HEIGHT - 1e-6); cy++) {
      for (let cz = Math.floor(z - HALF_WIDTH); cz <= Math.floor(z + HALF_WIDTH - 1e-6); cz++) {
        for (let cx = Math.floor(x - HALF_WIDTH); cx <= Math.floor(x + HALF_WIDTH - 1e-6); cx++) {
          if (cy >= SIZE_Y) continue;
          if (isSolid(world.get(cx, cy, cz))) return true;
        }
      }
    }
    return false;
  }

  /** One step of `dt` seconds. */
  update(world: BlockSource, controls: Controls, dt: number): void {
    for (let left = dt; left > 0; left -= 0.02) this.step(world, controls, Math.min(0.02, left));
  }

  private step(world: BlockSource, c: Controls, dt: number): void {
    this.inWater = world.get(Math.floor(this.x), Math.floor(this.y + 0.2), Math.floor(this.z)) === WATER;
    const speed = this.flying ? FLY : this.inWater ? WALK * 0.6 : WALK;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const length = Math.hypot(c.forward, c.strafe) || 1;
    const f = c.forward / Math.max(1, length);
    const s = c.strafe / Math.max(1, length);
    // Forward is -z at yaw 0 (src/render/math.ts).
    const wantX = (-sin * f + cos * s) * speed;
    const wantZ = (-cos * f - sin * s) * speed;
    const grip = this.onGround || this.flying ? 1 : this.inWater ? 0.5 : 0.25;
    const k = Math.min(1, dt * 12 * grip);
    this.vx += (wantX - this.vx) * k;
    this.vz += (wantZ - this.vz) * k;
    if (this.flying) {
      const wantY = (c.jump ? 1 : 0) * FLY - (c.down ? 1 : 0) * FLY;
      this.vy += (wantY - this.vy) * Math.min(1, dt * 12);
    } else if (this.inWater) {
      this.vy -= GRAVITY * 0.25 * dt;
      if (c.jump) this.vy = Math.min(this.vy + 30 * dt, SWIM);
      this.vy = Math.max(this.vy, -SWIM * 1.5);
    } else {
      this.vy -= GRAVITY * dt;
      if (c.jump && this.onGround) this.vy = JUMP;
      this.vy = Math.max(this.vy, -50);
    }
    const before = [this.x, this.z];
    this.move(world, 0, this.vx * dt);
    this.move(world, 2, this.vz * dt);
    this.onGround = false;
    this.move(world, 1, this.vy * dt);
    if (this.onGround) this.walked += Math.hypot(this.x - before[0], this.z - before[1]);
  }

  private move(world: BlockSource, axis: 0 | 1 | 2, amount: number): void {
    if (amount === 0) return;
    const pos = [this.x, this.y, this.z];
    pos[axis] += amount;
    if (axis === 0) pos[0] = Math.max(HALF_WIDTH, Math.min(SIZE_X - HALF_WIDTH, pos[0]));
    if (axis === 2) pos[2] = Math.max(HALF_WIDTH, Math.min(SIZE_Z - HALF_WIDTH, pos[2]));
    if (axis === 1) pos[1] = Math.min(SIZE_Y + 20, pos[1]);
    if (!this.collides(world, pos[0], pos[1], pos[2])) {
      [this.x, this.y, this.z] = pos;
      return;
    }
    // Move up to the face of the block in the way.
    if (axis === 1) {
      if (amount < 0) {
        this.y = Math.floor(this.y + amount) + 1;
        if (this.collides(world, this.x, this.y, this.z)) this.y = pos[1] - amount;
        this.onGround = true;
      } else {
        this.y = Math.min(this.y, Math.floor(this.y + amount + HEIGHT) - HEIGHT);
      }
      this.vy = 0;
    } else if (axis === 0) {
      this.x = amount > 0 ? Math.floor(this.x + amount + HALF_WIDTH) - HALF_WIDTH - 1e-4 : Math.floor(this.x + amount - HALF_WIDTH) + 1 + HALF_WIDTH + 1e-4;
      if (this.collides(world, this.x, this.y, this.z)) this.x = pos[0] - amount;
      this.vx = 0;
    } else {
      this.z = amount > 0 ? Math.floor(this.z + amount + HALF_WIDTH) - HALF_WIDTH - 1e-4 : Math.floor(this.z + amount - HALF_WIDTH) + 1 + HALF_WIDTH + 1e-4;
      if (this.collides(world, this.x, this.y, this.z)) this.z = pos[2] - amount;
      this.vz = 0;
    }
  }

  /** Stuck inside a block (one was placed on the person, or the world changed under them): rise to free space. */
  unstick(world: BlockSource): void {
    let tries = 0;
    while (this.collides(world, this.x, this.y, this.z) && tries++ < SIZE_Y + 4) this.y = Math.floor(this.y) + 1;
  }
}
