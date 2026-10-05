import { describe, expect, it } from 'vitest';
import { escapeMarkdown, inlineCode, profileReadme } from '../../src/lib/profile-readme';
import type { ProfileEntry } from '../../src/notion/types';

const TODAY: ProfileEntry = {
  id: 'me',
  name: "Lil'Horse",
  role: 'Freelance full-stack developer',
  location: 'Auckland, New Zealand',
  availability: 'Open to work',
  stack: [
    'TypeScript',
    'Python',
    'Go',
    'PHP',
    'Dart',
    'Vue',
    'React',
    'Next.js',
    'Flutter',
    'Node.js',
    'Tailwind CSS',
    'Cloudflare',
    'Docker',
    'PostgreSQL',
    'Redis',
    'Solidity',
  ],
  email: 'sup@lil.horse',
  github: 'lilhorse',
  x: 'lil_horse_',
  bio: 'Indie Coder & GFW Hater.',
};

// Blank, at the size src/lib/banner.ts draws today's title, so the pinned versions hold on any machine.
const BANNER = { width: 72, height: 14, pixels: new Uint8Array(72 * 14) };

const readme = (
  profile: Partial<ProfileEntry> = {},
  extra: { title?: string; slogan?: string | null } = {},
) =>
  profileReadme({
    title: '𝕷𝖎𝖑’𝕳𝖔𝖗𝖘𝖊',
    banner: BANNER,
    slogan: 'Dis is da cyberspace of Lil’Horse, just chill and have fun 🍻.',
    ...extra,
    profile: { ...TODAY, ...profile },
    site: 'https://lil.horse',
  });

const line = (markdown: string, label: string) =>
  markdown.split('\n').find((row) => row.startsWith(`**${label}**`));

