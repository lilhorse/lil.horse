import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { extname, join, normalize, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGzip } from 'node:zlib';
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

// Cloudflare compresses text responses; serving them raw would make Lighthouse time the uncompressed bytes.
const COMPRESSIBLE =
  /^(?:text\/|application\/(?:json|xml|javascript|manifest\+json)|image\/svg\+xml)/;

// Cloudflare reads these two files; it never serves them.
const CONTROL_FILES = new Set(['_headers', '_redirects']);
// Cloudflare's default for files that no _headers rule caches.
const REVALIDATE = 'public, max-age=0, must-revalidate';

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Cloudflare reads an origin-form target as a path, even one that starts with '//'. */
function requestUrl(target: string): URL | null {
  return URL.parse(target.startsWith('/') ? `http://localhost${target}` : target);
}

const decodeSegment = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/** Where Cloudflare serves a path: each segment decoded and re-encoded, slash runs collapsed. */
function canonicalPath(pathname: string): string {
  return pathname
    .split('/')
    .map(decodeSegment)
    .join('/')
    .replace(/\/+/g, '/')
    .split('/')
    .map(encodeURIComponent)
    .join('/');
}

/** Maps a request target to a file the way build.format 'file' lays out dist/. */
export function resolveDistFile(dist: string, url: string): { file: string; status: 200 | 404 } {
  const root = resolve(dist);
  const notFound = { file: join(root, '404.html'), status: 404 as const };
  const pathname = requestUrl(url)?.pathname;
  if (!pathname) return notFound;
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return notFound;
  }
  const candidates =
    path === '/' ? ['index.html'] : [path, `${path}.html`, join(path, 'index.html')];
  for (const candidate of candidates) {
    const file = normalize(join(root, candidate));
    if (!file.startsWith(root + sep) || CONTROL_FILES.has(relative(root, file).toLowerCase()))
      continue;
    if (isFile(file)) return { file, status: 200 };
  }
  return notFound;
}

function gzips(request: IncomingMessage, type: string): boolean {
  return COMPRESSIBLE.test(type) && /\bgzip\b/.test(request.headers['accept-encoding'] ?? '');
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
    const url = requestUrl(request.url ?? '/') ?? new URL('http://localhost');
    const extra = headersFor(rules, url.pathname);
    const redirect = matchRedirect(redirects, url.pathname);
    const canonical = canonicalPath(url.pathname);
    if (redirect || canonical !== url.pathname) {
      response.writeHead(redirect?.status ?? 307, {
        ...extra,
        location: `${redirect?.location ?? canonical}${url.search}`,
      });
      response.end();
      return;
    }
    const { file, status } = resolveDistFile(dist, request.url ?? '/');
    const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
    const gzip = gzips(request, type) && isFile(file);
    response.writeHead(status, {
      'cache-control': REVALIDATE,
      ...extra,
      'content-type': type,
      ...(COMPRESSIBLE.test(type) ? { vary: 'accept-encoding' } : {}),
      ...(gzip ? { 'content-encoding': 'gzip' } : {}),
    });
    // A missing 404 page (dist/ mid-rebuild) ends the response instead of closing the socket.
    const source = createReadStream(file).on('error', () => response.end());
    if (gzip) source.pipe(createGzip()).pipe(response);
    else source.pipe(response);
  }).listen(port, '127.0.0.1');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.argv[2] ?? 4322);
  serveDist('dist', port);
  console.log(`Serving dist/ on http://127.0.0.1:${port}`);
}
