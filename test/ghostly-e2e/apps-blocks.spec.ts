/*
 * Boo Blocks in Ghostly, end to end, on Ghostly's own e2e suite (copy this file to a Ghostly checkout's e2e/web/ and run
 * it there; see test/ghostly-e2e/README.md). The built Boo Blocks (BLOCKS_DIST, its ghostly-app.json beside it as
 * BLOCKS_MANIFEST) is bundled and signed in the test with a throwaway key (the SHA-256 of a fixed label, as Ghostly's
 * own app specs do), listed in a store the test signs, and served at raw.githubusercontent.com URLs by context.route:
 * nothing leaves the machine and no real key is used.
 *
 * Ana installs Boo Blocks from the store and opens it in her chat with Bob; Bob installs it from her card. They build at
 * once, see each other's name, close and reopen Boo Blocks, and Bob reloads Ghostly: the world is the same each time.
 */
import { readFileSync } from "node:fs";
import { sha256 } from "@noble/hashes/sha2.js";
import { buildAppBundle, seedSigner, signAppStore, toZ32, utf8Encode, type AppManifestDraft, type AppStoreIndex } from "@ghostly/core";
import type { FrameLocator, Page } from "@playwright/test";
import { chat, expect, test, type Peer } from "../support/fixtures";
import { pair } from "../support/paired";
import { composerRow } from "../support/composer";
import { serveStore, STORE_URL } from "../support/appStore";

const DIST = process.env.BLOCKS_DIST ?? "";
const MANIFEST = process.env.BLOCKS_MANIFEST ?? "";
const APP_URL = "https://raw.githubusercontent.com/ghostly-e2e/blocks/HEAD/app.ghostlyapp";
const SHOTS = process.env.BLOCKS_SHOTS;

const signer = (label: string) => seedSigner(sha256(utf8Encode(`ghostly blocks e2e: ${label}`)));

async function blocksStore() {
  const source = JSON.parse(readFileSync(MANIFEST, "utf8")) as AppManifestDraft & { sources?: string[] };
  const publisher = signer("publisher");
  const store = signer("store");
  const made = await buildAppBundle({ ...source, sequence: 1, sources: [APP_URL] }, [{ path: "index.html", bytes: new Uint8Array(readFileSync(DIST)) }], publisher);
  const ref = `${toZ32(publisher.publicKey)}/${source.name}`;
  const index: AppStoreIndex = {
    ghostlyStore: 1, key: toZ32(store.publicKey), name: "E2E store", description: "Apps for the end-to-end tests.", kind: "curated", sequence: 1,
    expires: Math.floor(Date.now() / 1000) + 30 * 24 * 3600, removed: [], revoked: [],
    apps: [{ ref, sequence: 1, digest: made.digest, urls: [APP_URL], title: source.title, tagline: source.tagline, category: "games" }],
  };
  const signed = await signAppStore(index, store);
  return {
    title: source.title,
    files: new Map<string, Uint8Array>([[APP_URL, made.bytes], [STORE_URL, signed.indexBytes], [new URL("ghostly-store.sig", STORE_URL).href, signed.sigBytes]]),
  };
}

async function setNickname(peer: Peer, nick: string): Promise<void> {
  await peer.page.goto("/#/settings");
  await peer.page.getByPlaceholder("Enter your nickname...").fill(nick);
  await peer.page.goto("/#/");
}

const miniApp = (page: Page) => page.getByTestId("mini-app");
const blocks = (page: Page): FrameLocator => miniApp(page).frameLocator("iframe");
const edits = async (page: Page) => Number(await blocks(page).locator("#app").getAttribute("data-edits"));
const status = (page: Page) => blocks(page).locator(".status");

