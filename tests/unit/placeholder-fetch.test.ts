import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { placeholderFetch } from '../../src/notion/placeholder-fetch';

describe('placeholderFetch', () => {
  it('returns a deterministic PNG for media requests', async () => {
    const first = Buffer.from(
      await (await placeholderFetch('https://example.com/a.jpg')).arrayBuffer(),
    );
    const second = Buffer.from(
      await (await placeholderFetch('https://example.com/a.jpg')).arrayBuffer(),
    );
    expect(first.equals(second)).toBe(true);
    expect(await sharp(first).metadata()).toMatchObject({
      format: 'png',
      width: 1200,
      height: 800,
    });
  });

  it('returns HTML with a title when HTML is requested', async () => {
    const response = await placeholderFetch('https://example.com/post', {
      headers: { accept: 'text/html' },
    });
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('<title>example.com</title>');
  });
});
