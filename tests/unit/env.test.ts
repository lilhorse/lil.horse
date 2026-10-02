import { describe, expect, it } from 'vitest';
import { readEnv } from '../../src/env';

describe('readEnv', () => {
  it('reads flags and the first non-empty token', () => {
    expect(
      readEnv(
        { NOTION_TOKEN: '  ' },
        { NOTION_TOKEN: 'secret', NOTION_FIXTURES: '1', NOTION_FULL_REFRESH: '0' },
      ),
    ).toEqual({ notionToken: 'secret', fixtures: true, includeDrafts: false, fullRefresh: false });
  });

  it('lets the first non-empty source win and reads every flag', () => {
    expect(
      readEnv(
        { NOTION_FIXTURES: '0' },
        { NOTION_FIXTURES: '1', NOTION_INCLUDE_DRAFTS: '1', NOTION_FULL_REFRESH: ' 1 ' },
      ),
    ).toEqual({ notionToken: null, fixtures: false, includeDrafts: true, fullRefresh: true });
  });

  it('defaults everything to off', () => {
    expect(readEnv({})).toEqual({
      notionToken: null,
      fixtures: false,
      includeDrafts: false,
      fullRefresh: false,
    });
  });
});
