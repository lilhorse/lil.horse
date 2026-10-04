import { pathToFileURL } from 'node:url';
import { siteConfig } from '../site.config';
import { missingCspHashes } from '../src/lib/csp';
import { checkDist } from '../src/lib/dist-check';
import { unresolvedRedirects } from '../src/lib/redirects';

export const REQUIRED_ROUTES = [
  'index.html',
  'blog.html',
  'projects.html',
  'about.html',
  'contact.html',
  '404.html',
  'blog/*.html',
  'favicon.svg',
  'favicon.ico',
  'apple-touch-icon.png',
  'site.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'pagefind/pagefind.js',
  'pagefind/pagefind-entry.json',
  'feed.xml',
  'og/site/home.png',
  'og/pages/about.png',
  'og/pages/contact.png',
  'og/blog/*.png',
  '_headers',
  '_redirects',
  'sitemap-index.xml',
  'sitemap-0.xml',
  'robots.txt',
];

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const issues = await checkDist('dist', { site: siteConfig.url, routes: REQUIRED_ROUTES });
  issues.push(...(await missingCspHashes('dist')), ...(await unresolvedRedirects('dist')));
  for (const { file, message } of issues)
    console.error(file ? `✗ ${file}: ${message}` : `✗ ${message}`);
  if (issues.length > 0) {
    console.error(`\n${issues.length} problem(s) found in dist/`);
    process.exit(1);
  }
  console.log('dist/ passed all checks');
}
