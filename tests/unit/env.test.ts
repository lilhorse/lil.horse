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

  it('defaults everything to off', () => {
    expect(readEnv({})).toEqual({
      notionToken: null,
      fixtures: false,
      includeDrafts: false,
      fullRefresh: false,
    });
  });
});
