// The manifest as `ghostly app publish` takes it: the same version everywhere, and every field within WISP 1200's
// bounds, so a release never fails at signing.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SOURCE } from "../scripts/bundle.mjs";

const root = join(import.meta.dirname, "..");
const read = (file: string) => JSON.parse(readFileSync(join(root, file), "utf8"));
const manifest = read("ghostly-app.json");
const chars = (s: string) => [...s].length;

describe("the manifest", () => {
  it("has the same version as package.json and package-lock.json", () => {
    expect(read("package.json").version).toBe(manifest.version);
    const lock = read("package-lock.json");
    expect(lock.version).toBe(manifest.version);
    expect(lock.packages[""].version).toBe(manifest.version);
  });

  it("holds only what a writer may write, within its bounds", () => {
    const allowed = ["name", "version", "kind", "title", "tagline", "description", "releaseNotes", "entry", "permissions", "view", "runtime", "license", "sources", "homepage", "support"];
    expect(Object.keys(manifest).filter((k) => !allowed.includes(k))).toEqual([]);
    expect(manifest.name).toMatch(/^[a-z][a-z0-9-]{0,31}$/);
    expect(manifest.kind).toBe("mini-app");
    expect(chars(manifest.title)).toBeLessThanOrEqual(40);
    expect(chars(manifest.tagline)).toBeLessThanOrEqual(80);
    expect(chars(manifest.description)).toBeLessThanOrEqual(2000);
    expect(chars(manifest.releaseNotes)).toBeLessThanOrEqual(500);
    expect(manifest.releaseNotes).not.toMatch(/\n/);
    expect(manifest.entry).toBe("index.html");
    expect([...manifest.permissions].sort()).toEqual(["chat", "name"]);
    expect(manifest.view).toBe("full");
    expect(manifest.runtime).toEqual({ host: ">=1.2", clients: ["web", "desktop"] });
    expect(manifest.sources).toEqual([SOURCE]);
    for (const url of [...manifest.sources, manifest.homepage, manifest.support]) expect(url).toMatch(/^https:\/\//);
  });
});
