/**
 * The touch stick's arithmetic: a finger's offset from the stick's centre, in pixels, as walking controls. Up is
 * forward; the farther from the centre, the faster, full speed at the rim; a small dead zone in the middle so a resting
 * thumb stands still.
 */

/** The share of the radius, from the centre, that does nothing. */
export const DEAD_ZONE = 0.15;

export interface StickReading {
  /** -1 to 1: back to forward. */
  forward: number;
  /** -1 to 1: left to right. */
  strafe: number;
  /** Where the knob is drawn, kept within the rim. */
  knob: [number, number];
}

export function readStick(dx: number, dy: number, radius: number): StickReading {
  const distance = Math.hypot(dx, dy);
  const inside = Math.min(1, radius / Math.max(distance, 1e-9));
  const knob: [number, number] = [dx * inside, dy * inside];
  const dead = radius * DEAD_ZONE;
  if (distance <= dead) return { forward: 0, strafe: 0, knob };
  const strength = Math.min(1, (distance - dead) / (radius - dead));
  return { forward: (-dy / distance) * strength, strafe: (dx / distance) * strength, knob };
}
