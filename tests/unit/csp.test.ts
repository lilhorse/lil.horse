import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectScriptHashes,
  cspHeader,
  inlineScripts,
  missingCspHashes,
  scriptHash,
} from '../../src/lib/csp';
import { headersFile } from '../../src/lib/headers';
import { tempDir } from '../helpers/temp-dir';

const page = (body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title></head><body>${body}</body></html>`;

describe('inlineScripts', () => {
  it('keeps only scripts the browser checks inline, speculation rules included', () => {
    const html = page(
      '<script>let a = 1</script><script type="module">let b = 2</script>' +
        '<script src="/_astro/x.js"></script><script type="application/ld+json">{}</script>' +
        '<script type="speculationrules">{}</script><script>   </script><script></script>' +
        '<button data-code="<script>fake</script>">x</button>',
    );
    expect(inlineScripts(html)).toEqual(['let a = 1', 'let b = 2', '{}', '   ']);
  });

  it.each([
    ['an upper-case tag', '<SCRIPT>a()</SCRIPT>', ['a()']],
    ['an upper-case end tag', '<script>a()</SCRIPT><p>after</p>', ['a()']],
    ['a space in the end tag', '<script>a()</script ><p>after</p>', ['a()']],
    ['CRLF line ends', '<script>\r\na()\r\n</script>', ['\na()\n']],
    ['a lone CR', '<script>a()\r</script>', ['a()\n']],
    ['a NUL', '<script>a()// \u0000</script>', ['a()// \uFFFD']],
    ['a comment closed by --!>', '<!-- x --!><script>a()</script>', ['a()']],
    ['an attribute right after a quoted value', '<script type="module"async>a()</script>', ['a()']],
    [
      'an escaped script start',
      '<script><!--<script>a()</script>b()</script>',
      ['<!--<script>a()</script>b()'],
    ],
  ])('reads what the browser hashes after %s', (_, body, expected) => {
    expect(inlineScripts(page(body))).toEqual(expected);
  });
});

describe('scriptHash and cspHeader', () => {
  it('hashes the exact body with SHA-256 in base64', () => {
    expect(scriptHash('a')).toBe('sha256-ypeBEsobvcr6wjGzmiPcTaeG7/gUfE5yuYB3ha/uSLs=');
  });

  it('lists the hashes between the keywords and the allowed hosts', () => {
    const csp = cspHeader(['sha256-abc=', 'sha256-def=']);
    expect(csp).toContain(
      "script-src 'self' 'wasm-unsafe-eval' 'inline-speculation-rules' 'sha256-abc=' 'sha256-def=' https://giscus.app https://static.cloudflareinsights.com;",
    );
    expect(csp).toContain("default-src 'self'; ");
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://giscus.app; ");
    expect(csp).toContain(
      'frame-src https://giscus.app https://www.youtube-nocookie.com https://player.vimeo.com',
    );
    expect(csp).toContain("; object-src 'none'; ");
    expect(csp).toMatch(/frame-ancestors 'none'$/);
    expect(csp).not.toContain('\n');
  });
});

describe('collectScriptHashes and missingCspHashes', () => {
  it('hashes every distinct inline script and flags the ones the policy lacks', async () => {
    const dist = await tempDir('csp-');
    await mkdir(join(dist, 'blog'));
    await writeFile(join(dist, 'index.html'), page('<script>one()</script>'));
    await writeFile(
      join(dist, 'blog', 'a.html'),
      page('<script>one()</script><script>two()</script>'),
    );
    const hashes = await collectScriptHashes(dist);
    expect(hashes).toEqual([scriptHash('one()'), scriptHash('two()')].sort());
    await writeFile(join(dist, '_headers'), headersFile(cspHeader([scriptHash('one()')])));
    expect(await missingCspHashes(dist)).toEqual([
      {
        file: 'blog/a.html',
        message: `inline script ${scriptHash('two()')} is not in the CSP of _headers`,
      },
    ]);
    await writeFile(join(dist, '_headers'), headersFile(cspHeader(hashes)));
    expect(await missingCspHashes(dist)).toEqual([]);
    expect(await missingCspHashes(await tempDir('nohdr-'))).toEqual([
      { file: '_headers', message: 'is missing' },
    ]);
  });

  it('leaves uploads out: they are served under a sandbox policy of their own', async () => {
    const dist = await tempDir('csp-media-');
    await mkdir(join(dist, '_media', 'k'), { recursive: true });
    await writeFile(join(dist, 'index.html'), page('<script>one()</script>'));
    await writeFile(join(dist, '_media', 'k', 'notes.html'), page('<script>alert(1)</script>'));
    const hashes = await collectScriptHashes(dist);
    expect(hashes).toEqual([scriptHash('one()')]);
    await writeFile(join(dist, '_headers'), headersFile(cspHeader(hashes)));
    expect(await missingCspHashes(dist)).toEqual([]);
  });

  async function checked(body: string) {
    const dist = await tempDir('csp-scan-');
    await writeFile(join(dist, 'index.html'), page(body));
    await writeFile(
      join(dist, '_headers'),
      headersFile(cspHeader(await collectScriptHashes(dist))),
    );
    return missingCspHashes(dist);
  }

  it('counts inline scripts a second way and reports a script the scan missed', async () => {
    expect(await checked('<script>a()</script><script/x/>b()</script>')).toEqual([
      {
        file: 'index.html',
        message: 'inline scripts: a plain count finds 2, the CSP scan read 1',
      },
    ]);
    expect(await checked('<!-- <script>x()</script> --><script>a()</script>')).toEqual([]);
  });

  it('reports a script inside SVG or MathML, whose text the browser decodes before hashing', async () => {
    const issue = {
      file: 'index.html',
      message: 'has a script inside <svg> or <math>, which the CSP scan cannot hash',
    };
    expect(await checked('<svg><script>a(&quot;x&quot;)</script></svg>')).toEqual([issue]);
    expect(await checked('<math><mi>x</mi><SCRIPT>a()</SCRIPT></math>')).toEqual([issue]);
    expect(await checked('<svg><path d="M0 0"/></svg><svg/><script>a()</script>')).toEqual([]);
  });

  it('reports script-src keywords that would let unhashed scripts run', async () => {
    const dist = await tempDir('csp-keywords-');
    await writeFile(join(dist, 'index.html'), page(''));
    await writeFile(
      join(dist, '_headers'),
      "/*\n  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline' 'unsafe-eval' 'strict-dynamic'; style-src 'self' 'unsafe-inline'\n",
    );
    expect(await missingCspHashes(dist)).toEqual(
      ["'unsafe-inline'", "'unsafe-eval'", "'strict-dynamic'"].map((keyword) => ({
        file: '_headers',
        message: `script-src allows ${keyword}`,
      })),
    );
  });
});
