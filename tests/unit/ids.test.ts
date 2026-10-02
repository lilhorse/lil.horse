import { describe, expect, it } from 'vitest';
import { normalizeId, notionUrl, parseId } from '../../src/notion/ids';

const ID = '71d7802a0abf4857a535dfd861d8491e';

describe('parseId', () => {
  it.each([
    [ID, ID],
    ['71d7802a-0abf-4857-a535-dfd861d8491e', ID],
    ['71D7802A0ABF4857A535DFD861D8491E', ID],
    [`/${ID}`, ID],
    [`https://www.notion.so/lilhorse/Hello-World-${ID}?pvs=4`, ID],
    [`https://www.notion.so/Page-${ID}#block-1`, ID],
    [`https://lilhorse.notion.site/Deadbeef-${ID}`, ID],
    [`https://www.notion.so/lilhorse/${'b'.repeat(32)}?v=${'c'.repeat(32)}&p=${ID}&pm=s`, ID],
    [`www.notion.so/lilhorse/${ID}?v=${'c'.repeat(32)}`, ID],
    [`${ID}?v=${'c'.repeat(32)}`, ID],
    [`notion.so/Page-${ID}#${'d'.repeat(32)}`, ID],
    [`https://www.notion.so/%E4%BD%A0%E5%A5%BD-${ID}`, ID],
  ])('parses %s', (input, expected) => {
    expect(parseId(input)).toBe(expected);
  });

  it.each(['', 'hello', 'https://example.com/about', '1234'])('returns null for %s', (input) => {
    expect(parseId(input)).toBeNull();
  });
});

describe('normalizeId', () => {
  it('throws with the offending value', () => {
    expect(() => normalizeId('<Posts ID>')).toThrow('Invalid Notion ID: "<Posts ID>"');
  });

  it('builds a notion.so URL', () => {
    expect(notionUrl('71d7802a-0abf-4857-a535-dfd861d8491e')).toBe(`https://www.notion.so/${ID}`);
  });
});
