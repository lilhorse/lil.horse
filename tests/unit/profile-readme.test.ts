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

// What src/lib/banner.ts draws for today's title.
const BANNER = [
  ' ▄█▀▀▀▄▄   ██    █▄█▀   ▀█     ▄█▄▄█                       ▄  ▄▄',
  '███  ▄██    ▄    ███     ▀   ▄█▀▀▀█         ▄     ▄   ▄     ▄▄██     ▄▄',
  ' ▀██ ██    ███   ███         ███▄▀▀██▄  ▄▄█▀██▄  ▀██▀██▀ ▄██▀▀▀   ▄████▄',
  '  █▀  ▀▀   ███   ███          ▀██  ███  ███  ██   ██     ▀██▄▀██▄ ███ ▀▀',
  '▄████▄▄▄   ███▄  ███▄       ▄█▄█▀  ▄██  ███▄▄▀    ██▄▄     ▄▄▄█▀  ▀██  ▄',
  '   ▀▀▀▀    ▀▀▀    ▀▀▀       ▀▀▀ ▄  █▀    ▀▀▀     ▀▀▀▀     ▀▀▀▀     ▀▀▀▀',
  '                              ████▀',
];

const readme = (profile: Partial<ProfileEntry> = {}, extra: { slogan?: string | null } = {}) =>
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
    expect(readme())
      .toBe(`<picture><source media="(prefers-color-scheme: dark)" srcset="https://lil.horse/brand/horse-night.svg"><a href="https://lil.horse"><img align="left" width="120" alt="lil.horse" src="https://lil.horse/brand/horse-chestnut.svg"></a></picture>

\`\`\`text
 ▄█▀▀▀▄▄   ██    █▄█▀   ▀█     ▄█▄▄█                       ▄  ▄▄
███  ▄██    ▄    ███     ▀   ▄█▀▀▀█         ▄     ▄   ▄     ▄▄██     ▄▄
 ▀██ ██    ███   ███         ███▄▀▀██▄  ▄▄█▀██▄  ▀██▀██▀ ▄██▀▀▀   ▄████▄
  █▀  ▀▀   ███   ███          ▀██  ███  ███  ██   ██     ▀██▄▀██▄ ███ ▀▀
▄████▄▄▄   ███▄  ███▄       ▄█▄█▀  ▄██  ███▄▄▀    ██▄▄     ▄▄▄█▀  ▀██  ▄
   ▀▀▀▀    ▀▀▀    ▀▀▀       ▀▀▀ ▄  █▀    ▀▀▀     ▀▀▀▀     ▀▀▀▀     ▀▀▀▀
                              ████▀
\`\`\`

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

  it('prints the title as text when the banner font can draw none of it', () => {
    const markdown = profileReadme({
      title: '小马 *',
      banner: [],
      slogan: null,
      profile: TODAY,
      site: 'https://lil.horse',
    });
    expect(markdown).not.toContain('```');
    expect(markdown).toContain('</picture>\n\n**小马 \\***\n\n**Role**');
  });
});
