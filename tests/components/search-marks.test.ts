import { gunzipSync } from 'node:zlib';
import { close, createIndex } from 'pagefind';
import { describe, expect, it } from 'vitest';
import { SEARCH_LANGUAGE } from '../../integrations/pagefind';
import Blocks from '../../src/components/blocks/Blocks.astro';
import DocHeader from '../../src/components/shell/DocHeader.astro';
import type { HeadingNode, RichText } from '../../src/notion/types';
import { render } from '../helpers/astro-render';

const text = (value: string): RichText => [
  {
    kind: 'text',
    text: value,
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: 'default',
    },
    href: null,
    pageId: null,
  },
];

const heading = (title: string, toggleable: boolean): HeadingNode => ({
  type: 'heading',
  id: title,
  level: 2,
  text: text(title),
  anchor: title.toLowerCase(),
  color: 'default',
  toggleable,
  children: [],
});

/** The text Pagefind stored for the page, which its excerpts are cut from. */
async function indexedText(html: string): Promise<string> {
  const created = await createIndex({ forceLanguage: SEARCH_LANGUAGE });
  try {
    const added = await created.index?.addHTMLFile({ sourcePath: 'blog/post.html', content: html });
    expect(added?.errors).toEqual([]);
    const fragment = (await created.index?.getFiles())?.files.find((file) =>
      file.path.startsWith('fragment/'),
    );
    const data = gunzipSync(fragment?.content ?? new Uint8Array()).toString();
    const { content } = JSON.parse(data.slice(data.indexOf('{'))) as { content: string };
    // Chinese segmentation puts a zero-width space between words.
    return content.replaceAll('​', '');
  } finally {
    await close();
  }
}

describe('search excerpts', () => {
  it('leave out the decorative # of the title and ## of the headings', async () => {
    const header = await render(DocHeader, { command: 'cat ~/blog/post.md', title: 'Movies' });
    const body = await render(Blocks, {
      nodes: [heading('Ratings', false), heading('Reviews', true)],
      resolve: () => undefined,
      headings: [],
    });
    const content = await indexedText(
      `<!doctype html><html lang="en"><head><title>t</title></head><body><article data-pagefind-body>${header}${body}</article></body></html>`,
    );
    expect(content).toContain('Movies');
    expect(content).toContain('Ratings');
    expect(content).toContain('Reviews');
    expect(content).not.toContain('#');
  }, 60_000);
});
