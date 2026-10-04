const { existsSync, readdirSync } = require('node:fs');

// Same port variable as the end-to-end tests, so parallel worktrees do not collide.
const port = Number(process.env.E2E_PORT ?? 4322);
const origin = `http://127.0.0.1:${port}`;

const post = existsSync('dist/blog')
  ? readdirSync('dist/blog').find((file) => file.endsWith('.html'))
  : undefined;
if (!post) throw new Error('dist/blog has no post: run pnpm build or pnpm build:fixtures first');

module.exports = {
  ci: {
    collect: {
      url: ['/', '/blog', `/blog/${post.replace(/\.html$/, '')}`, '/projects', '/about'].map(
        (path) => origin + path,
      ),
      numberOfRuns: 3,
      startServerCommand: `pnpm exec tsx scripts/serve-dist.ts ${port}`,
      startServerReadyPattern: 'Serving dist/',
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.98, aggregationMethod: 'median' }],
        'categories:accessibility': ['error', { minScore: 1, aggregationMethod: 'pessimistic' }],
        'categories:best-practices': ['error', { minScore: 1, aggregationMethod: 'pessimistic' }],
        'categories:seo': ['error', { minScore: 1, aggregationMethod: 'pessimistic' }],
      },
    },
    upload: { target: 'filesystem', outputDir: 'test-results/lighthouse' },
  },
};
