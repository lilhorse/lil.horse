import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { headersFor, parseHeaders, type HeaderRule } from '../src/lib/headers';
import { matchRedirect, parseRedirects, type Redirect } from '../src/lib/redirects';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
};

// Cloudflare reads these two files; it never serves them.
const CONTROL_FILES = new Set(['/_headers', '/_redirects']);

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Maps a request path to a file the way build.format 'file' lays out dist/. */
export function resolveDistFile(dist: string, url: string): { file: string; status: 200 | 404 } {
  const root = resolve(dist);
  const notFound = { file: join(root, '404.html'), status: 404 as const };
  let path: string;
  try {
    path = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  } catch {
    return notFound;
  }
  if (CONTROL_FILES.has(path)) return notFound;
  const candidates =
    path === '/' ? ['index.html'] : [path, `${path}.html`, join(path, 'index.html')];
  for (const candidate of candidates) {
    const file = normalize(join(root, candidate));
    if (file.startsWith(root + sep) && isFile(file)) return { file, status: 200 };
  }
  return notFound;
}

function readControlFile(dist: string, name: string): string {
  const file = join(dist, name);
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

/** Serves dist/ the way Cloudflare's static assets would, including _redirects and _headers. */
export function serveDist(dist: string, port: number) {
  const redirects: Redirect[] = parseRedirects(readControlFile(dist, '_redirects'));
  const rules: HeaderRule[] = parseHeaders(readControlFile(dist, '_headers'));
  return createServer((request, response) => {
    // A malformed target must not crash the server; resolveDistFile answers it with the 404 page.
    const url = URL.parse(request.url ?? '/', 'http://localhost') ?? new URL('http://localhost');
    const extra = headersFor(rules, url.pathname);
    const redirect = matchRedirect(redirects, url.pathname);
    if (redirect) {
      response.writeHead(redirect.status, {
        ...extra,
        location: `${redirect.location}${url.search}`,
      });
      response.end();
      return;
    }
    const { file, status } = resolveDistFile(dist, request.url ?? '/');
    response.writeHead(status, {
      ...extra,
      'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    });
    createReadStream(file)
      .on('error', () => response.end())
      .pipe(response);
  }).listen(port, '127.0.0.1');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.argv[2] ?? 4322);
  serveDist('dist', port);
  console.log(`Serving dist/ on http://127.0.0.1:${port}`);
}
