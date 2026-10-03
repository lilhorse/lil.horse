import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { siteConfig } from '../site.config';
import { readEnv } from '../src/env';
import { createNotionApi } from '../src/notion/api';
import { BookmarkFetcher } from '../src/notion/bookmarks';
import { createRecordingApi } from '../src/notion/fixture-api';
import { MediaStore } from '../src/notion/media';
import { PageCache } from '../src/notion/page-cache';
import { fixtureDir } from '../src/notion/paths';
import { createFixtureSanitizer } from '../src/notion/sanitize';
import { LOADER_VERSION, syncNotion } from '../src/notion/sync';

const env = readEnv(process.env);
if (!env.notionToken) throw new Error('NOTION_TOKEN is required to record fixtures');

const target = fixtureDir();
const scratch = await mkdtemp(join(tmpdir(), 'lil-horse-record-'));
await rm(target, { recursive: true, force: true });

const { notion } = siteConfig;
const sanitize = createFixtureSanitizer(notion);
const api = createRecordingApi(createNotionApi({ token: env.notionToken }), target, sanitize);
const media = new MediaStore({ cacheDir: join(scratch, 'media') });
const site = await syncNotion({
  api,
  media,
  bookmarks: new BookmarkFetcher({ cacheDir: join(scratch, 'bookmarks'), media }),
  cache: new PageCache(join(scratch, 'pages'), LOADER_VERSION),
  config: notion,
  statuses: ['Published'],
  fullRefresh: true,
  log: { info: (message) => console.log(message), warn: (message) => console.warn(message) },
});
await sanitize.prune(target);
await rm(scratch, { recursive: true, force: true });
console.log(
  `Recorded ${site.posts.length} posts, ${site.projects.length} projects and ${site.pages.length} pages into ${target}`,
);
