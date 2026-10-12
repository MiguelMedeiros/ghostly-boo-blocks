/**
 * Edits as text, for storage and for frames: fixed-size binary records in base64url (JSON carries strings, and a
 * record costs 4/3 of its bytes this way, against about 3 times as JSON arrays).
 *
 * - A section's edits on the wire: 7 bytes each, the cell's index in its section (2 bytes), the block (1), the clock (4).
 * - A storage page: 8 bytes each, the cell's index in the world (3 bytes), the block (1), the clock (4).
 *
 * Big-endian throughout. Decoding refuses anything malformed with null: what a contact sends is untrusted.
 */
import { CELLS } from "./terrain.ts";
import { blockOf, clockOf, MAX_CLOCK, stampOf } from "./world.ts";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

export function toBase64url(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += ALPHABET[n >> 18] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += ALPHABET[n >> 18] + ALPHABET[(n >> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += ALPHABET[n >> 18] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63];
  }
  return out;
}

/** The bytes, or null when the text is not base64url without padding. */
export function fromBase64url(text: string): Uint8Array | null {
  if (text.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    let n = 0;
    const take = Math.min(4, text.length - i);
    for (let j = 0; j < 4; j++) {
      const c = j < take ? text.charCodeAt(i + j) : 65;
      const v = c < 128 ? LOOKUP[c] : -1;
      if (v < 0) return null;
      n = (n << 6) | (j < take ? v : 0);
    }
    out[o++] = (n >> 16) & 255;
    if (take > 2) out[o++] = (n >> 8) & 255;
    if (take > 3) out[o++] = n & 255;
  }
  return out;
}

/** The most section records in one frame: 3000 x 7 bytes is 28000 characters, under the 32 KiB a frame carries. */
export const RECORDS_PER_FRAME = 3000;
/** The most records in one storage page: 5000 x 8 bytes is 53334 characters, under the 64 KiB a stored value may be. */
export const RECORDS_PER_PAGE = 5000;

/** A section's edits, as [index in the section, stamp] pairs. */
export function encodeSection(entries: [number, number][]): string {
  const bytes = new Uint8Array(entries.length * 7);
  const view = new DataView(bytes.buffer);
  entries.forEach(([local, stamp], i) => {
    view.setUint16(i * 7, local);
    view.setUint8(i * 7 + 2, blockOf(stamp));
    view.setUint32(i * 7 + 3, clockOf(stamp));
  });
  return toBase64url(bytes);
}

/** A section's edits back, or null when the text is malformed (a contact's). */
export function decodeSection(text: string): [number, number][] | null {
  const bytes = fromBase64url(text);
  if (!bytes || bytes.length % 7 !== 0 || bytes.length / 7 > RECORDS_PER_FRAME) return null;
  const view = new DataView(bytes.buffer);
  const out: [number, number][] = [];
  for (let i = 0; i < bytes.length; i += 7) {
    const local = view.getUint16(i);
    const clock = view.getUint32(i + 3);
    if (local >= 4096 || clock < 1 || clock > MAX_CLOCK) return null;
    out.push([local, stampOf(clock, view.getUint8(i + 2))]);
  }
  return out;
}

/** A storage page: [cell, stamp] pairs. */
export function encodePage(entries: [number, number][]): string {
  const bytes = new Uint8Array(entries.length * 8);
  const view = new DataView(bytes.buffer);
  entries.forEach(([cell, stamp], i) => {
    view.setUint8(i * 8, cell >>> 16);
    view.setUint16(i * 8 + 1, cell & 0xffff);
    view.setUint8(i * 8 + 3, blockOf(stamp));
    view.setUint32(i * 8 + 4, clockOf(stamp));
  });
  return toBase64url(bytes);
}

export function decodePage(text: string): [number, number][] | null {
  const bytes = fromBase64url(text);
  if (!bytes || bytes.length % 8 !== 0) return null;
  const view = new DataView(bytes.buffer);
  const out: [number, number][] = [];
  for (let i = 0; i < bytes.length; i += 8) {
    const cell = (view.getUint8(i) << 16) | view.getUint16(i + 1);
    const clock = view.getUint32(i + 4);
    if (cell >= CELLS || clock < 1) return null;
    out.push([cell, stampOf(clock, view.getUint8(i + 3))]);
  }
  return out;
}
