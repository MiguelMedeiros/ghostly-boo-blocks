import { describe, expect, it } from "vitest";
import { decodePage, decodeSection, encodePage, encodeSection, fromBase64url, RECORDS_PER_FRAME, RECORDS_PER_PAGE, toBase64url } from "../src/codec.ts";
import { MINI_APP_LIMITS } from "../src/vendor/miniApp.ts";
import { CELLS } from "../src/terrain.ts";
import { stampOf } from "../src/world.ts";

const utf8 = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

describe("codec", () => {
  it("round-trips base64url of every length", () => {
    for (let n = 0; n < 40; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 255);
      const text = toBase64url(bytes);
      expect(text).toBe(Buffer.from(bytes).toString("base64url"));
      expect(fromBase64url(text)).toEqual(bytes);
    }
    expect(fromBase64url("a")).toBeNull();
    expect(fromBase64url("ab=c")).toBeNull();
    expect(fromBase64url("abé0")).toBeNull();
  });

  it("round-trips a section's edits, and a full frame's worth fits a frame", () => {
    const entries: [number, number][] = Array.from({ length: RECORDS_PER_FRAME }, (_, i) => [i, stampOf(0xfffffff0 - i, i % 256)]);
    const text = encodeSection(entries);
    expect(decodeSection(text)).toEqual(entries);
    expect(utf8({ t: "sec", w: [1, 0xffffffff, 0xffffffff], k: 255, e: text })).toBeLessThanOrEqual(MINI_APP_LIMITS.chatDataBytes);
  });

  it("round-trips a storage page, and a full page fits a stored value", () => {
    const entries: [number, number][] = Array.from({ length: RECORDS_PER_PAGE }, (_, i) => [CELLS - 1 - i * 17, stampOf(i + 1, (i * 7) % 256)]);
    const text = encodePage(entries);
    expect(decodePage(text)).toEqual(entries);
    expect(utf8(text)).toBeLessThanOrEqual(MINI_APP_LIMITS.storageValueBytes);
  });

  it("refuses malformed records", () => {
    expect(decodeSection(toBase64url(new Uint8Array(6)))).toBeNull();
    // Clock 0 is never a stamp; index 4096 is outside a section.
    expect(decodeSection(toBase64url(new Uint8Array(7)))).toBeNull();
    expect(decodeSection(toBase64url(Uint8Array.of(0x10, 0, 1, 0, 0, 0, 1)))).toBeNull();
    expect(decodeSection(encodeSection(Array.from({ length: RECORDS_PER_FRAME + 1 }, (_, i) => [i % 4096, stampOf(1, 1)])))).toBeNull();
    expect(decodePage(toBase64url(Uint8Array.of(0xff, 0xff, 0xff, 1, 0, 0, 0, 1)))).toBeNull();
  });
});
