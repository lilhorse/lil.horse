import { createHash } from 'node:crypto';
import pLimit from 'p-limit';
// TODO: take the URL builder as an option so this module stops knowing the site's routes.
// eslint-disable-next-line no-restricted-imports -- maps Notion page IDs to site URLs; the only site import here
import { buildLinkMap } from '../lib/links';
import { isNotFoundError, type NotionApi } from './api';
import { toIcon } from './ast';
import type { BookmarkFetcher } from './bookmarks';
import { normalizeId, notionUrl } from './ids';
import { readMasthead } from './masthead';
import type { MediaStore } from './media';
import type { PageCache } from './page-cache';
import { buildPageContent } from './page-content';
import { coverUrl, readTitle } from './properties';
import {
  ContentValidationError,
  parsePosts,
  parseProfile,
  parseProjects,
  type ValidationIssue,
} from './schema';
import { excerpt, readingMinutes } from './text';
import type {
  MastheadEntry,
  MediaRef,
  NotionSiteConfig,
  PageContent,
  PostEntry,
  PostStatus,
  ProjectEntry,
  SiteContent,
  StandalonePageEntry,
  StandalonePageKey,
} from './types';

// Bump whenever PageContent or the AST changes shape.
export const LOADER_VERSION = 2;

export interface SyncOptions {
  api: NotionApi;
  media: MediaStore;
  bookmarks: BookmarkFetcher;
  cache: PageCache;
  config: NotionSiteConfig;
  statuses: PostStatus[];
  fullRefresh: boolean;
  log: { info(message: string): void; warn(message: string): void };
  now?: () => number;
}

// Pinned so the order does not depend on the build machine's locale.
const COLLATOR = new Intl.Collator('zh');

const compareCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const byPublishedDesc = (a: PostEntry, b: PostEntry) =>
  compareCodeUnits(b.published, a.published) || compareCodeUnits(a.slug, b.slug);

const byOrderThenName = (a: ProjectEntry, b: ProjectEntry) =>
  (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY) ||
  COLLATOR.compare(a.name, b.name);

const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

const count = (items: unknown[], noun: string) =>
  `${items.length} ${noun}${items.length === 1 ? '' : 's'}`;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Cache checks only: written digests never contain it, so it can never match one.
const MISSING = 'missing';

// Notion truncates edit times to the minute, so a page edited this recently may still change under the same timestamp.
const SETTLE_MS = 120_000;

async function editedTimeOrMissing(api: NotionApi, dataSourceId: string): Promise<string | null> {
  try {
    return await api.latestEditedTime(dataSourceId);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    return MISSING;
  }
}

async function readConfigured<T>(entry: string, id: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    const where = `${notionUrl(id)} (${entry} in site.config.ts)`;
    throw new Error(
      isNotFoundError(error)
        ? `Notion cannot find ${where}; share it with the integration`
        : `Could not read ${where}: ${messageOf(error)}`,
      { cause: error },
    );
  }
}

async function resolveDataSourceId(
  api: NotionApi,
  entry: string,
  databaseId: string,
): Promise<string> {
  const database = await readConfigured(entry, databaseId, () => api.retrieveDatabase(databaseId));
  const source = database.data_sources[0];
  if (!source) throw new Error(`Notion database ${databaseId} has no data source`);
  return normalizeId(source.id);
}

function mastheadOrName(
  read: MastheadEntry | Error,
  name: string,
  pageId: string,
  warn: (message: string) => void,
): MastheadEntry {
  if (read instanceof Error) {
    warn(`The masthead falls back to the profile name: ${read.message}`);
    return { title: name, slogan: null };
  }
  if (!read.title) {
    warn(
      `The masthead page ${notionUrl(pageId)} has no title; the masthead shows the profile name instead`,
    );
    return { title: name, slogan: read.slogan };
  }
  return read;
}

