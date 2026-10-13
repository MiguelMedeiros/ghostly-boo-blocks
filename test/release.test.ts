// scripts/bundle.mjs: whether a signed bundle is this checkout's build, and the store's listing for it.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { digestOf, expected, listing, problems, readManifest, SOURCE, type BundleManifest } from "../scripts/bundle.mjs";

const root = join(import.meta.dirname, "..");
const source = JSON.parse(readFileSync(join(root, "ghostly-app.json"), "utf8")) as Record<string, unknown>;
const page = new TextEncoder().encode("<!doctype html><title>Boo Blocks</title>");
const KEY = "odcgw6wjw8dynqop84r47jbjcdqossbgrfiejd367e14hgxmjcho";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("base64url");
const icon = new TextEncoder().encode("\x89PNG icon");

function bundle(manifest: BundleManifest): Uint8Array {
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(manifestBytes.length);
  return Buffer.concat([Buffer.from("GHOSTLYAPP1"), length, manifestBytes, Buffer.from(icon), Buffer.from(page)]);
}

describe("check:bundle", () => {
  it("finds nothing wrong with this build signed as it would be", () => {
    const manifest = expected(source, page, 1, KEY, icon);
    expect(problems(manifest, source, page, KEY, icon)).toEqual([]);
    const read = readManifest(bundle(manifest));
    expect(read.manifest).toEqual(manifest);
    expect(read.digest).toBe(sha256(Buffer.from(JSON.stringify(manifest))));
    expect(digestOf(manifest)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("says when the page, a field or the key differs", () => {
    const manifest = expected(source, page, 1, KEY, icon);
    expect(problems(manifest, source, new TextEncoder().encode("other"), KEY, icon)[0]).toMatch(/its index.html .* is not this checkout's/);
    expect(problems(manifest, source, page, KEY, new TextEncoder().encode("other icon"))[0]).toMatch(/its icon.png .* is not this checkout's/);
    expect(problems({ ...manifest, files: manifest.files.slice(1) }, source, page, KEY, icon)[0]).toMatch(/not icon.png and index.html/);
    expect(problems({ ...manifest, title: "Other" }, source, page, KEY, icon)[0]).toMatch(/^title is "Other"/);
    expect(problems(manifest, source, page, "x".repeat(52), icon)[0]).toMatch(/another publisher key/);
    expect(() => readManifest(Buffer.from("nope"))).toThrow(/not a .ghostlyapp/);
  });

  it("writes a listing pinned to a commit, then HEAD", () => {
    const manifest = expected(source, page, 1, KEY, icon);
    const out = listing(manifest, "d".repeat(43), "a".repeat(40));
    expect(out.ref).toBe(`${KEY}/${source.name}`);
    expect(out.urls).toEqual([`https://cdn.jsdelivr.net/gh/MiguelMedeiros/ghostly-boo-blocks@${"a".repeat(40)}/app.ghostlyapp`, SOURCE]);
    expect(() => listing(manifest, "d", "HEAD")).toThrow(/not a full commit/);
  });
});
