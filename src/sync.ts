/**
 * Building together: the frames of src/protocol.ts over the chat, while both sides have Boo Blocks open.
 *
 * - When the contact opens Boo Blocks (or this side opens it while the contact has it open), both send `hello`: which
 *   world each has and a hash per section. If the worlds differ, the older one is dropped for the newer
 *   (src/world.ts, `newerWorld`) and that side says hello again. Then each side sends every section whose hash
 *   differs from the contact's, and merges what it gets cell by cell. Both end with the union of both sides' edits.
 * - While both are in, edits and where the person stands go in a `tick`, ten a second at most.
 *
 * A frame that does not go (the contact left, the chat went offline) is not kept: the next hello finds what differs.
 */
import type { MiniAppApi, MiniAppJson, MiniAppPeerEvent } from "./vendor/miniApp.ts";
import { miniAppErrorCode } from "./vendor/miniApp.ts";
import { encodePage, encodeSection, RECORDS_PER_FRAME } from "./codec.ts";
import type { Limiter } from "./limiter.ts";
import { parseFrame, PROTOCOL, tagOf, type Incoming, type Pose } from "./protocol.ts";
import { GENERATOR } from "./terrain.ts";
import { cellOfLocal, localOf, newerWorld, SECTION_COUNT, sameWorld, type World, type WorldId } from "./world.ts";

export const TICK_MS = 100;
/** Section frames sent a second at most while catching up (ticks keep their own ten). */
export const SECTION_FRAMES_PER_SECOND = 20;
/** How long to wait before asking again after a frame did not go for want of room. */
export const RETRY_MS = 2000;

export type PeerState = "alone" | "waiting" | "here";

export interface Contact {
  version: string;
  name?: string;
  pose?: Pose;
  /** When the last pose came (ms, performance.now). */
  poseAt?: number;
}

export interface SessionEvents {
  /** The contact came, went, or said who they are. */
  onPeer(state: PeerState, contact: Contact | null): void;
  /** The contact moved. */
  onPose(contact: Contact): void;
  /** The world was replaced by the contact's newer one: everything must be drawn again and stored anew. */
  onWorldReplaced(id: WorldId): Promise<void>;
  /** A cell's stamp changed by a contact's edit (to store it). */
  onRemoteEdit(cell: number): void;
  /** The contact runs a Boo Blocks that speaks a newer protocol than this one can. */
  onIncompatible(version: string): void;
}

export class Session {
  state: PeerState;
  contact: Contact | null = null;
  /** Edits made here and not sent yet. */
  private outbox: [number, number][] = [];
  private pose: Pose | null = null;
  private poseSent: Pose | null = null;
  private poseSentAt = 0;
  private helloSent = false;
  private readonly sectionQueue: number[] = [];
  private sectionPump: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private readonly unsubscribe: (() => void)[] = [];
  /** Frames sent and received, for the tests and the status line. */
  readonly counts = { sent: 0, received: 0, dropped: 0 };

  /** Who this side is: set by start(). */
  private me: { version: string; name?: string; inChat: boolean } = { version: "", inChat: false };
  /** What came before start(): replayed by it, in order. */
  private early: (() => void)[] | null = [];

  constructor(
    private readonly api: MiniAppApi,
    private readonly limiter: Limiter,
    private readonly world: World,
    private readonly events: SessionEvents,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.state = "waiting";
    // Listen first, before anything is awaited, so no frame from the contact is missed; held until start().
    this.unsubscribe.push(api.chat.on("message", (data) => this.later(() => void this.receive(data))));
    this.unsubscribe.push(api.chat.on("peer", (event) => this.later(() => this.peerEvent(event))));
  }

  private later(run: () => void): void {
    if (this.early) this.early.push(run);
    else run();
  }

