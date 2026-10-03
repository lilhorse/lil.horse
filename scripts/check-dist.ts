import { checkDist } from '../src/lib/dist-check';

const issues = await checkDist('dist', {
  routes: [
    'index.html',
    'blog.html',
    'projects.html',
    'about.html',
    'contact.html',
    '404.html',
    'blog/*.html',
    'blog/tags/*.html',
    'favicon.svg',
    'favicon.ico',
    'apple-touch-icon.png',
    'site.webmanifest',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-maskable-512.png',
  ],
});
for (const { file, message } of issues)
  console.error(file ? `✗ ${file}: ${message}` : `✗ ${message}`);
if (issues.length > 0) {
  console.error(`\n${issues.length} problem(s) found in dist/`);
  process.exit(1);
}
console.log('dist/ passed all checks');
