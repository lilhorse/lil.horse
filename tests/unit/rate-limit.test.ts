import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../../src/notion/rate-limit';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('RateLimiter', () => {
  it('caps concurrency and spaces request starts', async () => {
    const limiter = new RateLimiter({ concurrency: 2, minIntervalMs: 25 });
    const starts: number[] = [];
    let running = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        limiter.schedule(async () => {
          starts.push(Date.now());
          running += 1;
          peak = Math.max(peak, running);
          await sleep(40);
          running -= 1;
        }),
      ),
    );
    expect(peak).toBeLessThanOrEqual(2);
    const sorted = [...starts].sort((a, b) => a - b);
    for (let index = 1; index < sorted.length; index += 1) {
      expect(sorted[index] - sorted[index - 1]).toBeGreaterThanOrEqual(20);
    }
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
