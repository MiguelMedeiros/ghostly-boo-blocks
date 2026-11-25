/**
 * The page around the world: the status line, the hotbar, the menu, the help, short notices, the contact's name tag,
 * and buttons for touch screens. Built with createElement and textContent only: the contact's name is never markup.
 */
import { BLOCKS, PALETTE } from "./blocks.ts";
import { drawTile, TILE_PX } from "./render/atlas.ts";
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

/** The least time between two hints (Q or E doing nothing). */
export const HINT_GAP_MS = 1500;

export interface UiActions {
  select(index: number): void;
  newWorld(): void;
  toggleSound(): boolean;
  toggleFly(): void;
  toggleMode(): void;
  /** A touch button held or let go. */
  hold(key: "forward" | "back" | "left" | "right" | "jump" | "down", down: boolean): void;
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
  private readonly menuButton: HTMLButtonElement;
  private readonly confirm: HTMLElement;
  private readonly closeHelp: HTMLButtonElement;
  private readonly flyButton: HTMLButtonElement;
  private readonly modeButton: HTMLButtonElement;
  readonly nameTag: HTMLElement;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private toastIsHint = false;
  private hintAt = -Infinity;
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
    // An application: a screen reader passes W A S D, Q, E, the arrows and Space to the game instead of taking them
    // for its own reading keys. The name says which keys do what, since the world itself says nothing.
    this.canvas.setAttribute("role", "application");
    this.canvas.setAttribute("aria-roledescription", s.worldRole);
    this.canvas.setAttribute("aria-label", s.worldLabel);
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
    helpButton.addEventListener("click", () => this.showHelp(true, true));
    const menuButton = el("button", "round", "⋯");
    menuButton.setAttribute("aria-label", s.menu);
    menuButton.title = s.menu;
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.addEventListener("click", (e) => {
      const shown = this.menu.hidden === true;
      this.showMenu(shown);
      // Closed with a pointer (detail > 0), the world has the keyboard again: ⋯ left focused takes Space and Enter and
      // opens the menu again, so the person could not jump or fly up. Closed by keyboard, the focus stays on ⋯.
      if (!shown && e.detail > 0) this.canvas.focus();
    });
    this.menuButton = menuButton;
    buttons.append(helpButton, menuButton);
    top.append(this.status, buttons);
    host.append(top);

    this.menu = el("div", "menu");
    this.menu.hidden = true;
    // A toggle: named "Sound" with its state in aria-pressed, as ✓ and ✗ read out as "check mark" and "multiplication x".
    const sound = el("button", "item", `${s.sound}: ✓`);
    sound.setAttribute("aria-label", s.sound);
    sound.setAttribute("aria-pressed", "true");
    sound.addEventListener("click", () => {
      const on = actions.toggleSound();
      sound.textContent = `${s.sound}: ${on ? "✓" : "✗"}`;
      sound.setAttribute("aria-pressed", String(on));
    });
    const newWorld = el("button", "item", s.newWorld);
    newWorld.addEventListener("click", () => {
      this.showMenu(false);
      this.confirm.hidden = false;
      no.focus();
    });
    this.menu.append(sound, newWorld);
    host.append(this.menu);

    // Both dialogs are named for a screen reader, and modal: the world behind them takes no keys while one is open.
    this.confirm = el("div", "sheet");
    this.confirm.hidden = true;
    this.confirm.setAttribute("role", "dialog");
    this.confirm.setAttribute("aria-modal", "true");
    this.confirm.setAttribute("aria-label", s.newWorld);
    const confirmBox = el("div", "card");
    const yes = el("button", "danger", s.newWorldYes);
    yes.addEventListener("click", () => {
      this.closeConfirm();
      actions.newWorld();
    });
    const no = el("button", "plain", s.cancel);
    no.addEventListener("click", () => this.closeConfirm());
    const row = el("div", "row");
    row.append(no, yes);
    const question = el("p", "", s.newWorldConfirm);
    question.id = "new-world-question";
    this.confirm.setAttribute("aria-describedby", question.id);
    confirmBox.append(question, row);
    this.confirm.append(confirmBox);
    keepTab(this.confirm);
    host.append(this.confirm);

    this.help = el("div", "sheet");
    this.help.hidden = true;
    this.help.setAttribute("role", "dialog");
    this.help.setAttribute("aria-modal", "true");
    const helpBox = el("div", "card");
    const helpTitle = el("h2", "", s.helpTitle);
    helpTitle.id = "help-title";
    this.help.setAttribute("aria-labelledby", helpTitle.id);
    helpBox.append(helpTitle);
    const coarse = matchMedia("(pointer: coarse)").matches;
    const table = el("dl", "keys");
    for (const [key, what] of coarse ? s.helpTouch : s.helpKeys) table.append(el("dt", "", key), el("dd", "", what));
    const closeHelp = el("button", "plain", s.close);
    this.closeHelp = closeHelp;
    closeHelp.addEventListener("click", () => this.showHelp(false));
    helpBox.append(table);
    if (!coarse) helpBox.append(el("p", "note", s.helpLayout));
    helpBox.append(el("p", "note", s.helpTogether), closeHelp);
    this.help.append(helpBox);
    keepTab(this.help);
    host.append(this.help);

