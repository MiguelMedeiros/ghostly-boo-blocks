/**
 * The frames Boo Blocks sends to the same app on the contact's side (`apps/1` data frames, WISP 1200), and the checks on
 * what arrives: everything from the contact is untrusted, and a frame that fails a check is dropped whole.
 *
 *   hello  {t: "hello", p: 1, v, n?, w: [generator, seed, epoch], h: [256 section hashes], a?: 1}
 *          Sent when both sides have the app open (and again whenever the contact opens it again). Says which world
 *          this side has and a hash of each section's edits. `a: 1` asks the contact to answer with its own hello
 *          (sent after a frame found no room in the channel, to find what did not go).
 *   sec    {t: "sec", w, k: section, e: records}
 *          One section's edits (or part of them), sent for each section whose hash differs from the contact's.
 *   tick   {t: "tick", w, p?: [x, y, z, yaw, pitch], e?: records}
 *          Up to ten a second: where this side's person is, and the edits made since the last tick.
 *
 * See docs/protocol.md. Unknown keys are ignored, so a later version can add some; a later version that changes the
 * meaning of a frame raises `p`.
 */
import type { MiniAppJson } from "./vendor/miniApp.ts";
import { decodePage, decodeSection, RECORDS_PER_FRAME } from "./codec.ts";
import { SECTION_COUNT, type WorldId } from "./world.ts";
import { SIZE_X, SIZE_Y, SIZE_Z } from "./terrain.ts";

export const PROTOCOL = 1;
/** A name as shown over the contact's head: at most this many characters. */
export const NAME_CHARS = 32;

export type WorldTag = [number, number, number];
export type Pose = [number, number, number, number, number];

export interface Hello {
  t: "hello";
  p: number;
  v: string;
  n?: string;
  w: WorldTag;
  h: number[];
}
export interface SectionFrame {
  t: "sec";
  w: WorldTag;
  k: number;
  e: string;
}
export interface Tick {
  t: "tick";
  w: WorldTag;
  p?: Pose;
  e?: string;
}

export const tagOf = (id: WorldId): WorldTag => [id.generator, id.seed, id.epoch];
export const idOf = (tag: WorldTag): WorldId => ({ generator: tag[0], seed: tag[1], epoch: tag[2] });

/** What arrived, checked: a hello, a section's edits (as [index in section, stamp]), or a tick (edits as [cell, stamp]). */
export type Incoming =
  | { t: "hello"; protocol: number; version: string; name?: string; world: WorldId; hashes: number[]; ask?: boolean }
  | { t: "sec"; world: WorldId; section: number; edits: [number, number][] }
  | { t: "tick"; world: WorldId; pose?: Pose; edits: [number, number][] };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isUint32 = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffffff;

function worldOf(v: unknown): WorldId | null {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(isUint32)) return null;
  return idOf(v as WorldTag);
}

/** A name as sent by a contact: control and formatting characters out, spaces folded, cut to NAME_CHARS. */
export function cleanName(name: unknown): string | undefined {
  if (typeof name !== "string") return undefined;
  const clean = [...name.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "").replace(/\s+/g, " ").trim()].slice(0, NAME_CHARS).join("").trim();
  return clean || undefined;
}

function poseOf(v: unknown): Pose | null {
  if (!Array.isArray(v) || v.length !== 5 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const [x, y, z, yaw, pitch] = v as Pose;
  const margin = 4;
  if (x < -margin || z < -margin || x > SIZE_X + margin || z > SIZE_Z + margin || y < -margin || y > SIZE_Y + 32) return null;
  if (Math.abs(yaw) > 1000 || Math.abs(pitch) > 2) return null;
  return [x, y, z, yaw, pitch];
}

/** A frame from the contact, checked; null for anything malformed. */
export function parseFrame(data: MiniAppJson): Incoming | null {
  if (!isObject(data)) return null;
  if (data.t === "hello") {
    const world = worldOf(data.w);
    if (!Number.isInteger(data.p) || (data.p as number) < 1 || typeof data.v !== "string" || data.v.length > 64 || !world) return null;
    if (!Array.isArray(data.h) || data.h.length !== SECTION_COUNT || !data.h.every((n) => Number.isInteger(n) && (n as number) >= -0x80000000 && (n as number) <= 0x7fffffff)) return null;
    const name = cleanName(data.n);
    return { t: "hello", protocol: data.p as number, version: data.v, ...(name ? { name } : {}), world, hashes: data.h as number[], ...(data.a === 1 ? { ask: true } : {}) };
  }
  if (data.t === "sec") {
    const world = worldOf(data.w);
    if (!world || !Number.isInteger(data.k) || (data.k as number) < 0 || (data.k as number) >= SECTION_COUNT || typeof data.e !== "string") return null;
    const edits = decodeSection(data.e);
    return edits ? { t: "sec", world, section: data.k as number, edits } : null;
  }
  if (data.t === "tick") {
    const world = worldOf(data.w);
    if (!world) return null;
    let pose: Pose | undefined;
    if (data.p !== undefined) {
      const p = poseOf(data.p);
      if (!p) return null;
      pose = p;
    }
    let edits: [number, number][] = [];
    if (data.e !== undefined) {
      if (typeof data.e !== "string") return null;
      const decoded = decodePage(data.e);
      if (!decoded || decoded.length > RECORDS_PER_FRAME) return null;
      edits = decoded;
    }
    return { t: "tick", world, ...(pose ? { pose } : {}), edits };
  }
  return null;
}
