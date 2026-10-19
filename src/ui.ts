/**
 * The page around the world: the status line, the hotbar, the menu, the help, short notices, the contact's name tag,
 * and a stick and buttons for touch screens. Built with createElement and textContent only: the contact's name is never markup.
 */
import { BLOCKS, PALETTE } from "./blocks.ts";
import { drawTile, TILE_PX } from "./render/atlas.ts";
import { readStick } from "./stick.ts";
import type { Strings } from "./strings.ts";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A block's picture for the hotbar: its side tile, drawn on a canvas. */
function swatch(block: number): HTMLCanvasElement {
  const canvas = el("canvas", "swatch");
  canvas.width = canvas.height = TILE_PX;
  const kind = BLOCKS[block];
  if (kind) canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(drawTile(kind.tiles[1])), TILE_PX, TILE_PX), 0, 0);
  return canvas;
}

export interface UiActions {
  select(index: number): void;
  newWorld(): void;
  toggleSound(): boolean;
  toggleFly(): void;
  toggleMode(): void;
  /** A touch button held or let go. */
  hold(key: "jump" | "down", down: boolean): void;
  /** The touch stick: -1 to 1 back to forward and left to right; both 0 when let go. */
  stick(forward: number, strafe: number): void;
}

export class Ui {
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly labels: HTMLElement;
  private readonly status: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly hotbar: HTMLElement;
  private readonly slots: HTMLButtonElement[] = [];
  private readonly blockName: HTMLElement;
  private readonly help: HTMLElement;
  private readonly menu: HTMLElement;
  private readonly confirm: HTMLElement;
  private readonly flyButton: HTMLButtonElement;
  private readonly modeButton: HTMLButtonElement;
  readonly nameTag: HTMLElement;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private nameTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    host: HTMLElement,
    private readonly s: Strings,
    private readonly actions: UiActions,
  ) {
    this.root = host;
    host.classList.add("blocks");
    this.canvas = el("canvas", "view");
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("aria-label", s.title);
    host.append(this.canvas);
    host.append(el("div", "crosshair"));
    this.labels = el("div", "labels");
    this.nameTag = el("div", "name-tag");
    this.nameTag.hidden = true;
    this.labels.append(this.nameTag);
    host.append(this.labels);

    const top = el("div", "top");
    this.status = el("div", "status", s.loading);
    this.status.setAttribute("role", "status");
    const buttons = el("div", "buttons");
    const helpButton = el("button", "round", "?");
    helpButton.setAttribute("aria-label", s.help);
    helpButton.title = s.help;
    helpButton.addEventListener("click", () => this.showHelp(true));
    const menuButton = el("button", "round", "⋯");
    menuButton.setAttribute("aria-label", s.menu);
    menuButton.title = s.menu;
    menuButton.addEventListener("click", () => (this.menu.hidden = !this.menu.hidden));
    buttons.append(helpButton, menuButton);
    top.append(this.status, buttons);
    host.append(top);

    this.menu = el("div", "menu");
    this.menu.hidden = true;
    const sound = el("button", "item", `${s.sound}: ✓`);
    sound.addEventListener("click", () => {
      const on = actions.toggleSound();
      sound.textContent = `${s.sound}: ${on ? "✓" : "✗"}`;
    });
    const newWorld = el("button", "item", s.newWorld);
    newWorld.addEventListener("click", () => {
      this.menu.hidden = true;
      this.confirm.hidden = false;
    });
    this.menu.append(sound, newWorld);
    host.append(this.menu);

    this.confirm = el("div", "sheet");
    this.confirm.hidden = true;
    this.confirm.setAttribute("role", "dialog");
    const confirmBox = el("div", "card");
    const yes = el("button", "danger", s.newWorldYes);
    yes.addEventListener("click", () => {
      this.confirm.hidden = true;
      actions.newWorld();
    });
    const no = el("button", "plain", s.cancel);
    no.addEventListener("click", () => (this.confirm.hidden = true));
    const row = el("div", "row");
    row.append(no, yes);
    confirmBox.append(el("p", "", s.newWorldConfirm), row);
    this.confirm.append(confirmBox);
    host.append(this.confirm);

    this.help = el("div", "sheet");
    this.help.hidden = true;
    this.help.setAttribute("role", "dialog");
    const helpBox = el("div", "card");
    helpBox.append(el("h2", "", s.helpTitle));
    const coarse = matchMedia("(pointer: coarse)").matches;
    const table = el("dl", "keys");
    for (const [key, what] of coarse ? s.helpTouch : s.helpKeys) table.append(el("dt", "", key), el("dd", "", what));
    const closeHelp = el("button", "plain", s.close);
    closeHelp.addEventListener("click", () => this.showHelp(false));
    helpBox.append(table, el("p", "note", s.helpTogether), closeHelp);
    this.help.append(helpBox);
    host.append(this.help);

    this.toast = el("div", "toast");
    this.toast.hidden = true;
    this.toast.setAttribute("role", "status");
    host.append(this.toast);

    this.blockName = el("div", "block-name");
    host.append(this.blockName);
    this.hotbar = el("div", "hotbar");
    PALETTE.forEach((block, i) => {
      const slot = el("button", "slot");
      slot.append(swatch(block));
      const key = i < 9 ? String(i + 1) : i === 9 ? "0" : "";
      if (key) slot.append(el("span", "key", key));
      const name = BLOCKS[block] ? s.blocks[BLOCKS[block]!.key] : "";
      slot.setAttribute("aria-label", name);
      slot.title = name;
      slot.addEventListener("click", () => actions.select(i));
      this.slots.push(slot);
      this.hotbar.append(slot);
    });
    host.append(this.hotbar);

    const touch = el("div", "touch");
    const stick = this.stick(s.stick);
    const hold = (label: string, text: string, key: Parameters<UiActions["hold"]>[0], area: string) => {
      const b = el("button", `hold ${area}`, text);
      b.setAttribute("aria-label", label);
      const down = (e: Event) => {
        e.preventDefault();
        actions.hold(key, true);
      };
      const up = () => actions.hold(key, false);
      b.addEventListener("pointerdown", down);
      b.addEventListener("pointerup", up);
      b.addEventListener("pointercancel", up);
      b.addEventListener("pointerleave", up);
      return b;
    };
    const side = el("div", "side");
    this.modeButton = el("button", "mode", "⛏");
    this.modeButton.setAttribute("aria-label", s.breakMode);
    this.modeButton.addEventListener("click", () => actions.toggleMode());
    this.flyButton = el("button", "fly", s.fly);
    this.flyButton.addEventListener("click", () => actions.toggleFly());
    side.append(this.modeButton, this.flyButton, hold(s.jump, "⤒", "jump", "jump"), hold(s.down, "⤓", "down", "sink"));
    touch.append(stick, side);
    host.append(touch);
  }

  /** The stick: a finger put anywhere on it walks towards where it is, from the centre; it follows that finger only. */
  private stick(label: string): HTMLElement {
    const base = el("div", "stick");
    base.setAttribute("role", "img");
    base.setAttribute("aria-label", label);
    const knob = el("div", "knob");
    base.append(knob);
    let finger: number | null = null;
    const follow = (e: PointerEvent) => {
      const box = base.getBoundingClientRect();
      const reading = readStick(e.clientX - (box.left + box.width / 2), e.clientY - (box.top + box.height / 2), box.width / 2);
      knob.style.transform = `translate(${Math.round(reading.knob[0])}px, ${Math.round(reading.knob[1])}px)`;
      this.actions.stick(reading.forward, reading.strafe);
    };
    const release = (e: PointerEvent) => {
      if (e.pointerId !== finger) return;
      finger = null;
      knob.style.transform = "";
      base.classList.remove("held");
      this.actions.stick(0, 0);
    };
    base.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (finger !== null) return;
      finger = e.pointerId;
      base.setPointerCapture?.(e.pointerId);
      base.classList.add("held");
      follow(e);
    });
    base.addEventListener("pointermove", (e) => {
      if (e.pointerId === finger) follow(e);
    });
    base.addEventListener("pointerup", release);
    base.addEventListener("pointercancel", release);
    base.addEventListener("lostpointercapture", release);
    return base;
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  notice(text: string, ms = 4000): void {
    this.toast.textContent = text;
    this.toast.hidden = false;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast.hidden = true), ms);
  }

  select(index: number, name: string): void {
    this.slots.forEach((slot, i) => slot.classList.toggle("selected", i === index));
    this.slots[index]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    this.blockName.textContent = name;
    this.blockName.classList.add("shown");
    if (this.nameTimer) clearTimeout(this.nameTimer);
    this.nameTimer = setTimeout(() => this.blockName.classList.remove("shown"), 1200);
  }

  setFlying(flying: boolean): void {
    this.flyButton.textContent = flying ? this.s.walk : this.s.fly;
    this.flyButton.classList.toggle("on", flying);
  }

  setPlacing(placing: boolean): void {
    this.modeButton.textContent = placing ? "▣" : "⛏";
    this.modeButton.setAttribute("aria-label", placing ? this.s.placeMode : this.s.breakMode);
    this.modeButton.classList.toggle("on", placing);
  }

  showHelp(shown: boolean): void {
    this.help.hidden = !shown;
    if (!shown) this.canvas.focus();
  }

  /** Puts the contact's name tag at a point of the screen, or hides it. */
  placeName(name: string, at: [number, number] | null): void {
    if (!at) {
      this.nameTag.hidden = true;
      return;
    }
    this.nameTag.hidden = false;
    if (this.nameTag.textContent !== name) this.nameTag.textContent = name;
    this.nameTag.style.transform = `translate(${Math.round(at[0])}px, ${Math.round(at[1])}px) translate(-50%, -100%)`;
  }

  /** A message over everything, when the world cannot be shown. */
  fatal(text: string): void {
    const box = el("div", "fatal", text);
    box.setAttribute("role", "alert");
    this.root.append(box);
  }

  get menuOpen(): boolean {
    return !this.menu.hidden || !this.confirm.hidden || !this.help.hidden;
  }

  closeMenus(): void {
    this.menu.hidden = true;
    this.confirm.hidden = true;
    this.showHelp(false);
  }
}
