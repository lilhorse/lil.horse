import { afterEach, describe, expect, it, vi } from 'vitest';
import { RateLimiter } from '../../src/notion/rate-limit';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('RateLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('caps concurrency and spaces request starts', async () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter({ concurrency: 2, minIntervalMs: 25 });
    const starts: number[] = [];
    let running = 0;
    let peak = 0;
    const done = Promise.all(
      Array.from({ length: 6 }, () =>
        limiter.schedule(async () => {
          starts.push(Date.now());
          running += 1;
          peak = Math.max(peak, running);
          await sleep(100);
          running -= 1;
        }),
      ),
    );
    await vi.runAllTimersAsync();
    await done;
    expect(peak).toBe(2);
    expect(starts.map((start) => start - starts[0])).toEqual([0, 25, 100, 125, 200, 225]);
  });

  it('frees the slot when a task throws', async () => {
    const limiter = new RateLimiter({ concurrency: 1, minIntervalMs: 0 });
    await expect(
      limiter.schedule(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(limiter.schedule(async () => 'ok')).resolves.toBe('ok');
  });
});
