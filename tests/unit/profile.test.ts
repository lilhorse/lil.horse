import { describe, expect, it } from 'vitest';
import { socialLinks } from '../../src/lib/profile';

describe('socialLinks', () => {
  it('builds profile URLs from handles, with or without @', () => {
    expect(socialLinks({ github: 'lilhorse', x: '@lilhorse' })).toEqual([
      { label: 'github', href: 'https://github.com/lilhorse' },
      { label: 'x', href: 'https://x.com/lilhorse' },
    ]);
  });

  it('keeps full profile URLs and skips empty or unsafe values', () => {
    expect(socialLinks({ github: 'https://github.com/lilhorse', x: '  ' })).toEqual([
      { label: 'github', href: 'https://github.com/lilhorse' },
    ]);
    expect(socialLinks({ github: null, x: '@' })).toEqual([]);
    expect(socialLinks({ github: 'javascript:alert(1)', x: 'two words' })).toEqual([]);
  });
});
