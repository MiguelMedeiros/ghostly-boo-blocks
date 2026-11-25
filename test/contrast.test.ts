/**
 * Text on a coloured button reads at WCAG AA (4.5:1) in both themes: Start a new world's white on red, and a touch
 * button switched on (Fly reads Walk, place mode shows ▣) on the accent.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

/** The custom properties of a block whose selector is exactly `selector`. */
function vars(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

/** The declarations of the rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const match = new RegExp(`(^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`).exec(css);
  expect(match, selector).not.toBeNull();
  return match![2];
}

function luminance(hex: string): number {
  expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe("Contrast of text on a coloured button", () => {
  const light = vars(":root");
  const dark = { ...light, ...vars(':root[data-theme="dark"]') };

  for (const [theme, v] of [["light", light], ["dark", dark]] as const) {
    it(`Start a new world: white on --danger (${theme})`, () => {
      expect(rule(".danger")).toMatch(/background: var\(--danger\); color: #fff;/);
      expect(ratio("#ffffff", v["--danger"]!)).toBeGreaterThanOrEqual(4.5);
    });

    it(`a touch button switched on: --on-accent on --accent (${theme})`, () => {
      expect(rule(".side .on")).toMatch(/background: var\(--accent\); color: var\(--on-accent\);/);
      expect(ratio(v["--on-accent"]!, v["--accent"]!)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
