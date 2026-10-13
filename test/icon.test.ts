// The icon: drawn by scripts/icon.mjs, committed as assets/icon.png, and within WISP 1200's bounds for `icon.png`
// (a PNG whose header says it is square and at most 1024 pixels a side, at most 256 KiB).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GRID, ICON, iconPng, SCALE } from "../scripts/icon.mjs";

describe("the icon", () => {
  it("is the script's drawing, byte for byte (run npm run gen:icon after changing it)", () => {
    expect(readFileSync(ICON).equals(iconPng())).toBe(true);
  });

  it("is a square PNG within the bounds a client takes", () => {
    const png = readFileSync(ICON);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.toString("ascii", 12, 16)).toBe("IHDR");
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    expect(width).toBe(height);
    expect(width).toBe(GRID * SCALE);
    expect(width).toBeLessThanOrEqual(1024);
    expect(png.length).toBeLessThanOrEqual(256 * 1024);
  });
});