function contentLoader(options: SyncOptions, warn: (message: string) => void) {
  const deps = {
    api: options.api,
    media: options.media,
    bookmarks: options.bookmarks,
    databaseDisplay: options.config.databaseDisplay,
  };
  const displayDigest = digest(options.config.databaseDisplay);
  const digestOf = (lastEditedTime: string, childTimes: (string | null)[]) =>
    digest([LOADER_VERSION, displayDigest, lastEditedTime, childTimes]);
  const now = options.now ?? Date.now;
  return async (pageId: string, lastEditedTime: string): Promise<PageContent> => {
    const cached = options.fullRefresh ? null : await options.cache.read(pageId);
    const mediaPresent = cached?.content.mediaKeys.every((key) => options.media.has(key));
    if (cached && mediaPresent) {
      const childTimes = await Promise.all(
        cached.childDataSourceIds.map((id) => editedTimeOrMissing(options.api, id)),
      );
      if (cached.digest === digestOf(lastEditedTime, childTimes)) {
        for (const message of cached.warnings) warn(message);
        return cached.content;
      }
    }
    const warnings: string[] = [];
    const fetchStartedAt = now();
    const content = await buildPageContent(pageId, {
      ...deps,
      warn: (message) => {
        const located = `${notionUrl(pageId)}: ${message}`;
        warnings.push(located);
        warn(located);
      },
    });
    try {
      const childTimes = await Promise.all(
        content.childDataSourceIds.map((id) => options.api.latestEditedTime(id)),
      );
      const lastEdit = Math.max(
        ...[lastEditedTime, ...childTimes].map((time) => (time ? Date.parse(time) : 0)),
      );
      if (lastEdit < fetchStartedAt - SETTLE_MS) {
        await options.cache.write(pageId, {
          version: LOADER_VERSION,
          digest: digestOf(lastEditedTime, childTimes),
          childDataSourceIds: content.childDataSourceIds,
          warnings,
          content,
        });
      } else {
        // Trashing an inline database's newest row moves its edit time back, so an older record could match again.
        await options.cache.delete(pageId);
      }
    } catch (error) {
      throw new Error(`Failed to cache Notion page ${notionUrl(pageId)}: ${messageOf(error)}`, {
        cause: error,
      });
    }
    return content;
  };
}

function checkLinks(
  posts: PostEntry[],
  projects: ProjectEntry[],
  pages: StandalonePageEntry[],
  warn: (message: string) => void,
): void {
  const linkMap = buildLinkMap({ posts, projects, pages });
  const check = (owner: string, content: PageContent | null) => {
    for (const id of content?.linkedPageIds ?? []) {
      if (!linkMap.has(id))
        warn(
          `"${owner}" links to Notion page ${id}, which is not on the site; the link is not published`,
        );
    }
  };
  for (const post of posts) check(post.title, post.content);
  for (const project of projects) check(project.name, project.content);
  for (const entry of pages) check(entry.title, entry.content);
}