  /**
   * Starts: who this side is, whether the contact has Boo Blocks open already (context().peer), and the ticks. What
   * arrived before is handled now, in order.
   */
  start(me: { version: string; name?: string; inChat: boolean }, peerOpen: { version: string } | null, tickMs = TICK_MS): void {
    this.me = me;
    const early = this.early ?? [];
    this.early = null;
    if (!me.inChat) {
      this.state = "alone";
      this.stop();
      return;
    }
    this.timer = setInterval(() => void this.tick(), tickMs);
    if (peerOpen) this.peerEvent({ open: true, version: peerOpen.version });
    for (const run of early) run();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.retry) clearTimeout(this.retry);
    this.timer = null;
    this.retry = null;
    for (const off of this.unsubscribe.splice(0)) off();
  }

  /** An edit made here. */
  local(cell: number, stamp: number): void {
    if (this.state === "here") this.outbox.push([cell, stamp]);
  }

  /** Where this side's person is. */
  move(pose: Pose): void {
    this.pose = pose;
  }

  /** This side started a new world: the contact is told at once. */
  async restarted(): Promise<void> {
    this.outbox = [];
    this.sectionQueue.length = 0;
    this.helloSent = false;
    if (this.state === "here") await this.sayHello();
  }

  private peerEvent(event: MiniAppPeerEvent): void {
    if (event.open) {
      this.contact = { version: event.version, ...(this.contact?.name ? { name: this.contact.name } : {}) };
      this.state = "here";
      this.helloSent = false;
      this.outbox = [];
      this.events.onPeer(this.state, this.contact);
      void this.sayHello();
    } else {
      this.state = "waiting";
      this.contact = null;
      this.outbox = [];
      this.sectionQueue.length = 0;
      this.events.onPeer(this.state, null);
    }
  }

  private async send(value: MiniAppJson): Promise<boolean> {
    try {
      await this.limiter.run(() => this.api.chat.send(value), true);
      this.counts.sent++;
      return true;
    } catch (error) {
      const code = miniAppErrorCode(error);
      if (code === "peer-closed" || code === "offline" || code === "not-open") {
        // The contact is gone for now; the next hello catches up.
        this.outbox = [];
        this.sectionQueue.length = 0;
        // "offline" also answers a frame the chat's channel had no room for while the contact is still here (a
        // catch-up of many sections on a slow link). If they are still here in a moment, ask again for the
        // contact's hashes: whatever did not go is found and sent then. A real disconnection ends in a peer event.
        if (code === "offline") this.retryLater();
      }
      return false;
    }
  }

  private retryLater(): void {
    if (this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      if (this.state === "here" && this.timer) void this.sayHello(true);
    }, RETRY_MS);
  }

  /** Says hello; `ask` asks the contact to answer with theirs, even if they already said it on this open. */
  private async sayHello(ask = false): Promise<void> {
    this.helloSent = true;
    const hello = { t: "hello", p: PROTOCOL, v: this.me.version, ...(this.me.name ? { n: this.me.name } : {}), w: tagOf(this.world.id), h: this.world.hashes32(), ...(ask ? { a: 1 } : {}) };
    if (!(await this.send(hello))) this.helloSent = false;
  }

  private async receive(data: MiniAppJson): Promise<void> {
    const frame = parseFrame(data);
    if (!frame) {
      this.counts.dropped++;
      return;
    }
    this.counts.received++;
    if (this.state !== "here" && frame.t === "hello") {
      // A hello can come before the peer event that says the contact opened: the hello says it. Other frames late
      // from a contact who left change the world (merging is safe) but not who is here.
      this.state = "here";
      this.contact ??= { version: frame.version };
      this.events.onPeer(this.state, this.contact);
    }
    if (frame.t === "hello") return this.hello(frame);
    if (!sameWorld(frame.world, this.world.id)) return;
    if (frame.t === "sec") {
      for (const [local, stamp] of frame.edits) this.remote(cellOfLocal(frame.section, local), stamp);
    } else {
      for (const [cell, stamp] of frame.edits) this.remote(cell, stamp);
      if (frame.pose && this.contact && this.state === "here") {
        this.contact.pose = frame.pose;
        this.contact.poseAt = this.now();
        this.events.onPose(this.contact);
      }
    }
  }

  private remote(cell: number, stamp: number): void {
    if (this.world.apply(cell, stamp) === true) this.events.onRemoteEdit(cell);
  }

  private async hello(frame: Extract<Incoming, { t: "hello" }>): Promise<void> {
    this.contact = { ...this.contact, version: frame.version, ...(frame.name ? { name: frame.name } : {}) };
    this.events.onPeer(this.state, this.contact);
    if (frame.protocol > PROTOCOL || frame.world.generator > GENERATOR) {
      // A later protocol says so by raising `p`, and a later ground by its generator: this side cannot follow until
      // it updates, and keeps its own world meanwhile.
      this.events.onIncompatible(frame.version);
      return;
    }
    if (!sameWorld(frame.world, this.world.id)) {
      const keep = newerWorld(frame.world, this.world.id);
      if (keep === this.world.id) {
        // The contact drops theirs for this one and says hello again; answer theirs if this side has not spoken yet.
        if (!this.helloSent) await this.sayHello();
        return;
      }
      this.outbox = [];
      this.sectionQueue.length = 0;
      await this.events.onWorldReplaced(frame.world);
      await this.sayHello();
      return;
    }
    if (!this.helloSent || frame.ask) await this.sayHello();
    for (let s = 0; s < SECTION_COUNT; s++) {
      if (frame.hashes[s] !== this.world.sectionHash(s) && this.world.sectionHash(s) !== 0 && !this.sectionQueue.includes(s)) this.sectionQueue.push(s);
    }
    this.sectionPump ??= this.pumpSections().finally(() => (this.sectionPump = null));
  }

  private async pumpSections(): Promise<void> {
    const gap = 1000 / SECTION_FRAMES_PER_SECOND;
    for (;;) {
      const section = this.sectionQueue.shift();
      if (section === undefined || this.state !== "here") return;
      const entries = this.world.sectionEdits(section).map(([cell, stamp]): [number, number] => [localOf(cell), stamp]);
      for (let i = 0; i < entries.length; i += RECORDS_PER_FRAME) {
        const started = this.now();
        const ok = await this.send({ t: "sec", w: tagOf(this.world.id), k: section, e: encodeSection(entries.slice(i, i + RECORDS_PER_FRAME)) });
        if (!ok) return;
        const wait = gap - (this.now() - started);
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  }

  /** One tick: the edits made since the last, and the pose when it moved (or once a second, so the contact sees it). */
  async tick(): Promise<void> {
    if (this.state !== "here") return;
    const now = this.now();
    const moved = this.pose && (!this.poseSent || this.pose.some((v, i) => Math.abs(v - this.poseSent![i]) > 0.01) || now - this.poseSentAt > 1000);
    if (!moved && !this.outbox.length) return;
    const edits = this.outbox.splice(0, RECORDS_PER_FRAME);
    const frame: { [key: string]: MiniAppJson } = { t: "tick", w: tagOf(this.world.id) };
    if (moved && this.pose) {
      frame.p = this.pose.map((v) => Math.round(v * 1000) / 1000);
      this.poseSent = this.pose;
      this.poseSentAt = now;
    }
    if (edits.length) frame.e = encodePage(edits);
    await this.send(frame);
  }
}
