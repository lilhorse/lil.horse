export interface RateLimiterOptions {
  concurrency: number;
  minIntervalMs: number;
}

export class RateLimiter {
  readonly #concurrency: number;
  readonly #minIntervalMs: number;
  readonly #waiting: Array<() => void> = [];
  #active = 0;
  #nextStart = 0;

  constructor(options: RateLimiterOptions) {
    this.#concurrency = options.concurrency;
    this.#minIntervalMs = options.minIntervalMs;
  }

  async schedule<T>(task: () => Promise<T>): Promise<T> {
    await this.#acquire();
    try {
      return await task();
    } finally {
      this.#release();
    }
  }

  async #acquire(): Promise<void> {
    if (this.#active < this.#concurrency) this.#active += 1;
    else await new Promise<void>((resolve) => this.#waiting.push(resolve));
    const now = Date.now();
    const startAt = Math.max(now, this.#nextStart);
    this.#nextStart = startAt + this.#minIntervalMs;
    if (startAt > now) await new Promise((resolve) => setTimeout(resolve, startAt - now));
  }

  // Hands the slot straight to the next waiter so a newcomer cannot jump the queue.
  #release(): void {
    const next = this.#waiting.shift();
    if (next) next();
    else this.#active -= 1;
  }
}
