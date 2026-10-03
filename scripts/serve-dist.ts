import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

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
  const candidates =
    path === '/' ? ['index.html'] : [path, `${path}.html`, join(path, 'index.html')];
  for (const candidate of candidates) {
    const file = normalize(join(root, candidate));
    if (file.startsWith(root + sep) && isFile(file)) return { file, status: 200 };
  }
  return notFound;
}

export function serveDist(dist: string, port: number) {
  return createServer((request, response) => {
    const { file, status } = resolveDistFile(dist, request.url ?? '/');
    response.writeHead(status, {
      'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    });
    createReadStream(file).pipe(response);
  }).listen(port, '127.0.0.1');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.argv[2] ?? 4322);
  serveDist('dist', port);
  console.log(`Serving dist/ on http://127.0.0.1:${port}`);
}
