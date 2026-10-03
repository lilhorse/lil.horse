import { describe, expect, it } from 'vitest';
import { cspHeader } from '../../src/lib/csp';
import { headersFile, headersFor, parseHeaders } from '../../src/lib/headers';

const file = headersFile(cspHeader(['sha256-abc=']));
const rules = parseHeaders(file);

describe('headersFile', () => {
  it('starts with the site-wide security headers and keeps cache rules on disjoint paths', () => {
    expect(file.startsWith("/*\n  Content-Security-Policy: default-src 'self'; ")).toBe(true);
    const patterns = rules.map((rule) => rule.pattern);
    expect(patterns).toEqual([
      '/*',
      '/_astro/*',
      '/_media/*',
      '/pagefind/index/*',
      '/pagefind/fragment/*',
      '/pagefind/filter/*',
      '/pagefind/*.pf_meta',
      '/og/*',
      '/giscus/*',
      'https://:version.:subdomain.workers.dev/*',
    ]);
    expect(rules[0]?.headers.map(([name]) => name)).toEqual([
      'Content-Security-Policy',
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
    ]);
    expect(file.split('\n').every((line) => line.length <= 2000)).toBe(true);
  });

  it('refuses a policy too long for one line', () => {
    const hashes = Array.from(
      { length: 40 },
      (_, index) => `sha256-${String(index).padStart(44, 'x')}`,
    );
    expect(() => headersFile(cspHeader(hashes))).toThrow(/Cloudflare allows 2000/);
  });
});

describe('headersFor', () => {
  it('gives pages the security headers and no cache rule', () => {
    const page = headersFor(rules, '/blog/douban');
    expect(page['content-security-policy']).toContain("'sha256-abc='");
    expect(page['x-content-type-options']).toBe('nosniff');
    expect(page['cache-control']).toBeUndefined();
    expect(page['x-robots-tag']).toBeUndefined();
  });

  it('caches hashed files for a year and share images for a day', () => {
    expect(headersFor(rules, '/_astro/a.css')['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(headersFor(rules, '/pagefind/index/zh_abc.pf_index')['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(headersFor(rules, '/pagefind/pagefind.zh_8d50.pf_meta')['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(headersFor(rules, '/pagefind/pagefind.js')['cache-control']).toBeUndefined();
    expect(headersFor(rules, '/og/blog/x.png')['cache-control']).toBe('public, max-age=86400');
  });

  it('replaces the page policy with the sandbox for media and opens the giscus styles', () => {
    const media = headersFor(rules, '/_media/k/480.webp');
    expect(media['content-security-policy']).toBe(
      "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    );
    expect(media['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(headersFor(rules, '/giscus/night.css')['access-control-allow-origin']).toBe(
      'https://giscus.app',
    );
  });

  it('joins repeated headers with a comma, as Cloudflare does', () => {
    const custom = parseHeaders(
      '/*\n  X-Robots-Tag: nosnippet\n/blog/*\n  X-Robots-Tag: noindex\n',
    );
    expect(headersFor(custom, '/blog/a')['x-robots-tag']).toBe('nosnippet, noindex');
    expect(headersFor(custom, '/about')['x-robots-tag']).toBe('nosnippet');
  });
});
