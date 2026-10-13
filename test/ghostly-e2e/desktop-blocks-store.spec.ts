/*
 * Boo Blocks from the official Ghostly store in Ghostly Desktop on macOS, over the real network (tag @network): two
 * Desktop apps (the system WKWebView) on one Mac, driven through the test driver of a debug build (Ghostly's
 * e2e/support/desktopMac.ts). Ghostly's preloaded store is read from GitHub, Ana installs Boo Blocks from its listing,
 * opens it in her chat with Bob, Bob installs it from her card; each Boo Blocks runs in an app window of its own. They
 * build together and see each other. Copy to e2e/desktop-macos/ and run it there (test/ghostly-e2e/README.md).
 */
import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { desktopPerson, type DesktopPerson } from "../matrix/people";
import { HYPERDHT_TESTNET } from "../matrix/desktop";
import { forgetSharedData, openMacDesktop, type MacDesktop } from "../support/desktopMac";
import { LocalRelay } from "../support/relay";

const SHOTS = process.env.BLOCKS_SHOTS;
const STORE_KEY = "y379ia3t1urwudj8o4w1qwmuwp1mcxyf956b5r7pqup7stce6diy";
const REF = "bt85mdaupa7sya7uucqw3nac5nwd5coxz65spe6newcjszwn1fyo/boo-blocks";
// 49820-49839: this test's ports.
const PORTS = { relay: 49821, dht: 49822, a: 49830, b: 49831 };

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

/**
 * Breaks (0) or places (2) a block, trying spots (and looking further down between rounds) until a cell changes, as
 * `seen` counts it: a Blocks window behind another gets few animation frames in WKWebView, and 1.0.0 counts its
 * edits in its frame loop, so a side out of sight is watched through the contact's window.
 */
async function build(app: Driver, button: 0 | 2, seen: Driver = app): Promise<void> {
  const before = await edits(seen);
  for (let round = 0; round < 5; round++) {
    for (const [fx, fy] of SPOTS) {
      await clickWorld(app, fx, fy, button);
      const deadline = Date.now() + 1500;
      while (Date.now() < deadline) {
        if ((await edits(seen)) > before) return;
        await new Promise((done) => setTimeout(done, 100));
      }
    }
    // Facing the sea or a slope: look further down, and turn a little.
    await hold(app, "ArrowDown", 250);
    await hold(app, "ArrowLeft", 400);
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

test("two Desktop apps on a Mac install Boo Blocks from the official store and build in it", { tag: ["@network"] }, async ({}, testInfo) => {
  test.skip(process.platform !== "darwin", "macOS only: the system WKWebView");
  test.setTimeout(12 * 60_000);
  const relay = new LocalRelay();
  const { default: testnet } = (await import(HYPERDHT_TESTNET)) as { default: (size: number, opts?: { port?: number }) => Promise<{ bootstrap: { host: string; port: number }[]; destroy(): Promise<void> }> };
  const dht = await testnet(3, { port: PORTS.dht });
  const env = {
    GHOSTLY_PKARR_RELAYS: await relay.listen(PORTS.relay),
    GHOSTLY_HYPERDHT_BOOTSTRAP: dht.bootstrap.map((node) => `${node.host}:${node.port}`).join(","),
  };
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

    await test.step("pair", async () => {
      await ana.press("New chat");
      const invite = await ana.copyInvite();
      await bob.join(invite);
      for (const p of [ana, bob]) {
        await expect.poll(() => p.canWrite(), { timeout: 120_000 }).toBe(true);
        p.chatHash = await p.hash();
        await expect.poll(() => p.connection(), { timeout: 120_000 }).toMatch(/Connected ·/);
      }
    });

    let anaBlocks!: Driver;
    let bobBlocks!: Driver;
    await test.step("Ana installs Boo Blocks from the official store and opens it in the chat", async () => {
      const app = ana.app;
      const store = `[data-testid="app-store"][data-key="${STORE_KEY}"]`;
      await ana.go("#/apps");
      await expect.poll(() => app.text(store), { timeout: 30_000 }).not.toBeNull();
      await app.click(`${store} [data-testid="app-store-refresh"]`);
      await expect.poll(() => app.text(store), { timeout: 60_000 }).toContain("3 apps");
      const listing = `[data-testid="app-listing"][data-ref="${REF}"]`;
      if ((await app.text(listing)) === null) await app.click(`${store} [data-testid="app-store-chevron"]`);
      await expect.poll(() => app.text(listing), { timeout: 30_000 }).toContain("Boo Blocks");
      await app.click(`${listing} [data-testid="app-listing-install"]`);
      await expect.poll(() => app.text('[data-testid="app-install"]'), { timeout: 60_000 }).toContain("In Ghostly Store");
      await app.click('[data-testid="app-install-confirm"]');
      await expect.poll(() => app.text('[data-testid="installed-app"]'), { timeout: 120_000 }).toContain("Boo Blocks");
      await ana.go(ana.chatHash!);
      await expect.poll(() => ana.canWrite(), { timeout: 60_000 }).toBe(true);
      await app.click('[data-testid="composer-more"]');
      await app.click('[data-testid="composer-apps"]');
      await app.click('[data-testid="chat-app-open"]');
      anaBlocks = await blocksWindow(desktops.a);
      await expect.poll(() => statusText(anaBlocks)).toBe("Waiting for your contact to open Boo Blocks");
    });

    await test.step("Bob installs it from Ana's card; each sees the other", async () => {
      const app = bob.app;
      await expect.poll(() => app.text('[data-testid="app-card"]'), { timeout: 60_000 }).toContain("Ana opened it here");
      await app.click('[data-testid="app-card-install"]');
      await expect.poll(() => app.text('[data-testid="app-install"]'), { timeout: 60_000 }).not.toBeNull();
      await app.click('[data-testid="app-install-confirm"]');
      bobBlocks = await blocksWindow(desktops.b);
      await expect.poll(() => statusText(bobBlocks), { timeout: 60_000 }).toBe("Building with Ana");
      await expect.poll(() => statusText(anaBlocks), { timeout: 60_000 }).toBe("Building with Bob");
    });

    await test.step("they build, and Bob sees Ana's ghost with her name", async () => {
      for (const app of [anaBlocks, bobBlocks]) await app.execute(`document.querySelector('[role="dialog"] button')?.click();`);
      await build(anaBlocks, 0, bobBlocks);
      await build(bobBlocks, 2);
      expect(await edits(bobBlocks)).toBeGreaterThanOrEqual(2);
      await anaBlocks.execute(`window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));`);
      await hold(anaBlocks, "KeyW", 2000);
      await anaBlocks.execute(`window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", bubbles: true }));`);
      await expect.poll(() => bobBlocks.text(".name-tag"), { timeout: 30_000 }).toBe("Ana");
      await saveWorld(bobBlocks, "store-desktop-bob-sees-ana");
    });
    testInfo.annotations.push({ type: "transport", description: await ana.connection() });
  } finally {
    await Promise.all(Object.values(desktops).map((d) => d.stop().catch(() => {})));
    await dht.destroy().catch(() => {});
    await relay.close?.();
  }
});
