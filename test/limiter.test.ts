import { describe, expect, it } from "vitest";
import { Limiter } from "../src/limiter.ts";

describe("limiter", () => {
  it("starts at most perSecond calls in any second, urgent ones first", async () => {
    let now = 0;
    const clock = { now: () => now, sleep: async (ms: number) => void (now += ms) };
    const limiter = new Limiter(clock, 4);
    const order: string[] = [];
    const starts: number[] = [];
    const jobs = [];
    for (let i = 0; i < 6; i++) jobs.push(limiter.run(async () => void (order.push(`s${i}`), starts.push(now))));
    jobs.push(limiter.run(async () => void (order.push("chat"), starts.push(now)), true));
    await Promise.all(jobs);
    // Four started at once and the fifth was waiting for the budget when the urgent one came: it goes before the sixth.
    expect(order).toEqual(["s0", "s1", "s2", "s3", "s4", "chat", "s5"]);
    for (let i = 0; i < starts.length; i++) expect(starts.filter((t) => t > starts[i] - 1000 && t <= starts[i]).length).toBeLessThanOrEqual(4);
    expect(now).toBeGreaterThan(1000);
  });
});
