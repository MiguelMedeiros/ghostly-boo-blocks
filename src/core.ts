/**
 * Blocks without its picture: the world, its storage and the session with the contact, wired together. The page
 * (src/main.ts) draws it and feeds it the person's edits; the tests drive two of these over mock brokers.
 */
import type { MiniAppApi } from "./vendor/miniApp.ts";
import { Limiter, realClock, type Clock } from "./limiter.ts";
import { cleanName } from "./protocol.ts";
import { WorldStore } from "./store.ts";
import { Session, TICK_MS, type Contact, type PeerState } from "./sync.ts";
import { GENERATOR } from "./terrain.ts";
import { World, type WorldId } from "./world.ts";

export const FLUSH_MS = 1000;

export interface CoreHooks {
  /** A cell now holds another block (an edit from here, from the contact, or from storage after load). */
  onBlock?(cell: number, block: number): void;
  /** The whole world changed (another world was taken): draw it all again. */
  onWorld?(id: WorldId): void;
  onPeer?(state: PeerState, contact: Contact | null): void;
  onPose?(contact: Contact): void;
  /** The contact runs a Blocks too new for this one. */
  onIncompatible?(version: string): void;
}

export interface CoreOptions {
  clock?: Clock;
  tickMs?: number;
  flushMs?: number;
}

export class Core {
  readonly world = new World();
  readonly limiter: Limiter;
  readonly store: WorldStore;
  readonly session: Session;
  inChat = false;
  /** The world in storage was made by a later Blocks, which this one cannot draw: the page says to update. */
  newer = false;
  name?: string;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly api: MiniAppApi,
    private readonly hooks: CoreHooks = {},
    private readonly options: CoreOptions = {},
  ) {
    this.limiter = new Limiter(options.clock ?? realClock);
    this.store = new WorldStore(api, this.limiter, this.world);
    // Made before anything is awaited, so it hears the contact from the start.
    this.session = new Session(api, this.limiter, this.world, {
      onPeer: (state, contact) => hooks.onPeer?.(state, contact),
      onPose: (contact) => hooks.onPose?.(contact),
      onRemoteEdit: () => {},
      onIncompatible: (version) => hooks.onIncompatible?.(version),
      onWorldReplaced: async (id) => {
        this.world.reset(id);
        hooks.onWorld?.(id);
        await this.store.reset(id);
      },
    }, options.clock ? () => options.clock!.now() : undefined);
  }

  /** Reads the world and starts talking to the contact. */
  async open(): Promise<void> {
    const context = await this.limiter.run(() => this.api.context());
    this.inChat = context.inChat;
    this.name = cleanName(context.name);
    const loaded = await this.store.load();
    this.newer = loaded === "newer";
    this.world.onEdit = (cell) => this.store.track(cell);
    this.world.onChange = (cell, block) => this.hooks.onBlock?.(cell, block);
    this.hooks.onWorld?.(this.world.id);
    if (this.newer) return;
    this.session.start({ version: context.version, ...(this.name ? { name: this.name } : {}), inChat: context.inChat }, context.peer, this.options.tickMs ?? TICK_MS);
    this.flushTimer = setInterval(() => void this.store.flush(), this.options.flushMs ?? FLUSH_MS);
  }

  /** The person changes a block. False when nothing changed (the same block, or the world is full). */
  place(x: number, y: number, z: number, block: number): boolean {
    if (this.newer) return false;
    const done = this.world.edit(x, y, z, block);
    if (!done) return false;
    this.session.local(done.cell, done.stamp);
    return true;
  }

  /** Starts a new world, for both sides: a new seed, the epoch one higher. */
  async newWorld(seed = randomSeed()): Promise<void> {
    const id: WorldId = { generator: GENERATOR, seed, epoch: this.world.id.epoch + 1 };
    this.world.reset(id);
    this.hooks.onWorld?.(id);
    await this.store.reset(id);
    await this.session.restarted();
  }

  /** Stops the timers and writes what is left (when the page goes). */
  async close(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    this.session.stop();
    await this.store.flush();
  }
}

export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}
