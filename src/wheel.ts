/**
 * The wheel over the world picks the block: how many hotbar slots one wheel event moves.
 *
 * A mouse notch is one event of about 100 px (Chromium, WebKit) or 3 lines (Firefox), but a trackpad swipe is dozens
 * of events of a few pixels, and a Mac mouse notch can be only a few pixels too (macOS accelerates it). So the pixels
 * are summed and a slot goes by per STEP_PX, at most one per event, and the first event after a pause always moves
 * one slot at once: a notch, however small, answers, and a swipe moves a few slots, not one per event.
 *
 * The axis is the vertical one, or the sideways one when there is none: Shift + wheel arrives sideways in Chromium
 * and on macOS (deltaY 0, deltaX with the sign the vertical delta had), and Shift is also "fly down", so turning the
 * wheel while flying down picks the next block as without Shift. An event with no delta moves nothing.
 */

/** The fields of a WheelEvent the stepper reads. */
export interface WheelDelta {
  deltaX: number;
  deltaY: number;
  /** 0 pixels, 1 lines, 2 pages (WheelEvent.DOM_DELTA_*). */
  deltaMode: number;
}

export interface WheelStepperOptions {
  /** Milliseconds, any monotonic clock (performance.now). */
  now: () => number;
  /** A page's height in pixels, for deltaMode 2; 800 when absent or not positive. */
  pageHeight?: () => number;
}

/** Pixels the wheel goes for one slot. */
export const STEP_PX = 50;
/** A line, for deltaMode 1 (Firefox on Windows and Linux sends 3 per notch). */
export const LINE_PX = 40;
/** A page, for deltaMode 2, when the page's height is unknown. */
export const PAGE_PX = 800;
/** A gap this long or longer between two events starts a new turn of the wheel: its first event moves one slot. */
export const PAUSE_MS = 200;

/** Returns a function that takes one wheel event and answers the slots to move: -1, 0 or 1. */
export function createWheelStepper(options: WheelStepperOptions): (e: WheelDelta) => number {
  let sum = 0;
  let last = -Infinity;
  return (e) => {
    // deltaMode first: Firefox switches an event to pixels (deltaMode 0) when a delta is read before it, and its
    // 3-line notch then comes to about 48 px, under a slot, so the second notch of a quick turn would move nothing.
    const mode = e.deltaMode;
    const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
    if (!Number.isFinite(delta) || delta === 0) return 0;
    const page = options.pageHeight?.() ?? 0;
    const px = delta * (mode === 1 ? LINE_PX : mode === 2 ? (page > 0 ? page : PAGE_PX) : 1);
    const at = options.now();
    const paused = at - last >= PAUSE_MS;
    last = at;
    const direction = Math.sign(px);
    if (paused) {
      sum = 0;
      return direction;
    }
    // Turned the other way: what was summed the other way goes.
    if (Math.sign(sum) === -direction) sum = 0;
    sum += px;
    if (Math.abs(sum) < STEP_PX) return 0;
    // One slot at most per event; a remainder under a slot is kept, anything more is dropped.
    sum = direction * (Math.abs(sum) % STEP_PX);
    return direction;
  };
}
