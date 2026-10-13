/*
 * Boo Blocks in Ghostly Desktop on macOS, end to end: two Desktop apps (the system WKWebView) on one Mac, driven through
 * the test driver a debug build carries (Ghostly's e2e/support/desktopMac.ts). Copy this file to a Ghostly
 * checkout's e2e/desktop-macos/ and run it there; see test/ghostly-e2e/README.md.
 *
 * The built Boo Blocks is bundled and signed in the test with a throwaway key and served, with a store listing it, by a
 * local server the debug build's test fetcher reads (apps/ui/src/desktop/appsTestFetch.ts, a build made with
 * VITE_APPS_TEST=1). Ana installs Boo Blocks and opens it in her chat with Bob; Bob installs it from her card. Each
 * Boo Blocks runs in an app window of its own, on the ghostly-app runner. They build at once, see each other's name,
 * and each closes Boo Blocks and opens it again: the world is the same.
 */
import http from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { sha256 } from "@noble/hashes/sha2.js";
import { expect, test } from "@playwright/test";
import { buildAppBundle, seedSigner, signAppStore, toZ32, utf8Encode, type AppManifestDraft, type AppStoreIndex } from "@ghostly/core";
import { desktopPerson, type DesktopPerson } from "../matrix/people";
import { HYPERDHT_TESTNET } from "../matrix/desktop";
import { forgetSharedData, openMacDesktop, type MacDesktop } from "../support/desktopMac";
import { LocalRelay } from "../support/relay";
import { STORE_URL } from "../support/appStore";

const DIST = process.env.BLOCKS_DIST ?? "";
const MANIFEST = process.env.BLOCKS_MANIFEST ?? "";
const SHOTS = process.env.BLOCKS_SHOTS;
const APP_URL = "https://raw.githubusercontent.com/ghostly-e2e/blocks/HEAD/app.ghostlyapp";
// 49800-49899: this test's ports.
const PORTS = { relay: 49801, dht: 49802, a: 49810, b: 49811 };

const signer = (label: string) => seedSigner(sha256(utf8Encode(`ghostly blocks e2e: ${label}`)));

async function blocksStore(): Promise<Map<string, Uint8Array>> {
  const source = JSON.parse(readFileSync(MANIFEST, "utf8")) as AppManifestDraft;
  const publisher = signer("publisher");
  const store = signer("store");
  const made = await buildAppBundle({ ...source, sequence: 1, sources: [APP_URL] }, [{ path: "index.html", bytes: new Uint8Array(readFileSync(DIST)) }], publisher);
  const index: AppStoreIndex = {
    ghostlyStore: 1, key: toZ32(store.publicKey), name: "E2E store", description: "Apps for the end-to-end tests.", kind: "curated", sequence: 1,
    expires: Math.floor(Date.now() / 1000) + 30 * 24 * 3600, removed: [], revoked: [],
    apps: [{ ref: `${toZ32(publisher.publicKey)}/${source.name}`, sequence: 1, digest: made.digest, urls: [APP_URL], title: source.title, tagline: source.tagline, category: "games" }],
  };
  const signed = await signAppStore(index, store);
  return new Map([[APP_URL, made.bytes], [STORE_URL, signed.indexBytes], [new URL("ghostly-store.sig", STORE_URL).href, signed.sigBytes]]);
}