async function shot(peer: Peer, name: string): Promise<void> {
  if (SHOTS) await peer.page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const SPOTS: [number, number][] = [[0.5, 0.8], [0.5, 0.72], [0.42, 0.78], [0.58, 0.78], [0.5, 0.66], [0.35, 0.8], [0.65, 0.8], [0.5, 0.6], [0.3, 0.7], [0.7, 0.7]];

/**
 * Breaks (left) or places (right) a block: a person starts a few blocks from the middle at random, so the spot that
 * reaches a block differs; this tries spots (looking further down between rounds) until a cell changes.
 */
async function build(page: Page, button: "left" | "right"): Promise<void> {
  const view = blocks(page).locator("canvas.view");
  const box = (await view.boundingBox())!;
  const before = await edits(page);
  for (let round = 0; round < 3; round++) {
    for (const [fx, fy] of SPOTS) {
      await view.click({ position: { x: Math.round(box.width * fx), y: Math.round(box.height * fy) }, button });
      try {
        await expect.poll(() => edits(page), { timeout: 1000 }).toBeGreaterThan(before);
        return;
      } catch {
        // Nothing within reach there.
      }
    }
    await view.focus();
    await page.keyboard.down("ArrowDown");
    await page.waitForTimeout(250);
    await page.keyboard.up("ArrowDown");
  }
  throw new Error("no block within reach");
}

/** Closes the help a first open shows, if it is there. */
async function dismissHelp(page: Page): Promise<void> {
  const close = blocks(page).getByRole("dialog").getByRole("button");
  if (await close.isVisible().catch(() => false)) await close.click();
}

/** Closes Boo Blocks from its header and opens it again from the chat's app card. */
async function closeAndReopen(peer: Peer): Promise<void> {
  await miniApp(peer.page).getByTestId("mini-app-close").click();
  await expect(miniApp(peer.page)).toBeHidden();
  await chat(peer).getByTestId("app-card").last().getByTestId("app-card-open").click();
  await expect(miniApp(peer.page)).toBeVisible();
  await expect(blocks(peer.page).locator("#app")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
}

test("two people build in one Boo Blocks world in their chat, and find it again after closing it and reloading", async ({ peer }) => {
  test.skip(!DIST || !MANIFEST, "BLOCKS_DIST and BLOCKS_MANIFEST name the built Boo Blocks");
  test.setTimeout(8 * 60_000);
  const store = await blocksStore();
  const [ana, bob] = await Promise.all([peer("ana"), peer("bob")]);
  for (const p of [ana, bob]) {
    await p.page.setViewportSize({ width: 1100, height: 760 });
    await serveStore(p.context, store);
  }
  await setNickname(ana, "Ana");
  await setNickname(bob, "Bob");

  // 1. Ana adds the store and installs Boo Blocks: the install screen asks for her name in the chat.
  await ana.page.getByTestId("account-apps").click();
  await ana.page.getByTestId("apps-add").click();
  await ana.page.getByTestId("apps-add-url").fill(STORE_URL);
  await ana.page.getByTestId("apps-add-check").click();
  await ana.page.getByTestId("apps-add-store-confirm").click();
  await ana.page.getByTestId("app-store").filter({ hasText: "E2E store" }).getByTestId("app-listing-install").click();
  const install = ana.page.getByTestId("app-install");
  await expect(install.getByTestId("app-permission-name")).toBeVisible();
  await ana.page.waitForTimeout(600);
  await shot(ana, "01-install");
  await install.getByTestId("app-install-confirm").click();
  await expect(ana.page.getByTestId("installed-app")).toContainText(store.title);
  await ana.page.goto("/#/");

  // 2. They pair; Ana opens Boo Blocks in the chat and waits for Bob.
  await pair(ana, bob);
  await (await composerRow(ana.page, "composer-apps")).click();
  await ana.page.getByTestId("chat-apps").getByTestId("chat-app-open").click();
  await expect(miniApp(ana.page)).toBeVisible();
  await expect(blocks(ana.page).locator("#app")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(status(ana.page)).toHaveText("Waiting for your contact to open Boo Blocks");
  await dismissHelp(ana.page);

  // 3. Bob installs it from Ana's card and opens it: each sees the other's name.
  const card = chat(bob).getByTestId("app-card");
  await expect(card).toContainText("Ana opened it here");
  await card.getByTestId("app-card-install").click();
  await bob.page.getByTestId("app-install").getByTestId("app-install-confirm").click();
  await expect(miniApp(bob.page)).toBeVisible();
  await expect(blocks(bob.page).locator("#app")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await dismissHelp(bob.page);
  await expect(status(bob.page)).toHaveText("Building with Ana", { timeout: 60_000 });
  await expect(status(ana.page)).toHaveText("Building with Bob");
  // Both start on the same ground.
  expect(await blocks(ana.page).locator("#app").getAttribute("data-ground")).toBe(await blocks(bob.page).locator("#app").getAttribute("data-ground"));

  // 4. They build: each breaks and places, then both break at the same moment (Q, the middle of the view).
  const anaView = blocks(ana.page).locator("canvas.view");
  const bobView = blocks(bob.page).locator("canvas.view");
  await build(ana.page, "left");
  await build(bob.page, "left");
  await blocks(ana.page).locator(".hotbar .slot").nth(6).click();
  await blocks(bob.page).locator(".hotbar .slot").nth(4).click();
  await build(ana.page, "right");
  await build(bob.page, "right");
  await build(ana.page, "right");
  await Promise.all([anaView.press("KeyQ"), bobView.press("KeyQ")]);
  await expect.poll(async () => (await edits(bob.page)) === (await edits(ana.page)), { timeout: 30_000 }).toBe(true);
  await ana.page.waitForTimeout(1000);
  await expect.poll(async () => (await edits(bob.page)) === (await edits(ana.page)), { timeout: 30_000 }).toBe(true);
  const together = await edits(ana.page);
  expect(together).toBeGreaterThanOrEqual(5);

  // 5. Ana walks ahead (jumping any step): Bob sees her ghost with her name over it.
  await anaView.focus();
  await ana.page.keyboard.down("KeyW");
  await ana.page.keyboard.down("Space");
  await ana.page.waitForTimeout(2000);
  await ana.page.keyboard.up("Space");
  await ana.page.keyboard.up("KeyW");
  await expect(blocks(bob.page).locator(".name-tag")).toHaveText("Ana", { timeout: 30_000 });
  await expect(blocks(bob.page).locator(".name-tag")).toBeVisible();
  await shot(bob, "02-bob-sees-ana");
  await shot(ana, "03-ana-building");

  // 6. Each closes Boo Blocks and opens it again from the card: the world is kept, and they catch up.
  for (const p of [ana, bob]) {
    await closeAndReopen(p);
    expect(await edits(p.page)).toBe(together);
  }
  await expect(status(ana.page)).toHaveText("Building with Bob", { timeout: 60_000 });
  await expect(status(bob.page)).toHaveText("Building with Ana", { timeout: 60_000 });

  // 7. Ana closes Boo Blocks; Bob builds alone; Ana opens it again and gets what he built.
  await miniApp(ana.page).getByTestId("mini-app-close").click();
  await expect(status(bob.page)).toHaveText("Waiting for your contact to open Boo Blocks", { timeout: 60_000 });
  await build(bob.page, "right");
  await build(bob.page, "right");
  await expect.poll(() => edits(bob.page)).toBeGreaterThan(together);
  await chat(ana).getByTestId("app-card").last().getByTestId("app-card-open").click();
  await expect(blocks(ana.page).locator("#app")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect.poll(async () => (await edits(ana.page)) === (await edits(bob.page)), { timeout: 60_000 }).toBe(true);
  const after = await edits(bob.page);

  // 8. Bob reloads Ghostly: Boo Blocks is closed; opened from the card, his world is the same.
  await bob.page.waitForTimeout(1500);
  await bob.page.reload();
  await expect(miniApp(bob.page)).toBeHidden();
  await expect(bob.page.getByTestId("connection-options")).toHaveAccessibleName(/Connected · /, { timeout: 90_000 });
  await chat(bob).getByTestId("app-card").last().getByTestId("app-card-open").click();
  await expect(blocks(bob.page).locator("#app")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  expect(await edits(bob.page)).toBe(after);
  await expect(status(bob.page)).toHaveText("Building with Ana", { timeout: 60_000 });
  await shot(bob, "04-bob-after-reload");
});