const versions = (markdown: string): Record<string, string | undefined> =>
  Object.fromEntries(
    Array.from(markdown.matchAll(/\/brand\/masthead-(dark|light)\.svg\?v=([^"]*)"/g), (match) => [
      match[1],
      match[2],
    ]),
  );

describe('escapeMarkdown', () => {
  it('escapes Markdown and HTML punctuation', () => {
    expect(escapeMarkdown('\\ * _ ` [ ] < > | ~')).toBe('\\\\ \\* \\_ \\` \\[ \\] \\< \\> \\| \\~');
    expect(escapeMarkdown('<img src=x onerror=alert(1)>')).toBe('\\<img src=x onerror=alert(1)\\>');
  });

  it('escapes # only where it would start a heading', () => {
    expect(escapeMarkdown('C# and F#')).toBe('C# and F#');
    expect(escapeMarkdown('# Big\n  ## Bigger')).toBe('\\# Big\n  \\## Bigger');
  });
});

describe('inlineCode', () => {
  it('wraps a stack item in backticks', () => {
    expect(inlineCode('Tailwind CSS')).toBe('`Tailwind CSS`');
  });

  it('fences an item that holds backticks with a longer run', () => {
    expect(inlineCode('a`b')).toBe('``a`b``');
    expect(inlineCode('a``b')).toBe('```a``b```');
    expect(inlineCode('`x`')).toBe('`` `x` ``');
  });
});

describe('profileReadme', () => {
  it('writes the card for today’s profile', () => {
    expect(readme()).toBe(`<div>
  <a href="https://lil.horse">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://lil.horse/brand/horse-night.svg">
      <img align="left" width="120" alt="lil.horse" src="https://lil.horse/brand/horse-chestnut.svg">
    </picture>
  </a>
  <a href="https://lil.horse">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://lil.horse/brand/masthead-dark.svg?v=16533973">
      <img alt="Lil’Horse" width="312" src="https://lil.horse/brand/masthead-light.svg?v=884c65c9">
    </picture>
  </a>
</div>

*Dis is da cyberspace of Lil’Horse, just chill and have fun 🍻.*

**Role** · Freelance full-stack developer<br>
**Location** · Auckland, New Zealand<br>
**Stack** · \`TypeScript\` · \`Python\` · \`Go\` · \`PHP\` · \`Dart\` · \`Vue\` · \`React\` · \`Next.js\` · \`Flutter\` · \`Node.js\` · \`Tailwind CSS\` · \`Cloudflare\` · \`Docker\` · \`PostgreSQL\` · \`Redis\` · \`Solidity\`<br>
**Status** · 🟢 Open to work<br>
**Contact** · [lil.horse](https://lil.horse) · [email](https://lil.horse/contact) · [github](https://github.com/lilhorse) · [x](https://x.com/lil_horse_)<br>

🟥🟧🟨🟩🟦🟪

*Indie Coder & GFW Hater.*
`);
  });

  it('keeps each image a direct child of its picture inside one HTML block', () => {
    const block = readme().split('\n\n')[0];
    expect(block.startsWith('<div>\n')).toBe(true);
    expect(block.endsWith('\n</div>')).toBe(true);
    const pictures = block.match(/<picture>[\s\S]*?<\/picture>/g) ?? [];
    expect(pictures).toHaveLength(2);
    for (const picture of pictures) {
      expect(picture).toMatch(/^<picture>\s*<source [^>]+>\s*<img [^>]+>\s*<\/picture>$/);
    }
  });

  it('never prints the email address', () => {
    const markdown = readme();
    expect(markdown).not.toContain('sup@lil.horse');
    expect(markdown).not.toContain('sup@');
  });

  it('marks each availability with its own colour', () => {
    expect(line(readme({ availability: 'Open to work' }), 'Status')).toBe(
      '**Status** · 🟢 Open to work<br>',
    );
    expect(line(readme({ availability: 'Freelancing' }), 'Status')).toBe(
      '**Status** · 🟡 Freelancing<br>',
    );
    expect(line(readme({ availability: 'Busy' }), 'Status')).toBe('**Status** · 🔴 Busy<br>');
  });

  it('leaves out the links, rows and lines whose fields are empty', () => {
    const markdown = readme(
      { email: null, github: null, x: '  ', stack: [], bio: null },
      {
        slogan: null,
      },
    );
    expect(line(markdown, 'Contact')).toBe('**Contact** · [lil.horse](https://lil.horse)<br>');
    expect(line(markdown, 'Stack')).toBeUndefined();
    expect(markdown).not.toMatch(/^\*[^*]/m);
    expect(markdown.endsWith('🟥🟧🟨🟩🟦🟪\n')).toBe(true);
  });

  it('takes GitHub and X as a handle, @handle or URL', () => {
    expect(line(readme({ github: '@lilhorse', x: 'https://x.com/lil_horse_' }), 'Contact')).toBe(
      '**Contact** · [lil.horse](https://lil.horse) · [email](https://lil.horse/contact) · [github](https://github.com/lilhorse) · [x](https://x.com/lil_horse_)<br>',
    );
    expect(line(readme({ github: 'https://github.com/a (b)', x: null }), 'Contact')).toContain(
      '[github](https://github.com/a%20%28b%29)',
    );
  });

  it('escapes what Notion writes and keeps each field on its line', () => {
    const markdown = readme(
      {
        role: '<b>Boss</b> | *1*',
        location: 'Up\n# Down',
        stack: ['C#', 'a`b'],
        bio: '_Me_\n\n- me',
      },
      { slogan: '[click](https://evil.example)' },
    );
    expect(line(markdown, 'Role')).toBe('**Role** · \\<b\\>Boss\\</b\\> \\| \\*1\\*<br>');
    expect(line(markdown, 'Location')).toBe('**Location** · Up # Down<br>');
    expect(line(markdown, 'Stack')).toBe('**Stack** · `C#` · ``a`b``<br>');
    expect(markdown).toContain('\n*\\[click\\](https://evil.example)*\n');
    expect(markdown).toContain('\n*\\_Me\\_ - me*\n');
  });

  it('versions each banner URL by its SVG, and no horse URL', () => {
    const markdown = readme();
    expect(versions(markdown)).toEqual({
      dark: expect.stringMatching(/^[0-9a-f]{8}$/),
      light: expect.stringMatching(/^[0-9a-f]{8}$/),
    });
    expect(markdown).not.toMatch(/horse-(?:night|chestnut)\.svg\?/);
  });

  it('keeps the versions for the same title and changes them with the title', () => {
    const today = versions(readme());
    expect(versions(readme())).toEqual(today);
    const renamed = versions(readme({}, { title: 'Big Horse' }));
    expect(renamed.dark).not.toBe(today.dark);
    expect(renamed.light).not.toBe(today.light);
  });

  it('gives the dark and light banners versions of their own', () => {
    const { dark, light } = versions(readme());
    expect(dark).not.toBe(light);
  });

  it('names the banner image by the title in plain letters, escaped', () => {
    expect(readme({}, { title: '“𝐁𝐢𝐠” <&> "Horse"' })).toContain(
      '<img alt="“Big” &lt;&amp;&gt; &quot;Horse&quot;" width="312"',
    );
  });

  it('prints the title as text when the banner font can draw none of it', () => {
    const markdown = profileReadme({
      title: '小马 *',
      banner: { width: 0, height: 0, pixels: new Uint8Array() },
      slogan: null,
      profile: TODAY,
      site: 'https://lil.horse',
    });
    expect(markdown).not.toContain('masthead-');
    expect(markdown).toContain('  </a>\n</div>\n\n**小马 \\***\n\n**Role**');
  });
});
