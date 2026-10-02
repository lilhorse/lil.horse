import { describe, expect, it } from 'vitest';
import { isBlank, pageIdFromHref, plain, toRichText } from '../../src/notion/rich-text';
import { equation, mention, rt } from '../helpers/notion-factory';

const ID = '71d7802a0abf4857a535dfd861d8491e';

describe('toRichText', () => {
  it('keeps annotations and colours', () => {
    const [span] = toRichText([rt('bold red', { annotations: { bold: true, color: 'red' } })]);
    expect(span).toEqual({
      kind: 'text',
      text: 'bold red',
      href: null,
      pageId: null,
      annotations: {
        bold: true,
        italic: false,
        strikethrough: false,
        underline: false,
        code: false,
        color: 'red',
      },
    });
  });

  it('recognises internal links and mentions', () => {
    const spans = toRichText([
      rt('external', { href: 'https://example.com' }),
      rt('relative', { href: `/${ID}` }),
      rt('notion', { href: `https://www.notion.so/Hello-World-${ID}` }),
      mention(
        { type: 'page', page: { id: '71d7802a-0abf-4857-a535-dfd861d8491e' } },
        'Hello World',
      ),
      mention(
        { type: 'date', date: { start: '2024-02-29', end: null, time_zone: null } },
        'February 29, 2024',
      ),
      mention({ type: 'user', user: { object: 'user', id: 'u' } }, '@someone'),
      equation('E=mc^2'),
    ]);
    expect(spans.map((span) => (span.kind === 'text' ? span.pageId : null))).toEqual([
      null,
      ID,
      ID,
      ID,
      null,
      null,
      null,
    ]);
    expect(spans[0]).toMatchObject({ href: 'https://example.com' });
    expect(spans[4]).toMatchObject({
      kind: 'date',
      start: '2024-02-29',
      end: null,
      text: 'February 29, 2024',
    });
    expect(spans[5]).toMatchObject({ kind: 'text', text: '@someone', pageId: null });
    expect(spans[6]).toMatchObject({ kind: 'equation', expression: 'E=mc^2' });
  });

  it('resolves database mentions and keeps link mention URLs', () => {
    const url = 'https://github.com/lilhorse';
    const [databaseMention, linkMention] = toRichText([
      mention(
        { type: 'database', database: { id: '71d7802a-0abf-4857-a535-dfd861d8491e' } },
        'Reading list',
      ),
      { ...mention({ type: 'link_mention', link_mention: { href: url } }, 'lilhorse'), href: url },
    ]);
    expect(databaseMention).toMatchObject({
      kind: 'text',
      text: 'Reading list',
      href: null,
      pageId: ID,
    });
    expect(linkMention).toMatchObject({ kind: 'text', text: 'lilhorse', href: url, pageId: null });
  });
});

describe('helpers', () => {
  it('extracts page ids only from Notion links', () => {
    expect(pageIdFromHref(`https://lilhorse.notion.site/x-${ID}`)).toBe(ID);
    expect(pageIdFromHref(`https://app.notion.com/p/${ID}`)).toBe(ID);
    expect(
      pageIdFromHref(`https://www.notion.so/ws/${'b'.repeat(32)}?v=${'c'.repeat(32)}&p=${ID}`),
    ).toBe(ID);
    expect(pageIdFromHref(`https://example.com/${ID}`)).toBeNull();
    expect(pageIdFromHref(`https://evilnotion.so/${ID}`)).toBeNull();
    expect(pageIdFromHref(`//example.com/?p=${ID}`)).toBeNull();
    expect(pageIdFromHref(null)).toBeNull();
  });

  it('flattens text and detects blank text', () => {
    const text = toRichText([rt('a '), equation('x'), rt(' b')]);
    expect(plain(text)).toBe('a x b');
    expect(isBlank(toRichText([rt('  \n')]))).toBe(true);
    expect(isBlank([])).toBe(true);
    expect(isBlank(toRichText([equation('x')]))).toBe(false);
  });
});
