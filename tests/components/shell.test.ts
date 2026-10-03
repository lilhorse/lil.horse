import { describe, expect, it } from 'vitest';
import CommandBlock from '../../src/components/shell/CommandBlock.astro';
import PixelHorse from '../../src/components/shell/PixelHorse.astro';
import Prompt from '../../src/components/shell/Prompt.astro';
import { htmlErrors, render } from '../helpers/astro-render';

describe('Prompt', () => {
  it('draws the prompt glyph as hidden SVG, with the full shell context on request', async () => {
    const short = await render(Prompt);
    expect(short).toContain(
      '<svg class="glyph" viewBox="0 0 12 20" aria-hidden="true" focusable="false">',
    );
    expect(short).not.toContain('lilhorse');
    expect(await render(Prompt, { full: true })).toContain(
      '<span class="user">lilhorse</span> <span class="dim">in</span> <span class="cwd">~/lil.horse</span> <span class="dim">on</span> <span class="branch">main</span> <svg',
    );
  });
});

describe('CommandBlock', () => {
  it('shows the command as decoration and names the section with a hidden heading', async () => {
    const html = await render(
      CommandBlock,
      { command: 'ls -lt ~/blog', pipe: '| head', heading: { level: 2, text: 'Latest posts' } },
      undefined,
      { default: '<p>output</p>' },
    );
    expect(html).toContain('<h2 class="sr-only">Latest posts</h2>');
    expect(html).toMatch(
      /<p class="cmd-line" aria-hidden="true">.*<span class="command">ls -lt ~\/blog<\/span><span class="pipe"> \| head<\/span><\/p>/,
    );
    expect(html).toContain('<div class="cmd-out"><p>output</p></div>');
    expect(await htmlErrors(html)).toEqual([]);
  });

  it('renders no heading for a purely decorative command', async () => {
    const html = await render(CommandBlock, { command: 'cat ~/blog/douban.md' });
    expect(html).not.toMatch(/<h[1-6]/);
    expect(html).toContain('cat ~/blog/douban.md');
  });
});

describe('PixelHorse', () => {
  it('inlines both palettes at the requested grid and size, hidden from assistive tech', async () => {
    const html = await render(PixelHorse, { grid: 24, size: 120, animated: true });
    expect(html).toMatch(
      /^<span class="pixel-horse animated" style="--horse-size: 120px" aria-hidden="true">/,
    );
    expect(html.match(/viewBox="0 0 24 24"/g)).toHaveLength(2);
    expect(html).toContain('<span class="theme-light"><svg');
    expect(html).toContain('<span class="theme-dark"><svg');
    expect(html.match(/class="horse-glint"/g)).toHaveLength(2);
  });

  it('uses the 16 x 16 grid for small logos', async () => {
    const html = await render(PixelHorse, { grid: 16, size: 16 });
    expect(html.match(/viewBox="0 0 16 16"/g)).toHaveLength(2);
    expect(html).not.toContain('animated');
  });
});
