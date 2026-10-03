import { describe, expect, it } from 'vitest';
import { emailHtml, socialLinks } from '../../src/lib/profile';

describe('emailHtml', () => {
  it('splits the address with comments so it never appears whole', () => {
    expect(emailHtml('sup@lil.horse')).toBe('sup<!-- -->@<!-- -->lil.horse');
    expect(emailHtml('sup@lil.horse')).not.toContain('sup@lil.horse');
  });

  it('escapes markup and rejects strings that are not addresses', () => {
    expect(emailHtml('<a>@x.y')).toBe('&lt;a&gt;<!-- -->@<!-- -->x.y');
    expect(emailHtml('nobody')).toBeNull();
    expect(emailHtml('@lil.horse')).toBeNull();
    expect(emailHtml('sup@')).toBeNull();
  });
});

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
