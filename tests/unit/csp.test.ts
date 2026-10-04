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
});