    // Always in the page, and empty (so unseen) between notices: a live region that appears together with its text
    // is often not read out, so a notice must only ever change the text of a region already there.
    this.toast = el("div", "toast");
    this.toast.setAttribute("role", "status");
    host.append(this.toast);

    // For the eye only: a screen reader hears the pick from the slot's aria-pressed.
    this.blockName = el("div", "block-name");
    this.blockName.setAttribute("aria-hidden", "true");
    host.append(this.blockName);
    this.hotbar = el("div", "hotbar");
    PALETTE.forEach((block, i) => {
      const slot = el("button", "slot");
      slot.append(swatch(block));
      const key = i < 9 ? String(i + 1) : i === 9 ? "0" : "";
      // The digit drawn on the slot is its key: a screen reader says it as the slot's shortcut.
      if (key) {
        slot.append(el("span", "key", key));
        slot.setAttribute("aria-keyshortcuts", key);
      }
      const name = BLOCKS[block] ? s.blocks[BLOCKS[block]!.key] : "";
      slot.setAttribute("aria-label", name);
      slot.setAttribute("aria-pressed", "false");
      slot.title = name;
      slot.addEventListener("click", (e) => {
        actions.select(i);
        // Picked with a pointer (detail > 0), the world has the keyboard again: a slot left focused takes Space and
        // Enter for itself, so the person could not jump or fly up. Picked by keyboard, the focus stays on the slot.
        if (e.detail > 0) this.canvas.focus();
      });
      this.slots.push(slot);
      this.hotbar.append(slot);
    });
    host.append(this.hotbar);

    const touch = el("div", "touch");
    const pad = el("div", "pad");
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
    pad.append(hold(s.moveForward, "▲", "forward", "up"), hold(s.moveLeft, "◀", "left", "left"), hold(s.moveRight, "▶", "right", "right"), hold(s.moveBack, "▼", "back", "down"));
    const side = el("div", "side");
    this.modeButton = el("button", "mode", "⛏");
    this.modeButton.setAttribute("aria-label", s.breakMode);
    this.modeButton.addEventListener("click", () => actions.toggleMode());
    this.flyButton = el("button", "fly", s.fly);
    this.flyButton.addEventListener("click", () => actions.toggleFly());
    side.append(this.modeButton, this.flyButton, hold(s.jump, "⤒", "jump", "jump"), hold(s.down, "⤓", "down", "sink"));
    touch.append(pad, side);
    host.append(touch);
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  notice(text: string, ms = 4000): void {
    this.show(text, ms, false);
  }

  /**
   * A short line for a key that did nothing (Q or E with nothing in reach). At most one every HINT_GAP_MS, so tapping
   * the key does not fill the screen reader's queue, and never over a notice still showing.
   */
  hint(text: string): void {
    const now = Date.now();
    if (now - this.hintAt < HINT_GAP_MS || (this.toast.textContent && !this.toastIsHint)) return;
    this.hintAt = now;
    this.show(text, 2000, true);
  }

  private show(text: string, ms: number, hint: boolean): void {
    this.toast.textContent = text;
    this.toastIsHint = hint;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast.textContent = ""), ms);
  }

  select(index: number, name: string): void {
    this.slots.forEach((slot, i) => {
      slot.classList.toggle("selected", i === index);
      slot.setAttribute("aria-pressed", String(i === index));
    });
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

  /**
   * Shows or hides the help. Opened by the person (`takeFocus`), Close takes the keyboard; on a first open it does
   * not, so the page never takes the focus from the chat around it. Closed, the world has the keyboard again.
   */
  showHelp(shown: boolean, takeFocus = false): void {
    this.help.hidden = !shown;
    if (shown && takeFocus) this.closeHelp.focus();
    if (!shown) this.canvas.focus();
  }

  private closeConfirm(): void {
    if (this.confirm.hidden) return;
    this.confirm.hidden = true;
    this.canvas.focus();
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

  /** Opens or closes the ⋯ menu; its button says which (aria-expanded). */
  private showMenu(shown: boolean): void {
    this.menu.hidden = !shown;
    this.menuButton.setAttribute("aria-expanded", String(shown));
  }

  closeMenus(): void {
    this.showMenu(false);
    this.closeConfirm();
    this.showHelp(false);
  }
}

/** Tab and Shift+Tab go round a modal dialog's buttons and never on to the world's controls behind it. */
function keepTab(dialog: HTMLElement): void {
  dialog.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const buttons = [...dialog.querySelectorAll("button")];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at === -1) return;
    e.preventDefault();
    buttons[(at + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus();
  });
}
