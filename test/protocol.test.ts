import { describe, expect, it } from "vitest";
import { encodePage, encodeSection } from "../src/codec.ts";
import { cleanName, parseFrame } from "../src/protocol.ts";
import { SECTION_COUNT, stampOf } from "../src/world.ts";

const w = [1, 27404, 0];
const h = Array(SECTION_COUNT).fill(0);

describe("protocol", () => {
  it("reads the three frames", () => {
    expect(parseFrame({ t: "hello", p: 1, v: "0.1.0", n: "Ana", w, h })).toEqual({ t: "hello", protocol: 1, version: "0.1.0", name: "Ana", world: { generator: 1, seed: 27404, epoch: 0 }, hashes: h });
    expect(parseFrame({ t: "sec", w, k: 3, e: encodeSection([[5, stampOf(2, 9)]]) })).toMatchObject({ t: "sec", section: 3, edits: [[5, stampOf(2, 9)]] });
    expect(parseFrame({ t: "tick", w, p: [1, 2, 3, 0.5, -0.2], e: encodePage([[70, stampOf(4, 1)]]) })).toMatchObject({ t: "tick", pose: [1, 2, 3, 0.5, -0.2], edits: [[70, stampOf(4, 1)]] });
    expect(parseFrame({ t: "tick", w, extra: true })).toMatchObject({ t: "tick", edits: [] });
  });

  it("drops what a hostile or broken contact might send", () => {
    const bad: unknown[] = [
      null, 5, "hello", [], { t: "nope" },
      { t: "hello", p: 1, v: "0.1.0", w, h: h.slice(1) },
      { t: "hello", p: 0, v: "0.1.0", w, h },
      { t: "hello", p: 1, v: "x".repeat(65), w, h },
      { t: "hello", p: 1, v: "0.1.0", w: [1, -1, 0], h },
      { t: "hello", p: 1, v: "0.1.0", w, h: [...h.slice(1), 1.5] },
      { t: "sec", w, k: SECTION_COUNT, e: "" },
      { t: "sec", w, k: 0, e: "!!!!" },
      { t: "sec", w, k: 0, e: 7 },
      { t: "tick", w, p: [1, 2, 3, 4] },
      { t: "tick", w, p: [1, 2, 3, 4, Number.NaN] },
      { t: "tick", w, p: [1e9, 2, 3, 0, 0] },
      { t: "tick", w, e: "abc" },
      { t: "tick", w: [1, 2] },
    ];
    for (const frame of bad) expect(parseFrame(frame as never)).toBeNull();
  });

  it("cleans a contact's name", () => {
    expect(cleanName("  Ana‮ \n Maria\u0000 ")).toBe("Ana Maria");
    expect(cleanName("x".repeat(40))).toBe("x".repeat(32));
    expect(cleanName("​")).toBeUndefined();
    expect(cleanName(42)).toBeUndefined();
  });
});