/** Serves the store's files at `/<host><path>`, as the Desktop test fetcher asks for them. */
async function storeServer(files: Map<string, Uint8Array>): Promise<{ base: string; close: () => Promise<void> }> {
  const server = http.createServer((request, response) => {
    const body = files.get(`https:/${request.url ?? ""}`);
    response.writeHead(body ? 200 : 404, { "content-type": "application/octet-stream", "access-control-allow-origin": "*" });
    response.end(body ? Buffer.from(body) : "404: Not Found");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as { port: number };
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((done) => server.close(() => done())) };
}

type Driver = MacDesktop["app"] & { in(window: string): Driver; windows(): Promise<string[]> };

/** Boo Blocks's own window: the one that is not `main`. */
async function blocksWindow(desktop: MacDesktop): Promise<Driver> {
  const main = desktop.app as Driver;
  let label: string | undefined;
  await expect.poll(async () => (label = (await main.windows()).find((w) => w !== "main")), { timeout: 60_000, message: "Boo Blocks's window" }).toBeDefined();
  const app = main.in(label!);
  await expect.poll(() => app.execute<string | null>(`const e = document.getElementById("app"); return e ? e.dataset.state || null : null;`).catch(() => null), { timeout: 60_000 }).toBe("ready");
  return app;
}

const data = (app: Driver, name: string) => app.execute<string | null>(`return document.getElementById("app").dataset[arguments[0]] ?? null;`, name);
const edits = async (app: Driver) => Number(await data(app, "edits"));
const statusText = (app: Driver) => app.text(".status");

/** A click (button 0) or right-click (2) on the world at a fraction of its size, as the pointer's events. */
async function clickWorld(app: Driver, fx: number, fy: number, button: 0 | 2): Promise<void> {
  await app.execute(
    `const c = document.querySelector("canvas.view"); const r = c.getBoundingClientRect();
     const init = { bubbles: true, cancelable: true, pointerId: 7, pointerType: "mouse", isPrimary: true, button: arguments[2], clientX: r.left + r.width * arguments[0], clientY: r.top + r.height * arguments[1] };
     c.dispatchEvent(new PointerEvent("pointerdown", init)); c.dispatchEvent(new PointerEvent("pointerup", init));`,
    fx, fy, button,
  );
}

const SPOTS: [number, number][] = [[0.5, 0.8], [0.5, 0.72], [0.42, 0.78], [0.58, 0.78], [0.5, 0.66], [0.35, 0.8], [0.65, 0.8], [0.5, 0.6], [0.3, 0.7], [0.7, 0.7]];

/** Breaks (0) or places (2) a block, trying spots (and looking further down between rounds) until a cell changes. */
async function build(app: Driver, button: 0 | 2): Promise<void> {
  const before = await edits(app);
  for (let round = 0; round < 3; round++) {
    for (const [fx, fy] of SPOTS) {
      await clickWorld(app, fx, fy, button);
      const deadline = Date.now() + 1000;
      while (Date.now() < deadline) {
        if ((await edits(app)) > before) return;
        await new Promise((done) => setTimeout(done, 100));
      }
    }
    await hold(app, "ArrowDown", 250);
  }
  throw new Error("no block within reach");
}

/** Holds a key for a while, as the window's key events. */
async function hold(app: Driver, code: string, ms: number): Promise<void> {
  await app.execute(`window.dispatchEvent(new KeyboardEvent("keydown", { code: arguments[0], bubbles: true }));`, code);
  await new Promise((done) => setTimeout(done, ms));
  await app.execute(`window.dispatchEvent(new KeyboardEvent("keyup", { code: arguments[0], bubbles: true }));`, code);
}

/** The world as drawn (the canvas, without the page around it), saved as a PNG: read just after a frame is drawn. */
async function saveWorld(app: Driver, name: string): Promise<void> {
  if (!SHOTS) return;
  await app.execute(`
    if (!window.__shotHook) {
      window.__shotHook = true;
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => raf((t) => { cb(t); if (window.__wantShot) { window.__wantShot = false; window.__shot = document.querySelector("canvas.view").toDataURL("image/png"); } });
    }
    window.__shot = null; window.__wantShot = true;`);
  // A small turn and back makes the next frames draw.
  await hold(app, "ArrowLeft", 60);
  await hold(app, "ArrowRight", 60);
  let shot: string | null = null;
  await expect.poll(async () => (shot = await app.execute<string | null>(`return window.__shot;`))).not.toBeNull();
  writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(shot!.split(",")[1], "base64"));
}

async function nickname(p: DesktopPerson, nick: string): Promise<void> {
  await p.go("#/settings");
  await p.app.type('input[placeholder="Enter your nickname..."]', nick);
  await p.go("#/");
}

