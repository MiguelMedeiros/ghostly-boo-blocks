/*
 * Boo Blocks from the official Ghostly store, end to end, over the real network (tag @network): no route, no test key.
 * Ghostly's preloaded store (DEFAULT_STORE_URL, signed by DEFAULT_STORE_KEY) is read from raw.githubusercontent.com,
 * Ana installs Boo Blocks from its listing (the bundle signed by the Boo Blocks key, fetched from jsDelivr pinned to its
 * commit), opens it in her chat with Bob, and Bob installs it from her card. They build together and see each other.
 * Copy to a Ghostly checkout's e2e/web/ and run it there (test/ghostly-e2e/README.md); it needs the internet.
 */
import type { FrameLocator, Page } from "@playwright/test";
import { chat, expect, test, type Peer } from "../support/fixtures";
import { pair } from "../support/paired";
import { composerRow } from "../support/composer";

const STORE_KEY = "y379ia3t1urwudj8o4w1qwmuwp1mcxyf956b5r7pqup7stce6diy";
const REF = "bt85mdaupa7sya7uucqw3nac5nwd5coxz65spe6newcjszwn1fyo/boo-blocks";
const SHOTS = process.env.BLOCKS_SHOTS;
/** The version the store must list (absent: any). */
const VERSION = process.env.BLOCKS_VERSION;

const miniApp = (page: Page) => page.getByTestId("mini-app");
const blocks = (page: Page): FrameLocator => miniApp(page).frameLocator("iframe");
const edits = async (page: Page) => Number(await blocks(page).locator("#app").getAttribute("data-edits"));
const status = (page: Page) => blocks(page).locator(".status");

async function shot(peer: Peer, name: string): Promise<void> {
  if (SHOTS) await peer.page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function setNickname(peer: Peer, nick: string): Promise<void> {
  await peer.page.goto("/#/settings");
  await peer.page.getByPlaceholder("Enter your nickname...").fill(nick);
  await peer.page.goto("/#/");
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
  for (let round = 0; round < 5; round++) {
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
    await page.keyboard.down("ArrowLeft");
    await page.waitForTimeout(400);
    await page.keyboard.up("ArrowLeft");
  }
  throw new Error("no block within reach");
}

/** Closes the help a first open shows, if it is there. */
async function dismissHelp(page: Page): Promise<void> {
  const close = blocks(page).getByRole("dialog").getByRole("button");
  if (await close.isVisible().catch(() => false)) await close.click();
}

test("installs Boo Blocks from the official store and two people build in it", { tag: ["@network"] }, async ({ peer }) => {
  test.setTimeout(14 * 60_000);
  const [ana, bob] = await Promise.all([peer("ana"), peer("bob")]);
  for (const p of [ana, bob]) await p.page.setViewportSize({ width: 1100, height: 760 });
  const asked: string[] = [];
  ana.page.on("request", (r) => { if (/githubusercontent|jsdelivr/.test(r.url())) asked.push(r.url()); });
  await setNickname(ana, "Ana");
  await setNickname(bob, "Bob");

  // 1. Ana reads the official store, which lists Boo Blocks, and installs it from there.
  await ana.page.getByTestId("account-apps").click();
  const store = ana.page.getByTestId("app-store").and(ana.page.locator(`[data-key="${STORE_KEY}"]`));
  await expect(store).toBeVisible();
  // raw.githubusercontent.com caches HEAD for 5 minutes: right after a listing is merged, Refresh until it shows.
  const listing = ana.page.locator(`[data-testid="app-listing"][data-ref="${REF}"]`);
  await expect(async () => {
    await store.getByTestId("app-store-refresh").click();
    await ana.page.waitForTimeout(3000);
    if (!(await listing.isVisible())) await store.getByTestId("app-store-chevron").click();
    await expect(listing).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 6 * 60_000, intervals: [15_000] });
  await expect(listing).toBeVisible({ timeout: 60_000 });
  await expect(listing).toContainText("Boo Blocks");
  await listing.getByTestId("app-listing-install").click();
  const install = ana.page.getByTestId("app-install");
  await expect(install).toContainText("Boo Blocks", { timeout: 60_000 });
  await expect(install.getByTestId("app-permission-name")).toBeVisible();
  if (VERSION) await expect(install).toContainText(`Version ${VERSION}`);
  await ana.page.waitForTimeout(600);
  await shot(ana, "store-01-install");
  await install.getByTestId("app-install-confirm").click();
  await expect(ana.page.getByTestId("installed-app")).toContainText("Boo Blocks", { timeout: 60_000 });
  await shot(ana, "store-02-installed");
  expect(asked.some((u) => u.includes("ghostly-store"))).toBe(true);
  expect(asked.some((u) => u.includes("ghostly-boo-blocks"))).toBe(true);
  await ana.page.goto("/#/");

  // 2. They pair; Ana opens it in the chat; Bob installs it from her card.
  await pair(ana, bob);
  await (await composerRow(ana.page, "composer-apps")).click();
  await ana.page.getByTestId("chat-apps").getByTestId("chat-app-open").click();
  await expect(blocks(ana.page).locator("#app")).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
  await dismissHelp(ana.page);
  const card = chat(bob).getByTestId("app-card");
  await expect(card).toContainText("Ana opened it here", { timeout: 60_000 });
  await card.getByTestId("app-card-install").click();
  await bob.page.getByTestId("app-install").getByTestId("app-install-confirm").click({ timeout: 60_000 });
  await expect(blocks(bob.page).locator("#app")).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
  await dismissHelp(bob.page);
  await expect(status(bob.page)).toHaveText("Building with Ana", { timeout: 60_000 });
  await expect(status(ana.page)).toHaveText("Building with Bob");

  // 3. They build, and both worlds hold every change; Bob sees Ana's name.
  await build(ana.page, "left");
  await build(bob.page, "right");
  await expect.poll(async () => (await edits(bob.page)) === (await edits(ana.page)), { timeout: 30_000 }).toBe(true);
  expect(await edits(ana.page)).toBeGreaterThanOrEqual(2);
  const anaView = blocks(ana.page).locator("canvas.view");
  await anaView.focus();
  await ana.page.keyboard.down("KeyW");
  await ana.page.keyboard.down("Space");
  await ana.page.waitForTimeout(2000);
  await ana.page.keyboard.up("Space");
  await ana.page.keyboard.up("KeyW");
  await expect(blocks(bob.page).locator(".name-tag")).toHaveText("Ana", { timeout: 30_000 });
  await shot(bob, "store-03-bob-sees-ana");
});
