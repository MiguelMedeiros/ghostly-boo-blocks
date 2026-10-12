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
  const view = ana.frame.locator("canvas.view");
  // Low on the screen (above the hotbar) is the ground just in front. data-edits counts the cells changed.
  await view.click({ position: { x: 450, y: 480 } });
  await expect.poll(() => edits(ana)).toBe(1);
  await view.click({ position: { x: 550, y: 430 }, button: "right" });
  await expect.poll(() => edits(ana)).toBe(2);
  await ana.frame.locator(".hotbar .slot").nth(6).click();
  await view.click({ position: { x: 350, y: 430 }, button: "right" });
  await expect.poll(() => edits(ana)).toBe(3);
  await ana.page.waitForTimeout(1500);
  await ana.reload();
  expect(await edits(ana)).toBe(3);
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
  const bobView = bob.frame.locator("canvas.view");
  await Promise.all([anaView.click({ position: { x: 450, y: 470 } }), bobView.click({ position: { x: 350, y: 430 } })]);
  await Promise.all([anaView.click({ position: { x: 550, y: 430 }, button: "right" }), bobView.click({ position: { x: 750, y: 450 }, button: "right" })]);
  await expect.poll(() => edits(ana)).toBeGreaterThanOrEqual(3);
  await expect.poll(async () => (await edits(bob)) === (await edits(ana))).toBe(true);
  const together = await edits(ana);

  // Ana walks ahead of Bob: he sees her ghost and her name over it.
  await anaView.focus();
  await ana.page.keyboard.down("KeyW");
  await ana.page.waitForTimeout(700);
  await ana.page.keyboard.up("KeyW");
  await expect(bob.frame.locator(".name-tag")).toBeVisible();
  await expect(bob.frame.locator(".name-tag")).toHaveText("Ana");
  await bob.page.screenshot({ path: test.info().outputPath("bob-sees-ana.png") });

  // Bob reloads: the world is his still, and Ana's still matches.
  await bob.page.waitForTimeout(1500);
  await bob.reload();
  expect(await edits(bob)).toBe(together);
  // Shown once per chat: not again after the reload.
  await expect(bob.frame.getByRole("dialog")).toBeHidden();
  const bobViewAgain = bob.frame.locator("canvas.view");
  await expect(bob.frame.locator(".status")).toHaveText("Construindo com Ana");

  // Ana leaves; Bob builds alone; Ana comes back and gets it.
  const anaStorage = ana.storage;
  await ana.page.waitForTimeout(1500);
  await ana.close();
  await expect(bob.frame.locator(".status")).toHaveText("Esperando seu contato abrir o Blocks");
  await bobViewAgain.click({ position: { x: 450, y: 430 }, button: "right" });
  await bobViewAgain.click({ position: { x: 650, y: 430 }, button: "right" });
  await expect.poll(() => edits(bob)).toBeGreaterThan(together);
  const anaAgain = await chat.open("ana2", { displayName: "Ana", storage: anaStorage });
  expect(await edits(anaAgain)).toBeGreaterThanOrEqual(together);
  await expect.poll(() => edits(anaAgain)).toBe(await edits(bob));
  expect(ana.overLimit + bob.overLimit + anaAgain.overLimit).toBe(0);
  await anaAgain.close();
  await bob.close();
});
