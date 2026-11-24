// @vitest-environment happy-dom
// The page's controls say their state to a screen reader, not only by colour: the block picked in the hotbar, whether
// the ⋯ menu is open, and whether sound is on.
import { describe, expect, it } from "vitest";
import { en } from "../src/strings.ts";
import { Ui, type UiActions } from "../src/ui.ts";

function mount(): { ui: Ui; host: HTMLElement; sound: () => boolean } {
  document.body.replaceChildren();
  const host = document.createElement("div");
  document.body.append(host);
  let on = true;
  const actions: UiActions = {
    select: () => {},
    newWorld: () => {},
    toggleSound: () => (on = !on),
    toggleFly: () => {},
    toggleMode: () => {},
    hold: () => {},
  };
  return { ui: new Ui(host, en, actions), host, sound: () => on };
}

const button = (host: HTMLElement, label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

describe("the controls' state", () => {
  it("marks the picked hotbar slot pressed, and only it", () => {
    const { ui, host } = mount();
    const slots = [...host.querySelectorAll<HTMLButtonElement>(".hotbar .slot")];
    expect(slots.length).toBeGreaterThan(3);
    expect(slots.every((s) => s.getAttribute("aria-pressed") === "false")).toBe(true);
    ui.select(0, "Grass");
    ui.select(3, "Stone");
    expect(slots.map((s) => s.getAttribute("aria-pressed"))).toEqual(slots.map((_, i) => String(i === 3)));
  });

  it("says whether the ⋯ menu is open, however it closes", () => {
    const { ui, host } = mount();
    const menu = button(host, en.menu);
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    menu.click();
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    menu.click();
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    menu.click();
    ui.closeMenus(); // Escape
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    menu.click();
    [...host.querySelectorAll<HTMLButtonElement>(".menu .item")].find((b) => b.textContent === en.newWorld)!.click();
    expect(menu.getAttribute("aria-expanded")).toBe("false");
  });

  it("names the sound switch Sound and says whether it is on", () => {
    const { host, sound } = mount();
    const toggle = button(host, en.sound);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    toggle.click();
    expect(sound()).toBe(false);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    toggle.click();
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });
});
