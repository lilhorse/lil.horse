import type { PageObjectResponse } from '@notionhq/client';
import { describe, expect, it, vi } from 'vitest';
import { mastheadTitle, readMasthead, sloganOf } from '../../src/notion/masthead';
import { FakeNotionApi } from '../helpers/fake-api';
import { block, nextId, page, prop, rt } from '../helpers/notion-factory';

const TITLE = '𝕷𝖎𝖑’𝕳𝖔𝖗𝖘𝖊';
const SLOGAN = 'Dis is da cyberspace of Lil’Horse, just chill and have fun 🍻.';

const text = (type: string, content: string, extra: Record<string, unknown> = {}) =>
  block(type, { rich_text: content ? [rt(content)] : [], color: 'default', ...extra });

describe('mastheadTitle', () => {
  it('reads the title property as plain text', () => {
    const root = page({
      title: {
        id: 'title',
        type: 'title',
        title: [rt('  𝕷𝖎𝖑’', { annotations: { bold: true } }), rt('𝕳𝖔𝖗𝖘𝖊  ')],
      },
    });
    expect(mastheadTitle(root)).toBe(TITLE);
  });

  it('is empty for an untitled page', () => {
    expect(mastheadTitle(page({ title: prop.title('') }))).toBe('');
  });
});

describe('sloganOf', () => {
  it('takes the first text block, without its formatting', () => {
    const slogan = block('heading_3', {
      rich_text: [
        rt('Dis is da cyberspace of ', { annotations: { italic: true } }),
        rt('Lil’Horse', { annotations: { italic: true, bold: true } }),
        rt(', just chill and have fun 🍻. ', { annotations: { italic: true } }),
      ],
      is_toggleable: false,
      color: 'default',
    });
    expect(sloganOf([slogan, text('paragraph', ''), text('paragraph', 'Later text')])).toBe(SLOGAN);
  });

  it('accepts headings, paragraphs, quotes and callouts', () => {
    for (const type of ['heading_1', 'heading_2', 'heading_3', 'paragraph', 'quote', 'callout'])
      expect(sloganOf([text(type, `A ${type}`)]), type).toBe(`A ${type}`);
  });

  it('skips empty blocks and blocks of other types', () => {
    expect(
      sloganOf([
        block('child_page', { title: 'Blog' }),
        text('paragraph', ''),
        text('paragraph', ' \n '),
        text('heading_2', ''),
        block('divider', {}),
        text('bulleted_list_item', 'A list item'),
        text('toggle', 'A toggle'),
        text('quote', 'Stay curious'),
      ]),
    ).toBe('Stay curious');
  });

  it('puts a slogan written over several lines on one', () => {
    expect(sloganOf([text('paragraph', 'Line one\nline  two')])).toBe('Line one line two');
  });

  it('is null for a page with no text', () => {
    expect(sloganOf([])).toBeNull();
    expect(sloganOf([text('paragraph', ''), block('image', {}), block('divider', {})])).toBeNull();
  });
});

describe('readMasthead', () => {
  it('reads the title and slogan of the page', async () => {
    const api = new FakeNotionApi();
    const id = nextId();
    api.pages.set(id, page({ title: prop.title(TITLE) }, { id }));
    api.setChildren(id, [text('paragraph', ''), text('heading_3', SLOGAN)]);
    expect(await readMasthead(api, id)).toEqual({ title: TITLE, slogan: SLOGAN });
  });

  // The fixture recorder keeps a page's blocks only after it has recorded the page.
  it('asks for the blocks only once it has the page', async () => {
    const api = new FakeNotionApi();
    const id = nextId();
    let release: (value: PageObjectResponse) => void = () => undefined;
    vi.spyOn(api, 'retrievePage').mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const reading = readMasthead(api, id);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.calls).toEqual([]);
    release(page({ title: prop.title(TITLE) }, { id }));
    await reading;
    expect(api.calls).toEqual([`listBlockChildren:${id}`]);
  });
});
