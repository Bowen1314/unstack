/**
 * Client-side pacing for the documented limits: 250 requests per 300 s per IP
 * and per token, about 5 QPS recommended. We stay below both: at most `qps`
 * requests per second and `windowMax` requests per sliding `windowMs`.
 */
export class RateLimiter {
  private readonly stamps: number[] = [];
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly qps = 4,
    private readonly windowMax = 200,
    private readonly windowMs = 300_000,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** Resolves when the caller may send one request. Calls are serialised. */
  acquire(): Promise<void> {
    const next = this.chain.then(() => this.waitTurn());
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async waitTurn(): Promise<void> {
    for (;;) {
      const t = this.now();
      while (this.stamps.length > 0 && t - this.stamps[0]! >= this.windowMs) this.stamps.shift();
      const lastSecond = this.stamps.filter((s) => t - s < 1000).length;
      if (this.stamps.length < this.windowMax && lastSecond < this.qps) {
        this.stamps.push(t);
        return;
      }
      const waitWindow = this.stamps.length >= this.windowMax ? this.windowMs - (t - this.stamps[0]!) : 0;
      const recent = this.stamps.filter((s) => t - s < 1000);
      const waitSecond = lastSecond >= this.qps ? 1000 - (t - recent[0]!) : 0;
      await this.sleep(Math.max(waitWindow, waitSecond, 10));
    }
  }

  get used(): number {
    return this.stamps.length;
  }
}
