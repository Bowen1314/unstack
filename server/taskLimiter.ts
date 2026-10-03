import { HttpError } from './http.ts';

/**
 * A per-server sliding-window limit on paid tasks (UNSTACK_MAX_TASKS_PER_HOUR).
 * This sits above the unit ledger: even with units left, a runaway client
 * can't start more than `max` tasks an hour. Request pacing toward YouCam
 * itself is RateLimiter's job (server/youcam/rateLimiter.ts).
 */
export class TaskLimiter {
  private readonly stamps: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs = 3_600_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Record one task, or throw HttpError 429 if the window is full. */
  take(): void {
    const t = this.now();
    while (this.stamps.length > 0 && t - this.stamps[0]! >= this.windowMs) this.stamps.shift();
    if (this.stamps.length >= this.max) {
      const waitMin = Math.max(1, Math.ceil((this.windowMs - (t - this.stamps[0]!)) / 60_000));
      throw new HttpError(429, 'RateLimited', `This server allows ${this.max} paid tasks an hour.`, `Try again in about ${waitMin} minute${waitMin === 1 ? '' : 's'}.`);
    }
    this.stamps.push(t);
  }

  /** Give back the last slot (the task was refused before it reached YouCam). */
  giveBack(): void {
    this.stamps.pop();
  }
}
