import { beforeEach, describe, expect, it } from 'vitest';
import { enhanceYouTube, youtubeEmbedUrl } from '../../src/scripts/youtube-facade';

beforeEach(() => {
  document.body.innerHTML =
    '<figure><a class="youtube" href="https://www.youtube.com/watch?v=abc_DEF-123" data-youtube="abc_DEF-123" data-title="A talk">Play video: A talk</a></figure>';
  enhanceYouTube(document);
});

const link = () => document.querySelector<HTMLAnchorElement>('a[data-youtube]');

describe('enhanceYouTube', () => {
  it('builds a privacy-enhanced embed URL that autoplays', () => {
    expect(youtubeEmbedUrl('abc_DEF-123')).toBe(
      'https://www.youtube-nocookie.com/embed/abc_DEF-123?autoplay=1',
    );
  });

  it('replaces the link with a titled, focused player on a plain click', () => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link()?.dispatchEvent(event);
    const frame = document.querySelector('iframe');
    expect(event.defaultPrevented).toBe(true);
    expect(link()).toBeNull();
    expect(frame?.getAttribute('src')).toBe(
      'https://www.youtube-nocookie.com/embed/abc_DEF-123?autoplay=1',
    );
    expect(frame?.title).toBe('A talk');
    expect(frame?.allowFullscreen).toBe(true);
    expect(document.activeElement).toBe(frame);
  });

  it('lets modified clicks open YouTube as a normal link', () => {
    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
      metaKey: true,
    });
    link()?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(document.querySelector('iframe')).toBeNull();
  });
});
