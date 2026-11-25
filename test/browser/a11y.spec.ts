import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { Chat, type Side } from "./harness.ts";

const AXE = readFileSync(new URL("../../node_modules/axe-core/axe.min.js", import.meta.url), "utf8");

/**
 * What axe finds on the built page as drawn now, for contrast and landmarks. (Its label-content-name-mismatch would
 * flag every hotbar slot: the key drawn on it is given as aria-keyshortcuts, not in the block's name.)
 */
async function axe(side: Side): Promise<string[]> {
  await side.frame.evaluate(AXE);
  return side.frame.evaluate(async () => {
    const run = (window as unknown as { axe: { run(context: unknown, options: unknown): Promise<{ violations: { id: string; nodes: { html: string }[] }[] }> } }).axe.run;
    const result = await run(document, { runOnly: { type: "rule", values: ["color-contrast", "region", "landmark-one-main"] } });
    return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 80)).join(" | ")}`);
  });
}

test("the built page has the world in a main landmark, and axe finds nothing in its help, menu and New world", async ({ browser }) => {
  const chat = new Chat(browser);
  const ana = await chat.open("ana", { inChat: false });
  await expect(ana.frame.getByRole("main").locator("canvas.view")).toBeAttached();
  await expect(ana.frame.getByRole("dialog", { name: "How to play" })).toBeVisible();
  expect(await axe(ana), "first open, with the help").toEqual([]);
  await ana.frame.getByRole("button", { name: "Close" }).click();
  expect(await axe(ana), "the world").toEqual([]);
  await ana.frame.getByRole("button", { name: "Menu" }).click();
  await ana.frame.getByRole("button", { name: "New world" }).click();
  await expect(ana.frame.getByRole("dialog", { name: "New world" })).toBeVisible();
  expect(await axe(ana), "New world's question").toEqual([]);
  await ana.close();
});

test("on a phone, Fly and place mode switched on still read", async ({ browser }) => {
  const chat = new Chat(browser);
  const ana = await chat.open("ana", { inChat: false, viewport: { width: 375, height: 667 }, touch: true });
  await ana.frame.getByRole("button", { name: "Close" }).click();
  const fly = ana.frame.locator(".touch .fly");
  await fly.tap();
  await expect(fly).toHaveClass(/\bon\b/);
  const mode = ana.frame.locator(".touch .mode");
  await mode.tap();
  await expect(mode).toHaveClass(/\bon\b/);
  expect(await axe(ana)).toEqual([]);
  await ana.close();
});
