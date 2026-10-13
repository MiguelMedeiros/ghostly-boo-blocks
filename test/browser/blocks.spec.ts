import { expect, test } from "@playwright/test";
import { GROUND_HEX } from "../ground.ts";
import { appData, Chat, type Side } from "./harness.ts";

/** The app has WebGL 2 here (WebKit on a Linux machine without a GPU may not); the specs that draw need it. */
async function drawing(side: Side): Promise<boolean> {
  return (await appData(side, "state")) === "ready";
}

async function edits(side: Side): Promise<number> {
  return Number(await appData(side, "edits"));
}

/** Spots on the world, as fractions of its size, low enough to point at the ground in front, above the hotbar. */
const SPOTS: [number, number][] = [[0.5, 0.8], [0.5, 0.72], [0.42, 0.78], [0.58, 0.78], [0.5, 0.66], [0.35, 0.8], [0.65, 0.8], [0.5, 0.6], [0.3, 0.7], [0.7, 0.7]];

/**
 * Breaks (left) or places (right) a block, or taps one on a phone: a person starts a few blocks from the middle at
 * random, so the spot that reaches a block differs; this tries spots until a cell changes.
 */
async function build(side: Side, action: "left" | "right" | "tap"): Promise<void> {
  const view = side.frame.locator("canvas.view");
  const box = (await view.boundingBox())!;
  const before = await edits(side);
  for (let round = 0; round < 3; round++) {
    for (const [fx, fy] of SPOTS) {
      const position = { x: Math.round(box.width * fx), y: Math.round(box.height * fy) };
      if (action === "tap") await view.tap({ position });
      else await view.click({ position, button: action });
      try {
        await expect.poll(() => edits(side), { timeout: 700 }).toBeGreaterThan(before);
        return;
      } catch {
        // Nothing within reach there: the next spot.
      }
    }
    // Facing the sea or a slope down: look further down and try again.
    await view.focus();
    await side.page.keyboard.down("ArrowDown");
    await side.page.waitForTimeout(250);
    await side.page.keyboard.up("ArrowDown");
  }
  throw new Error(`${side.name}: no block within reach`);
}

/** Closes the help shown on a first open, and gives the world the keyboard. */
async function dismissHelp(side: Side): Promise<void> {
  const close = side.frame.getByRole("button", { name: /^(Close|Fechar)$/ });
  if (await close.isVisible()) await close.click();
}

test("draws the same ground as Node, in the runner's sandbox, with no CSP violation", async ({ browser }) => {
  const chat = new Chat(browser);
  const ana = await chat.open("ana", { inChat: false });
  test.skip(!(await drawing(ana)), "no WebGL 2 in this browser here");
  expect(await appData(ana, "ground")).toBe(GROUND_HEX);
  await expect(ana.frame.locator(".status")).toHaveText("Just you here. Open Blocks in a chat to build with a contact.");
  await expect(ana.frame.getByRole("dialog")).toBeVisible();
  await dismissHelp(ana);
  await ana.page.waitForTimeout(500);
  expect(await ana.frame.evaluate(() => (window as unknown as { __violations: string[] }).__violations)).toEqual([]);
  await ana.close();
});

test("breaks and places blocks with the mouse, and keeps them after a reload", async ({ browser }) => {
  const chat = new Chat(browser);
  const ana = await chat.open("ana", { inChat: false });
  test.skip(!(await drawing(ana)), "no WebGL 2 in this browser here");
  await dismissHelp(ana);
  await build(ana, "left");
  await build(ana, "right");
  await ana.frame.locator(".hotbar .slot").nth(6).click();
  await build(ana, "right");
  const made = await edits(ana);
  expect(made).toBeGreaterThanOrEqual(3);
  await ana.page.waitForTimeout(1500);
  await ana.reload();
  expect(await edits(ana)).toBe(made);
  expect(ana.overLimit).toBe(0);
  await ana.close();
});

