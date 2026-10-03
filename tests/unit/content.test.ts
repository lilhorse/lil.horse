import { beforeEach, describe, expect, it, vi } from 'vitest';

const astroContent = vi.hoisted(() => ({ getCollection: vi.fn(), getEntry: vi.fn() }));

vi.mock('astro:content', () => astroContent);

async function freshContent() {
  vi.resetModules();
  return import('../../src/lib/content');
}

beforeEach(() => {
  astroContent.getCollection.mockReset().mockResolvedValue([]);
  astroContent.getEntry.mockReset().mockResolvedValue({ data: { id: 'me', name: "Lil'Horse" } });
});

describe('getSiteData', () => {
  it('reads the collections once and shares the result', async () => {
    const { getSiteData } = await freshContent();
    const [first, second] = await Promise.all([getSiteData(), getSiteData()]);
    expect(second).toBe(first);
    expect(await getSiteData()).toBe(first);
    expect(astroContent.getEntry).toHaveBeenCalledOnce();
  });

  it('reads the collections again after a failed load', async () => {
    const { getSiteData } = await freshContent();
    astroContent.getCollection.mockRejectedValueOnce(new Error('The data store is unreadable'));
    await expect(getSiteData()).rejects.toThrow('The data store is unreadable');
    await expect(getSiteData()).resolves.toMatchObject({ profile: { name: "Lil'Horse" } });
  });
});
