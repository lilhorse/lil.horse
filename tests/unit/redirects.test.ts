import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  matchRedirect,
  parseRedirects,
  redirectRules,
  redirectsFile,
  unresolvedRedirects,
} from '../../src/lib/redirects';
import { tempDir } from '../helpers/temp-dir';

const ID = '71d7802a0abf4857a535dfd861d8491e';
const ABOUT = '055e368444314f2f953c65a79982553c';
const manifest = {
  posts: [
    { id: ID, slug: 'helloworld' },
    { id: 'a'.repeat(32), slug: 'newer' },
  ],
  pages: [{ id: ABOUT, key: 'about' }],
};

describe('redirectRules', () => {
  it('lists the legacy, ID-style and feed addresses as 301s, then the trailing-slash rule', () => {
    expect(redirectRules(manifest)).toEqual([
      `/helloworld /blog/helloworld 301`,
      `/${ID} /blog/helloworld 301`,
      `/helloworld-${ID} /blog/helloworld 301`,
      `/${'a'.repeat(32)} /blog/newer 301`,
      `/newer-${'a'.repeat(32)} /blog/newer 301`,
      '/feed /feed.xml 301',
      `/${ABOUT} /about 301`,
      `/about-${ABOUT} /about 301`,
      '/*/ /:splat 301',
    ]);
    expect(redirectsFile(manifest)).toMatch(/301\n$/);
  });
});

describe('parseRedirects and matchRedirect', () => {
  const rules = parseRedirects(`${redirectsFile(manifest)}\n# comment\n/old /new\n`);

  it('matches exact paths, case and slash included, and defaults to 302', () => {
    expect(matchRedirect(rules, '/helloworld')).toEqual({
      location: '/blog/helloworld',
      status: 301,
    });
    expect(matchRedirect(rules, '/HELLOWORLD')).toBeNull();
    expect(matchRedirect(rules, '/old')).toEqual({ location: '/new', status: 302 });
    expect(matchRedirect(rules, '/blog/helloworld')).toBeNull();
  });

  it('strips one trailing slash through the splat rule and leaves the root alone', () => {
    expect(matchRedirect(rules, '/helloworld/')).toEqual({ location: '/helloworld', status: 301 });
    expect(matchRedirect(rules, '/blog/tags/%E8%B1%86%E7%93%A3/')).toEqual({
      location: '/blog/tags/%E8%B1%86%E7%93%A3',
      status: 301,
    });
    expect(matchRedirect(rules, '/')).toBeNull();
  });

  it('substitutes the splat as a replacement string, $ patterns included, as Cloudflare does', () => {
    expect(matchRedirect(rules, '/a$&b/')?.location).toBe('/a:splatb');
    expect(matchRedirect(rules, '/p$$q/')?.location).toBe('/p$q');
    expect(matchRedirect(rules, "/x$'y/")?.location).toBe('/xy');
  });

  it('collapses slash runs in a dynamic target, so it stays on the site', () => {
    expect(matchRedirect(rules, '//evil.com/')).toEqual({ location: '/evil.com', status: 301 });
    expect(matchRedirect(rules, '///evil.com//x/')?.location).toBe('/evil.com/x');
    const external = parseRedirects('/go/* https://example.com//:splat 301\n');
    expect(matchRedirect(external, '/go/a')?.location).toBe('https://example.com//a');
  });
});

describe('unresolvedRedirects', () => {
  it('reports missing targets, non-301 rules and a misplaced dynamic rule', async () => {
    const dist = await tempDir('redirects-');
    await mkdir(join(dist, 'blog'));
    await writeFile(join(dist, 'blog', 'helloworld.html'), '');
    await writeFile(join(dist, 'about.html'), '');
    await writeFile(
      join(dist, '_redirects'),
      '/helloworld /blog/helloworld 301\n/*/ /:splat 301\n/gone /blog/gone 301\n/x /about\n',
    );
    expect(await unresolvedRedirects(dist)).toEqual([
      { file: '_redirects', message: '/*/ must be the last rule' },
      { file: '_redirects', message: '/gone redirects to missing /blog/gone' },
      { file: '_redirects', message: '/x redirects with 302, not 301' },
    ]);
    expect(await unresolvedRedirects(await tempDir('empty-'))).toEqual([
      { file: '_redirects', message: 'is missing' },
    ]);
  });

  it('reports a static rule that would hide a page of this build', async () => {
    const dist = await tempDir('redirects-shadow-');
    await mkdir(join(dist, 'blog'));
    await writeFile(join(dist, 'blog', 'helloworld.html'), '');
    await writeFile(join(dist, 'blog.html'), '');
    await writeFile(join(dist, '_redirects'), '/blog /blog/helloworld 301\n/*/ /:splat 301\n');
    expect(await unresolvedRedirects(dist)).toEqual([
      { file: '_redirects', message: '/blog hides a page of this build' },
    ]);
  });
});
