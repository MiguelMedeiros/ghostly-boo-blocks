// The built app: one self-contained HTML file that loads nothing by URL, carries no third-party code, stays small,
// and never names anyone else's game.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
let out: string;
let page: string;

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "ghostly-blocks-"));
  await build({ configFile: join(root, "vite.config.ts"), logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
  page = readFileSync(join(out, "index.html"), "utf8");
}, 60_000);

afterAll(() => rmSync(out, { recursive: true, force: true }));

describe("the Blocks bundle", () => {
  it("is one HTML file with its script and styles inline", () => {
    expect(readdirSync(out)).toEqual(["index.html"]);
    expect(page).not.toMatch(/<script\b[^>]*\bsrc=/i);
    expect(page).not.toMatch(/<link\b/i);
    expect(page).not.toMatch(/<iframe\b|<object\b|<embed\b/i);
    expect(page).not.toMatch(/\s(?:src|href|srcset|action|poster)\s*=\s*["']/i);
    expect(page).not.toMatch(/\son[a-z]+\s*=\s*["']/i);
    expect(page).not.toMatch(/type="module"/);
    expect(page.match(/<script\b/g)).toHaveLength(1);
    expect(page.match(/<style\b/g)).toHaveLength(1);
  });

  it("reaches no network and makes no worker (the runner allows neither)", () => {
    const script = page.slice(page.indexOf("<script>"));
    for (const api of ["fetch(", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon", "new Worker", "importScripts", "requestPointerLock", "document.write"]) expect(script).not.toContain(api);
  });

  it("is far under the 16 MiB a bundle may be", () => {
    expect(Buffer.byteLength(page)).toBeLessThan(200 * 1024);
  });

  it("names no other game or company", () => {
    expect(page).not.toMatch(/minecraft|mojang|microsoft/i);
  });

  it("builds to the same bytes twice", async () => {
    const again = mkdtempSync(join(tmpdir(), "ghostly-blocks-"));
    await build({ configFile: join(root, "vite.config.ts"), logLevel: "silent", build: { outDir: again, emptyOutDir: true } });
    expect(readFileSync(join(again, "index.html"), "utf8")).toBe(page);
    rmSync(again, { recursive: true, force: true });
  }, 60_000);
});
