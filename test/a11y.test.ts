// @vitest-environment happy-dom
/**
 * What a screen reader gets from the page: the world as an application (so the game's keys reach it), a status region
 * that is in the page before its first notice, a main landmark around everything, and hints for keys that did nothing.
 */
import { readFileSync } from "node:fs";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en, pt } from "../src/strings.ts";
import { HINT_GAP_MS, Ui, type UiActions } from "../src/ui.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const actions: UiActions = { select: () => {}, newWorld: () => {}, toggleSound: () => true, toggleFly: () => {}, toggleMode: () => {}, hold: () => {} };

/** The real page: index.html's body (without its script) and the app's style sheet, with the Ui built in `#app`. */
function page(s = en): { ui: Ui; host: HTMLElement } {
  document.head.innerHTML = `<title>Boo Blocks</title><style>${read("../src/style.css")}</style>`;
  document.documentElement.lang = "en";
  const body = /<body>([\s\S]*)<\/body>/.exec(read("../index.html"))![1].replace(/<script[\s\S]*?<\/script>/g, "");
  document.body.innerHTML = body;
  const host = document.getElementById("app")!;
  return { ui: new Ui(host, s, actions), host };
}

const toastOf = (host: HTMLElement) => host.querySelector<HTMLElement>(".toast")!;
const shown = (node: HTMLElement) => !node.closest("[hidden]") && getComputedStyle(node).display !== "none" && getComputedStyle(node).visibility !== "hidden";

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("The world for a screen reader", () => {
  for (const [lang, s] of [["en", en], ["pt", pt]] as const) {
    it(`is an application, named with the game and its keys, and still takes the focus (${lang})`, () => {
      const { ui } = page(s);
      expect(ui.canvas.getAttribute("role")).toBe("application");
      expect(ui.canvas.getAttribute("aria-roledescription")).toBe(s.worldRole);
      const label = ui.canvas.getAttribute("aria-label")!;
      expect(label).toBe(s.worldLabel);
      expect(label).toContain("Boo Blocks");
      for (const key of ["W A S D", "Q", "E"]) expect(label).toContain(key);
      expect(ui.canvas.tabIndex).toBe(0);
    });
  }
});

describe("Notices", () => {
  beforeEach(() => vi.useFakeTimers());

  it("go to a status region that is in the page, not hidden, before the first one", () => {
    const { ui, host } = page();
    const toast = toastOf(host);
    expect(toast.getAttribute("role")).toBe("status");
    expect(toast.hidden).toBe(false);
    expect(shown(toast)).toBe(true);
    expect(toast.textContent).toBe("");

    ui.notice(en.storageFull, 8000);
    // The same region, only its text changed: that is what a screen reader reads out.
    expect(toastOf(host)).toBe(toast);
    expect(toast.textContent).toBe(en.storageFull);
    vi.advanceTimersByTime(8000);
    expect(toast.textContent).toBe("");
    expect(shown(toast)).toBe(true);
  });

  it("a hint for a key that did nothing is said, at most once in a while, and never over a notice", () => {
    const { ui, host } = page();
    const toast = toastOf(host);
    ui.hint(en.nothingToBreak);
    expect(toast.textContent).toBe(en.nothingToBreak);
    ui.hint(en.nothingToPlace);
    expect(toast.textContent).toBe(en.nothingToBreak);
    vi.advanceTimersByTime(HINT_GAP_MS);
    ui.hint(en.nothingToPlace);
    expect(toast.textContent).toBe(en.nothingToPlace);

    ui.notice(en.worldFull);
    vi.advanceTimersByTime(HINT_GAP_MS);
    ui.hint(en.nothingToBreak);
    expect(toast.textContent).toBe(en.worldFull);
  });
});

describe("axe", () => {
  it("finds no content outside a landmark, and nothing wrong with the world's role", async () => {
    const { ui } = page();
    ui.select(0, en.blocks.grass);
    ui.setStatus(en.alone);
    const result = await axe.run(document.body, { runOnly: { type: "rule", values: ["region", "aria-allowed-role", "aria-roledescription", "aria-allowed-attr", "landmark-one-main"] } });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 80)).join(" | ")}`)).toEqual([]);
    expect(document.querySelector("main")).toBe(ui.root);
  });
});