export async function syncNotion(options: SyncOptions): Promise<SiteContent> {
  const warnings: string[] = [];
  const warn = (message: string) => {
    warnings.push(message);
    options.log.warn(message);
  };
  const { api, media, config } = options;

  // Never rejects, so a failure elsewhere cannot leave it unhandled.
  const mastheadRead = readConfigured('mastheadPageId', config.mastheadPageId, () =>
    readMasthead(api, config.mastheadPageId),
  ).catch((error: Error) => error);

  const [postsSource, projectsSource, profileSource] = await Promise.all(
    (['postsDatabaseId', 'projectsDatabaseId', 'profileDatabaseId'] as const).map((entry) =>
      resolveDataSourceId(api, entry, config[entry]),
    ),
  );
  const [postRows, projectRows, profileRows] = await Promise.all(
    [postsSource, projectsSource, profileSource].map((id) => api.queryDataSource(id)),
  );
  const posts = parsePosts(postRows);
  const projects = parseProjects(projectRows);
  const profile = parseProfile(profileRows);
  for (const message of [...posts.warnings, ...projects.warnings, ...profile.warnings])
    warn(message);
  const issues: ValidationIssue[] = [...posts.issues, ...projects.issues, ...profile.issues];

  const loadContent = contentLoader(options, warn);
  const cover = async (pageId: string, url: string | null): Promise<MediaRef | null> => {
    if (!url) return null;
    try {
      return await media.ensure(url, { kind: 'image' });
    } catch (error) {
      throw new Error(
        `Failed to load the cover of Notion page ${notionUrl(pageId)}: ${messageOf(error)}`,
        { cause: error },
      );
    }
  };
  const limit = pLimit(4);

  // A project body without a Slug is a validation issue, so projects load before the check.
  const projectResults = await Promise.allSettled(
    projects.items.map((project) =>
      limit(async (): Promise<ProjectEntry> => {
        const content = await loadContent(project.id, project.lastEditedTime);
        const hasBody = content.blocks.length > 0;
        if (hasBody && !project.slug) {
          issues.push({
            collection: 'projects',
            pageId: project.id,
            title: project.name,
            field: 'Slug',
            message: 'is required when the project page has content',
          });
        }
        return {
          id: project.id,
          name: project.name,
          slug: project.slug,
          description: project.description,
          stack: project.stack,
          link: project.link,
          repo: project.repo,
          status: project.status,
          featured: project.featured,
          order: project.order,
          year: project.year,
          cover: await cover(project.id, project.coverUrl),
          lastEditedTime: project.lastEditedTime,
          content: hasBody ? content : null,
        };
      }),
    ),
  );
  if (issues.length > 0) throw new ContentValidationError(issues);
  const projectEntries = projectResults.map((result) => {
    if (result.status === 'rejected') throw result.reason;
    return result.value;
  });

  const postEntries = await Promise.all(
    posts.items
      .filter((post) => options.statuses.includes(post.status))
      .map((post) =>
        limit(async (): Promise<PostEntry> => {
          const content = await loadContent(post.id, post.lastEditedTime);
          return {
            id: post.id,
            slug: post.slug,
            title: post.title,
            status: post.status,
            published: post.published,
            updated: post.updated,
            tags: post.tags,
            description:
              post.description ?? (content.firstParagraph ? excerpt(content.firstParagraph) : ''),
            language: post.language,
            featured: post.featured,
            cover: await cover(post.id, post.coverUrl),
            lastEditedTime: post.lastEditedTime,
            readingMinutes: readingMinutes(content.plainText),
            content,
          };
        }),
      ),
  );

  const pageEntries = await Promise.all(
    (Object.entries(config.pages) as [StandalonePageKey, string][]).map(([key, id]) =>
      limit(async (): Promise<StandalonePageEntry> => {
        const notionPage = await readConfigured(`pages.${key}`, id, () => api.retrievePage(id));
        const pageId = normalizeId(notionPage.id);
        const title = readTitle(notionPage.properties);
        if (notionPage.icon?.type === 'icon') {
          warn(
            `Page "${title}" (${pageId}) uses a built-in Notion icon, which can't be shown on the site; use an emoji instead`,
          );
        }
        return {
          id: pageId,
          key,
          title,
          icon: await toIcon(notionPage.icon, media),
          cover: await cover(pageId, coverUrl(notionPage)),
          lastEditedTime: notionPage.last_edited_time,
          content: await loadContent(pageId, notionPage.last_edited_time),
        };
      }),
    ),
  );

  const profileEntry = profile.items[0];
  if (!profileEntry) throw new Error('Profile could not be parsed');
  const masthead = mastheadOrName(
    await mastheadRead,
    profileEntry.name,
    config.mastheadPageId,
    warn,
  );
  checkLinks(postEntries, projectEntries, pageEntries, warn);

  const mediaKeys = new Set<string>();
  for (const entry of [...postEntries, ...projectEntries, ...pageEntries]) {
    for (const key of entry.content?.mediaKeys ?? []) mediaKeys.add(key);
    if (entry.cover) mediaKeys.add(entry.cover.key);
  }
  for (const entry of pageEntries)
    if (entry.icon?.kind === 'image') mediaKeys.add(entry.icon.media.key);

  options.log.info(
    `Synced ${count(postEntries, 'post')}, ${count(projectEntries, 'project')} and ${count(pageEntries, 'page')} from Notion`,
  );
  return {
    posts: postEntries.sort(byPublishedDesc),
    projects: projectEntries.sort(byOrderThenName),
    profile: profileEntry,
    masthead,
    pages: pageEntries,
    mediaKeys: [...mediaKeys].sort(),
    warnings,
  };
}
