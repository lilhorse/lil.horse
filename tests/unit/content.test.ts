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

  it('indexes the tags of listed posts', async () => {
    const { getSiteData } = await freshContent();
    astroContent.getCollection.mockImplementation(async (name: string) =>
      name === 'posts'
        ? [
            {
              data: {
                id: 'a',
                slug: 'a',
                status: 'Published',
                published: '2024-01-01',
                tags: ['AI'],
              },
            },
          ]
        : [],
    );
    const site = await getSiteData();
    expect(site.tags.map((tag) => [tag.slug, tag.name])).toEqual([['ai', 'AI']]);
    expect([...site.tagSlugs]).toEqual(['ai']);
  });

  it('gives tags that only slug alike their own pages', async () => {
    const { getSiteData } = await freshContent();
    astroContent.getCollection.mockImplementation(async (name: string) =>
      name === 'posts'
        ? [
            {
              data: {
                id: 'a',
                slug: 'a',
                status: 'Published',
                published: '2024-01-01',
                tags: ['C++'],
              },
            },
            {
              data: {
                id: 'b',
                slug: 'b',
                status: 'Published',
                published: '2024-01-02',
                tags: ['C#'],
              },
            },
          ]
        : [],
    );
    const site = await getSiteData();
    expect(site.tags).toHaveLength(2);
    expect(site.tags.every((tag) => /^c-[0-9a-f]{6}$/.test(tag.slug))).toBe(true);
  });
});