test("two Desktop apps on a Mac build in one Boo Blocks world in their chat, and find it again after reopening it", async ({}, testInfo) => {
  test.skip(process.platform !== "darwin", "macOS only: the system WKWebView");
  test.skip(!DIST || !MANIFEST, "BLOCKS_DIST and BLOCKS_MANIFEST name the built Boo Blocks");
  test.setTimeout(10 * 60_000);
  const relay = new LocalRelay();
  const { default: testnet } = (await import(HYPERDHT_TESTNET)) as { default: (size: number, opts?: { port?: number }) => Promise<{ bootstrap: { host: string; port: number }[]; destroy(): Promise<void> }> };
  const dht = await testnet(3, { port: PORTS.dht });
  const env = {
    GHOSTLY_PKARR_RELAYS: await relay.listen(PORTS.relay),
    GHOSTLY_HYPERDHT_BOOTSTRAP: dht.bootstrap.map((node) => `${node.host}:${node.port}`).join(","),
  };
  const server = await storeServer(await blocksStore());
  const desktops: Record<string, MacDesktop> = {};
  forgetSharedData();
  const open = (name: "a" | "b") => async () => {
    const desktop = await openMacDesktop({ name, port: PORTS[name], env });
    desktops[name] = desktop;
    return { app: desktop.app, stop: () => desktop.stop() };
  };
  try {
    const [ana, bob] = await Promise.all([desktopPerson("a", { env, open: open("a") }), desktopPerson("b", { env, open: open("b") })]);
    await nickname(ana, "Ana");
    await nickname(bob, "Bob");
    for (const p of [ana, bob]) await p.app.execute("window.__ghostlyAppsStore = arguments[0]", server.base);

    await test.step("pair", async () => {
      await ana.press("New chat");
      const invite = await ana.copyInvite();
      await bob.join(invite);
      for (const p of [ana, bob]) {
        await expect.poll(() => p.canWrite(), { timeout: 120_000 }).toBe(true);
        p.chatHash = await p.hash();
        await expect.poll(() => p.connection(), { timeout: 120_000 }).toMatch(/Connected ·/);
      }
      testInfo.annotations.push({ type: "transport", description: await ana.connection() });
    });

    let anaBlocks!: Driver;
    let bobBlocks!: Driver;
    await test.step("Ana installs Boo Blocks from the store and opens it in the chat", async () => {
      const app = ana.app;
      await ana.go("#/apps");
      await app.click('[data-testid="apps-add"]');
      await app.type('[data-testid="apps-add-url"]', STORE_URL);
      await app.click('[data-testid="apps-add-check"]');
      await expect.poll(() => app.text('[data-testid="apps-add-store"]'), { timeout: 30_000 }).toContain("E2E store");
      await app.click('[data-testid="apps-add-store-confirm"]');
      await expect.poll(() => app.text('[data-testid="app-listing-install"]'), { timeout: 30_000 }).not.toBeNull();
      await app.click('[data-testid="app-listing-install"]');
      await expect.poll(() => app.text('[data-testid="app-install"]'), { timeout: 30_000 }).toContain("name");
      await app.click('[data-testid="app-install-confirm"]');
      await expect.poll(() => app.text('[data-testid="installed-app"]'), { timeout: 30_000 }).toContain("Boo Blocks");
      await ana.go(ana.chatHash!);
      await expect.poll(() => ana.canWrite(), { timeout: 60_000 }).toBe(true);
      await app.click('[data-testid="composer-more"]');
      await app.click('[data-testid="composer-apps"]');
      await app.click('[data-testid="chat-app-open"]');
      anaBlocks = await blocksWindow(desktops.a);
      await expect.poll(() => statusText(anaBlocks)).toBe("Waiting for your contact to open Boo Blocks");
      expect(await data(anaBlocks, "ground")).toBe("c1f12dd");
    });

    await test.step("Bob installs it from Ana's card; each sees the other", async () => {
      const app = bob.app;
      await expect.poll(() => app.text('[data-testid="app-card"]'), { timeout: 60_000 }).toContain("Ana opened it here");
      await app.click('[data-testid="app-card-install"]');
      await expect.poll(() => app.text('[data-testid="app-install"]'), { timeout: 30_000 }).not.toBeNull();
      await app.click('[data-testid="app-install-confirm"]');
      bobBlocks = await blocksWindow(desktops.b);
      await expect.poll(() => statusText(bobBlocks), { timeout: 60_000 }).toBe("Building with Ana");
      await expect.poll(() => statusText(anaBlocks), { timeout: 60_000 }).toBe("Building with Bob");
    });

    let together = 0;
    await test.step("they build at once, and both worlds hold every change", async () => {
      for (const app of [anaBlocks, bobBlocks]) await app.execute(`document.querySelector('[role="dialog"] button')?.click();`);
      await build(anaBlocks, 0);
      await build(bobBlocks, 0);
      await build(anaBlocks, 2);
      await build(bobBlocks, 2);
      // At the same moment: each breaks the block in the middle of the view (Q).
      await Promise.all([hold(anaBlocks, "KeyQ", 50), hold(bobBlocks, "KeyQ", 50)]);
      await expect.poll(async () => (await edits(anaBlocks)) === (await edits(bobBlocks)), { timeout: 30_000 }).toBe(true);
      await new Promise((done) => setTimeout(done, 1000));
      await expect.poll(async () => (await edits(anaBlocks)) === (await edits(bobBlocks)), { timeout: 30_000 }).toBe(true);
      together = await edits(anaBlocks);
      // Ana walks ahead, jumping any step: Bob sees her ghost and her name.
      await anaBlocks.execute(`window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));`);
      await hold(anaBlocks, "KeyW", 2000);
      await anaBlocks.execute(`window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", bubbles: true }));`);
      await expect.poll(() => bobBlocks.text(".name-tag"), { timeout: 30_000 }).toBe("Ana");
      await saveWorld(bobBlocks, "desktop-bob-sees-ana");
      await saveWorld(anaBlocks, "desktop-ana");
    });

    await test.step("each closes Boo Blocks and opens it again from the card: the same world", async () => {
      for (const [p, key] of [[ana, "a"], [bob, "b"]] as const) {
        const window = key === "a" ? anaBlocks : bobBlocks;
        await window.execute("ghostly.close()");
        await expect.poll(async () => (await (p.app as Driver).windows()).length, { timeout: 30_000 }).toBe(1);
        await p.app.click('[data-testid="app-card-open"]');
        const again = await blocksWindow(desktops[key]);
        expect(await edits(again)).toBe(together);
        if (key === "a") anaBlocks = again;
        else bobBlocks = again;
      }
      await expect.poll(() => statusText(anaBlocks), { timeout: 60_000 }).toBe("Building with Bob");
      await expect.poll(() => statusText(bobBlocks), { timeout: 60_000 }).toBe("Building with Ana");
    });
  } finally {
    await server.close();
    await Promise.all(Object.values(desktops).map((d) => d.stop().catch(() => {})));
    await dht.destroy().catch(() => {});
    await relay.close?.();
  }
});