test("two people build in one world, see each other's name, and find it again after reopening", async ({ browser }) => {
  test.setTimeout(150_000);
  const chat = new Chat(browser);
  const ana = await chat.open("ana", { displayName: "Ana" });
  test.skip(!(await drawing(ana)), "no WebGL 2 in this browser here");
  await expect(ana.frame.locator(".status")).toHaveText("Waiting for your contact to open Blocks");
  const bob = await chat.open("bob", { displayName: "Bob", locale: "pt-BR" });
  await expect(bob.frame.locator(".status")).toHaveText("Construindo com Ana");
  await expect(ana.frame.locator(".status")).toHaveText("Building with Bob");
  await dismissHelp(ana);
  await dismissHelp(bob);

  // Both build at once, from where they start.
  const anaView = ana.frame.locator("canvas.view");
  await build(ana, "left");
  await build(bob, "left");
  await build(ana, "right");
  await build(bob, "right");
  // And at the same moment: each breaks the block in the middle of their view (Q).
  await Promise.all([ana.frame.locator("canvas.view").press("KeyQ"), bob.frame.locator("canvas.view").press("KeyQ")]);
  await expect.poll(() => edits(ana)).toBeGreaterThanOrEqual(3);
  await expect.poll(async () => (await edits(bob)) === (await edits(ana))).toBe(true);
  // Let the last ticks land, then the count both hold.
  await ana.page.waitForTimeout(600);
  await expect.poll(async () => (await edits(bob)) === (await edits(ana))).toBe(true);
  const together = await edits(ana);

  // Ana walks ahead of Bob: he sees her ghost and her name over it.
  await anaView.focus();
  // Both start facing the same way, a few blocks apart: two seconds ahead (jumping any step) puts her in his view.
  await ana.page.keyboard.down("KeyW");
  await ana.page.keyboard.down("Space");
  await ana.page.waitForTimeout(2000);
  await ana.page.keyboard.up("Space");
  await ana.page.keyboard.up("KeyW");
  await expect(bob.frame.locator(".name-tag")).toBeVisible();
  await expect(bob.frame.locator(".name-tag")).toHaveText("Ana");
  await bob.page.screenshot({ path: test.info().outputPath("bob-sees-ana.png") });

  // Bob reloads: the world is his still, and Ana's still matches.
  await bob.page.waitForTimeout(1500);
  await bob.reload();
  expect(await edits(bob)).toBe(together);
  await expect.poll(async () => (await edits(bob)) === (await edits(ana))).toBe(true);
  // Shown once per chat: not again after the reload.
  await expect(bob.frame.getByRole("dialog")).toBeHidden();
  await expect(bob.frame.locator(".status")).toHaveText("Construindo com Ana");

  // Ana leaves; Bob builds alone; Ana comes back and gets it.
  const anaStorage = ana.storage;
  await ana.page.waitForTimeout(1500);
  await ana.close();
  await expect(bob.frame.locator(".status")).toHaveText("Esperando seu contato abrir o Blocks");
  await build(bob, "right");
  await build(bob, "right");
  await expect.poll(() => edits(bob)).toBeGreaterThan(together);
  const anaAgain = await chat.open("ana2", { displayName: "Ana", storage: anaStorage });
  expect(await edits(anaAgain)).toBeGreaterThanOrEqual(together);
  await expect.poll(() => edits(anaAgain)).toBe(await edits(bob));
  expect(ana.overLimit + bob.overLimit + anaAgain.overLimit).toBe(0);
  await anaAgain.close();
  await bob.close();
});

test("fits a phone: touch buttons, a hotbar that scrolls within the screen, tap to break and to place", async ({ browser, browserName }) => {
  test.skip(browserName !== "chromium", "touch emulation: Chromium");
  const chat = new Chat(browser);
  const ana = await chat.open("ana", { inChat: false, viewport: { width: 375, height: 667 }, touch: true });
  test.skip(!(await drawing(ana)), "no WebGL 2 in this browser here");
  await dismissHelp(ana);
  await expect(ana.frame.locator(".touch .pad")).toBeVisible();
  await expect(ana.frame.locator(".touch .mode")).toBeVisible();
  const bar = (await ana.frame.locator(".hotbar").boundingBox())!;
  expect(bar.x).toBeGreaterThanOrEqual(0);
  expect(bar.x + bar.width).toBeLessThanOrEqual(375);
  const status = (await ana.frame.locator(".status").boundingBox())!;
  expect(status.x + status.width).toBeLessThanOrEqual(375);
  await build(ana, "tap");
  await ana.frame.locator(".touch .mode").tap();
  await build(ana, "tap");
  await ana.page.screenshot({ path: test.info().outputPath("phone.png") });
  await ana.close();
});
