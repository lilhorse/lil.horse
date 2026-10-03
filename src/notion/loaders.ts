import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Loader, LoaderContext } from 'astro/loaders';
import { siteConfig } from '../../site.config';
import { readEnv } from '../env';
import { createNotionApi, type NotionApi } from './api';
import { BookmarkFetcher } from './bookmarks';
import { createFixtureApi } from './fixture-api';
import { MediaStore } from './media';
import { PageCache } from './page-cache';
import { cachePaths, fixtureDir } from './paths';
import { placeholderFetch } from './placeholder-fetch';
import { LOADER_VERSION, syncNotion } from './sync';
import type { PostStatus, SiteContent } from './types';

export type CollectionKey = 'posts' | 'projects' | 'profile' | 'pages';
type Logger = LoaderContext['logger'];

let pending: Promise<SiteContent> | undefined;

export async function writeMediaManifest(file: string, keys: string[]): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(keys, null, 2)}\n`);
}

export function statusesFor(includeDrafts: boolean): PostStatus[] {
  return includeDrafts ? ['Draft', 'Published', 'Unlisted'] : ['Published', 'Unlisted'];
}

const runtimeEnv = () => readEnv(process.env);

async function runSync(logger: Logger): Promise<SiteContent> {
  const env = runtimeEnv();
  const paths = cachePaths(env.fixtures);
  const offline = env.fixtures ? { fetch: placeholderFetch } : {};
  let api: NotionApi;
  if (env.fixtures) {
    api = createFixtureApi(fixtureDir());
  } else {
    if (!env.notionToken) {
      throw new Error(
        'NOTION_TOKEN is not set. Add it to .env, or run `pnpm build:fixtures` to build from the recorded fixtures.',
      );
    }
    api = createNotionApi({ token: env.notionToken });
  }
  const media = new MediaStore({ cacheDir: paths.media, ...offline });
  const site = await syncNotion({
    api,
    media,
    bookmarks: new BookmarkFetcher({
      cacheDir: paths.bookmarks,
      media,
      ...offline,
      warn: (message) => logger.warn(message),
    }),
    cache: new PageCache(paths.pages, LOADER_VERSION),
    config: siteConfig.notion,
    statuses: statusesFor(env.includeDrafts),
    fullRefresh: env.fullRefresh,
    log: { info: (message) => logger.info(message), warn: (message) => logger.warn(message) },
  });
  await writeMediaManifest(paths.manifest, site.mediaKeys);
  return site;
}

// All four collections share one sync per process; restart `astro dev` to pull new Notion edits.
export function loadSiteContent(logger: Logger): Promise<SiteContent> {
  pending ??= runSync(logger);
  return pending;
}

export function entriesFor(
  site: SiteContent,
  collection: CollectionKey,
): [string, Record<string, unknown>][] {
  switch (collection) {
    case 'posts':
      return site.posts.map((post) => [post.slug, { ...post }]);
    case 'projects':
      return site.projects.map((project) => [project.id, { ...project }]);
    case 'profile':
      return [['profile', { ...site.profile }]];
    case 'pages':
      return site.pages.map((entry) => [entry.key, { ...entry }]);
  }
}

export function notionLoader(collection: CollectionKey): Loader {
  return {
    name: `notion-${collection}`,
    async load({ store, logger, generateDigest }) {
      if (runtimeEnv().skipSync) {
        logger.info('Skipping the Notion sync (NOTION_SKIP_SYNC=1)');
        return;
      }
      const site = await loadSiteContent(logger);
      store.clear();
      for (const [id, data] of entriesFor(site, collection))
        store.set({ id, data, digest: generateDigest(data) });
    },
  };
}
