/**
 * Every call to the broker goes through one limiter: the broker takes at most 50 requests a second from an app, storage
 * and chat frames counted together, and stops an app that sends ten times that. Boo Blocks keeps to `PER_SECOND` in any
 * one second, chat frames first, so a burst of storage writes never delays a frame to the contact and nothing is ever
 * refused as `too-fast`.
 */

export const PER_SECOND = 40;

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

type Job = { run: () => void };

export class Limiter {
  private readonly starts: number[] = [];
  private readonly queues: [Job[], Job[]] = [[], []];
  private pumping = false;

  constructor(
    private readonly clock: Clock = realClock,
    readonly perSecond = PER_SECOND,
  ) {}

  /** Runs `call` when the budget allows: `urgent` (chat frames) before the rest. */
  run<T>(call: () => Promise<T>, urgent = false): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queues[urgent ? 0 : 1].push({ run: () => call().then(resolve, reject) });
      void this.pump();
    });
  }

  /** Requests waiting. */
  get waiting(): number {
    return this.queues[0].length + this.queues[1].length;
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (;;) {
        const job = this.queues[0].shift() ?? this.queues[1].shift();
        if (!job) return;
        for (;;) {
          const now = this.clock.now();
          while (this.starts.length && this.starts[0] <= now - 1000) this.starts.shift();
          if (this.starts.length < this.perSecond) break;
          await this.clock.sleep(this.starts[0] + 1000 - now + 1);
        }
        this.starts.push(this.clock.now());
        job.run();
      }
    } finally {
      this.pumping = false;
    }
  }
}
