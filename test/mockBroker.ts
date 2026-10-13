/**
 * A stand-in for the client's broker, with the WISP 1200 rules Boo Blocks depends on: storage per app and per chat with
 * its limits (a key, a value, 5 MiB counting 128 bytes a key), `chat.send` only while both sides have the app open,
 * delivered in order, asynchronously and as a copy, at most 32 KiB a frame, and **at most 50 requests a second for
 * all calls together**: one more and the call fails with `too-fast`, and `overLimit` counts it, so a test fails if
 * Boo Blocks ever bursts. Refusals reject with an Error whose message is the WISP's code, as in the runner.
 */
import { MINI_APP_LIMITS, type MiniAppApi, type MiniAppContext, type MiniAppJson, type MiniAppPeerEvent } from "../src/vendor/miniApp.ts";

const bytes = (text: string) => new TextEncoder().encode(text).length;

/** Strict JSON, as the client's broker takes it. */
export function strictJson(value: unknown): boolean {
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(strictJson);
  if (typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  return Object.values(value).every(strictJson);
}

const refuse = (code: string) => Promise.reject(new Error(code));

export class MockBroker implements MiniAppApi {
  readonly stored = new Map<string, string>();
  readonly sent: MiniAppJson[] = [];
  peer: MockBroker | null = null;
  isOpen = false;
  /** The chat's session is live. */
  online = true;
  /** Requests past 50 in one second. */
  overLimit = 0;
  /** Requests in all. */
  requests = 0;
  /** Milliseconds a frame takes to arrive. */
  latency = 0;
  /** Return true to refuse a frame with "offline" while the contact is still there (a full channel). */
  noRoom: (value: MiniAppJson) => boolean = () => false;
  /** Return true to lose a frame on its way (as when the session drops). */
  drop: (value: MiniAppJson) => boolean = () => false;
  displayName: string | undefined;
  /** The storage scope's room (5 MiB unless a test makes it smaller). */
  storageBytes: number = MINI_APP_LIMITS.storageScopeBytes;
  private starts: number[] = [];
  private messageListeners = new Set<(data: MiniAppJson) => void>();
  private peerListeners = new Set<(peer: MiniAppPeerEvent) => void>();
  private incoming: Promise<void> = Promise.resolve();

  constructor(
    readonly name: string,
    public version = "0.1.0",
    readonly inChat = true,
  ) {}

  private count(): string | null {
    this.requests++;
    const now = Date.now();
    this.starts = this.starts.filter((t) => t > now - 1000);
    this.starts.push(now);
    if (this.starts.length > MINI_APP_LIMITS.requestsPerSecond) {
      this.overLimit++;
      return "too-fast";
    }
    return null;
  }

  /** Bytes the scope holds, as the broker counts them. */
  usedBytes(skip?: string): number {
    let total = 0;
    for (const [k, v] of this.stored) if (k !== skip) total += bytes(k) + bytes(v) + MINI_APP_LIMITS.storageRowBytes;
    return total;
  }

  async context(): Promise<MiniAppContext> {
    const busy = this.count();
    if (busy) return refuse(busy);
    const context: MiniAppContext = { version: this.version, inChat: this.inChat, peer: this.peer?.isOpen && this.online ? { version: this.peer.version } : null };
    if (this.displayName !== undefined) context.name = this.displayName;
    return context;
  }

  async file(): Promise<ArrayBuffer> {
    return refuse("no-file");
  }

  storage = {
    get: async (key: string): Promise<MiniAppJson | undefined> => {
      const busy = this.count();
      if (busy) return refuse(busy);
      const text = this.stored.get(key);
      return text === undefined ? undefined : (JSON.parse(text) as MiniAppJson);
    },
    set: async (key: string, value: MiniAppJson): Promise<void> => {
      const busy = this.count();
      if (busy) return refuse(busy);
      if (!key || bytes(key) > MINI_APP_LIMITS.storageKeyBytes) return refuse("bad-key");
      if (!strictJson(value)) return refuse("bad-request");
      const text = JSON.stringify(value);
      if (bytes(text) > MINI_APP_LIMITS.storageValueBytes) return refuse("too-large");
      const after = this.usedBytes(key) + bytes(key) + bytes(text) + MINI_APP_LIMITS.storageRowBytes;
      if (after > this.storageBytes && after > this.usedBytes()) return refuse("full");
      this.stored.set(key, text);
    },
    delete: async (key: string): Promise<void> => {
      const busy = this.count();
      if (busy) return refuse(busy);
      this.stored.delete(key);
    },
    keys: async (): Promise<string[]> => {
      const busy = this.count();
      if (busy) return refuse(busy);
      return [...this.stored.keys()];
    },
  };

  chat = {
    send: async (value: MiniAppJson): Promise<void> => {
      const busy = this.count();
      if (busy) return refuse(busy);
      if (!this.inChat) return refuse("not-allowed");
      if (!this.isOpen) return refuse("not-open");
      if (!this.online || this.noRoom(value)) return refuse("offline");
      const peer = this.peer;
      if (!peer?.isOpen) return refuse("peer-closed");
      if (!strictJson(value)) return refuse("bad-request");
      const text = JSON.stringify(value);
      if (bytes(text) > MINI_APP_LIMITS.chatDataBytes) return refuse("too-large");
      this.sent.push(value);
      if (this.drop(value)) return;
      peer.deliver(JSON.parse(text) as MiniAppJson, this.latency);
    },
    on: ((event: "message" | "peer", listener: (data: never) => void) => {
      const set = (event === "message" ? this.messageListeners : this.peerListeners) as Set<(data: never) => void>;
      set.add(listener);
      return () => set.delete(listener);
    }) as MiniAppApi["chat"]["on"],
  };

  async close(): Promise<void> {
    this.shutdown();
  }

  /** The person opens the app in this chat. */
  launch(): void {
    this.isOpen = true;
    if (this.peer?.isOpen) this.peer.emitPeer({ open: true, version: this.version });
  }

  /** The app closes (or the page reloads): its listeners go, frames still on their way to it are lost. */
  shutdown(): void {
    this.isOpen = false;
    this.messageListeners.clear();
    this.peerListeners.clear();
    this.peer?.emitPeer({ open: false });
  }

  /** A frame as a hostile contact might send it. */
  inject(value: unknown): void {
    this.deliver(value as MiniAppJson, 0);
  }

  private deliver(value: MiniAppJson, latency: number): void {
    this.incoming = this.incoming.then(async () => {
      await new Promise((resolve) => setTimeout(resolve, latency));
      if (!this.isOpen) return;
      for (const listener of [...this.messageListeners]) listener(value);
    });
  }

  emitPeer(event: MiniAppPeerEvent): void {
    if (!this.isOpen) return;
    for (const listener of [...this.peerListeners]) listener(event);
  }

  /** Waits until every frame on its way to this side has arrived. */
  settled(): Promise<void> {
    return this.incoming;
  }
}

/** Two sides of one chat. */
export function pairBrokers(a = new MockBroker("ana"), b = new MockBroker("bob")): [MockBroker, MockBroker] {
  a.peer = b;
  b.peer = a;
  return [a, b];
}
