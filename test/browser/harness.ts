/**
 * The built Blocks (dist/index.html) in real browsers, for the Playwright specs.
 *
 * Each side is a page that holds the app in `<iframe sandbox="allow-scripts">` with a `<meta>` CSP like the web
 * runner's, so what the runner forbids fails here too (every violation is recorded in `window.__violations`). The
 * frame's `window.ghostly` is a test broker whose every call goes to Node (exposeBinding): storage lives in Node, per
 * side, so it survives a reload as the client's does; frames go from one side to the other through Node, in order;
 * and Node says to each side when the other opened or closed the app.
 *
 * Nothing leaves the machine: the one URL is answered by page.route.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext, Frame, Page } from "@playwright/test";

export const ORIGIN = "http://blocks.test";
const dist = join(import.meta.dirname, "../../dist/index.html");

/** The web runner's CSP (WISP 1200), as far as a <meta> can carry it: inline script and style only, no network. */
export const RUNNER_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'";

export function builtPage(): string {
  return readFileSync(dist, "utf8");
}

function framedHost(html: string): string {
  const inner = html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${RUNNER_CSP}" />`);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;height:100%;background:#222}iframe{border:0;width:100%;height:100%;display:block}</style></head>
<body><iframe sandbox="allow-scripts" title="Blocks"></iframe><script>
document.querySelector("iframe").srcdoc = ${JSON.stringify(inner).replace(/<\//g, "<\\/")};
</script></body></html>`;
}

/** Runs in the frame before Blocks: the test broker. */
function installBroker(options: { inChat: boolean; name?: string; locale: string }): void {
  const w = window as unknown as Record<string, unknown> & Window;
  w.__violations = [] as string[];
  document.addEventListener("securitypolicyviolation", (e) => (w.__violations as string[]).push(`${e.violatedDirective} ${e.blockedURI}`));
  if (window === window.top) return;
  const listeners = { message: new Set<(d: unknown) => void>(), peer: new Set<(d: unknown) => void>() };
  const call = async (type: string, ...args: unknown[]) => {
    const answer = (await (w.__brokerCall as (t: string, a: unknown[]) => Promise<{ ok: boolean; value?: unknown; error?: string }>)(type, args)) ?? { ok: true };
    if (!answer.ok) throw new Error(answer.error);
    return answer.value;
  };
  w.__deliver = (data: unknown) => listeners.message.forEach((l) => l(data));
  w.__peerEvent = (event: unknown) => listeners.peer.forEach((l) => l(event));
  w.ghostly = {
    context: async () => ({ ...((await call("context")) as object), theme: "light", locale: options.locale, ...(options.name ? { name: options.name } : {}) }),
    file: async () => new ArrayBuffer(0),
    storage: {
      get: (key: string) => call("storage.get", key),
      set: (key: string, value: unknown) => call("storage.set", key, JSON.parse(JSON.stringify(value))),
      delete: (key: string) => call("storage.delete", key),
      keys: () => call("storage.keys"),
    },
    chat: {
      send: (value: unknown) => call("chat.send", JSON.parse(JSON.stringify(value))),
      on: (event: "message" | "peer", listener: (d: unknown) => void) => {
        listeners[event].add(listener);
        return () => listeners[event].delete(listener);
      },
    },
    close: async () => {},
  };
}

export interface Side {
  name: string;
  page: Page;
  context: BrowserContext;
  /** The frame Blocks runs in. */
  frame: Frame;
  /** This side's storage, kept in Node across reloads. */
  storage: Map<string, string>;
  /** Request times in the last second, and how many requests went past 50 in one second (must stay 0). */
  rate: number[];
  overLimit: number;
  open: boolean;
  /** Reloads the page: Blocks closes and opens again, with the same storage. */
  reload(): Promise<void>;
  close(): Promise<void>;
}

/** The sides of one chat (or one side alone), wired together. */
export class Chat {
  readonly sides = new Map<string, Side>();
  constructor(readonly browser: Browser) {}

  other(name: string): Side | undefined {
    return [...this.sides.values()].find((s) => s.name !== name);
  }

  async open(name: string, options: { inChat?: boolean; displayName?: string; locale?: string; viewport?: { width: number; height: number }; storage?: Map<string, string>; touch?: boolean } = {}): Promise<Side> {
    const inChat = options.inChat ?? true;
    const context = await this.browser.newContext({ viewport: options.viewport ?? { width: 900, height: 600 }, ...(options.touch ? { hasTouch: true, isMobile: true } : {}) });
    const page = await context.newPage();
    const html = framedHost(builtPage());
    await page.route(`${ORIGIN}/**`, (route) => route.fulfill({ contentType: "text/html", body: html }));
    const side: Side = {
      name,
      page,
      context,
      frame: null as unknown as Frame,
      storage: options.storage ?? new Map(),
      rate: [],
      overLimit: 0,
      open: false,
      reload: async () => {
        this.closed(side);
        await page.reload();
        await this.ready(side);
      },
      close: async () => {
        this.closed(side);
        this.sides.delete(name);
        await context.close();
      },
    };
    this.sides.set(name, side);
    await page.exposeBinding("__brokerCall", async ({ frame }, type: string, args: unknown[]) => {
      side.frame = frame;
      const now = Date.now();
      side.rate = side.rate.filter((t) => t > now - 1000);
      side.rate.push(now);
      if (side.rate.length > 50) side.overLimit++;
      const peer = this.other(name);
      switch (type) {
        case "context":
          if (!side.open) {
            side.open = true;
            if (peer?.open) void peer.frame.evaluate((v) => (window as unknown as { __peerEvent(e: unknown): void }).__peerEvent({ open: true, version: v }), "0.1.0").catch(() => {});
          }
          return { ok: true, value: { version: "0.1.0", inChat, peer: inChat && peer?.open ? { version: "0.1.0" } : null } };
        case "storage.get":
          return { ok: true, value: side.storage.has(args[0] as string) ? JSON.parse(side.storage.get(args[0] as string)!) : undefined };
        case "storage.set":
          side.storage.set(args[0] as string, JSON.stringify(args[1]));
          return { ok: true };
        case "storage.delete":
          side.storage.delete(args[0] as string);
          return { ok: true };
        case "storage.keys":
          return { ok: true, value: [...side.storage.keys()] };
        case "chat.send": {
          if (!inChat) return { ok: false, error: "not-allowed" };
          if (!peer?.open) return { ok: false, error: "peer-closed" };
          if (JSON.stringify(args[0]).length > 32 * 1024) return { ok: false, error: "too-large" };
          await peer.frame.evaluate((d) => (window as unknown as { __deliver(d: unknown): void }).__deliver(d), args[0]).catch(() => {});
          return { ok: true };
        }
      }
      return { ok: false, error: "unknown-type" };
    });
    await page.addInitScript(installBroker, { inChat, locale: options.locale ?? "en", ...(options.displayName ? { name: options.displayName } : {}) });
    await page.goto(`${ORIGIN}/`);
    await this.ready(side);
    return side;
  }

  private closed(side: Side): void {
    if (!side.open) return;
    side.open = false;
    const peer = this.other(side.name);
    if (peer?.open) void peer.frame.evaluate(() => (window as unknown as { __peerEvent(e: unknown): void }).__peerEvent({ open: false })).catch(() => {});
  }

  private async ready(side: Side): Promise<void> {
    const frame = side.page.frames().find((f) => f !== side.page.mainFrame());
    if (!frame) throw new Error("no frame");
    side.frame = frame;
    await frame.waitForSelector("#app[data-state]", { timeout: 30_000 });
  }
}

/** A data attribute of the app's root, in a side's frame. */
export const appData = (side: Side, name: string) => side.frame.getAttribute("#app", `data-${name}`);
