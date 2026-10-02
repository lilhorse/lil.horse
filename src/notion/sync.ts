import { createHash } from 'node:crypto';
import pLimit from 'p-limit';
import type { NotionApi } from './api';
import { toIcon } from './ast';
import type { BookmarkFetcher } from './bookmarks';
import { normalizeId } from './ids';
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

export const LOADER_VERSION = 1;

export interface SyncOptions {
  api: NotionApi;
  media: MediaStore;
  bookmarks: BookmarkFetcher;
  cache: PageCache;
  config: NotionSiteConfig;
  statuses: PostStatus[];
  fullRefresh: boolean;
  log: { info(message: string): void; warn(message: string): void };
}

const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

async function resolveDataSourceId(api: NotionApi, databaseId: string): Promise<string> {
  const source = (await api.retrieveDatabase(databaseId)).data_sources[0];
  if (!source) throw new Error(`Notion database ${databaseId} has no data source`);
  return normalizeId(source.id);
}

function contentLoader(options: SyncOptions, warn: (message: string) => void) {
  const deps = {
    api: options.api,
    media: options.media,
    bookmarks: options.bookmarks,
    databaseDisplay: options.config.databaseDisplay,
    warn,
  };
  const digestOf = (lastEditedTime: string, childTimes: (string | null)[]) =>
    digest([LOADER_VERSION, lastEditedTime, childTimes]);
  return async (pageId: string, lastEditedTime: string): Promise<PageContent> => {
    const cached = options.fullRefresh ? null : await options.cache.read(pageId);
    if (cached) {
      const childTimes = await Promise.all(
        cached.childDataSourceIds.map((id) => options.api.latestEditedTime(id)),
      );
      const mediaPresent = cached.content.mediaKeys.every((key) => options.media.has(key));
      if (mediaPresent && cached.digest === digestOf(lastEditedTime, childTimes))
        return cached.content;
    }
    const content = await buildPageContent(pageId, deps);
    const childTimes = await Promise.all(
      content.childDataSourceIds.map((id) => options.api.latestEditedTime(id)),
    );
    await options.cache.write(pageId, {
      version: LOADER_VERSION,
      digest: digestOf(lastEditedTime, childTimes),
      childDataSourceIds: content.childDataSourceIds,
      content,
    });
    return content;
  };
}

function checkLinks(
  posts: PostEntry[],
  projects: ProjectEntry[],
  pages: StandalonePageEntry[],
  warn: (message: string) => void,
): void {
  const published = new Set<string>([
    ...posts.map((post) => post.id),
    ...projects.filter((project) => project.content && project.slug).map((project) => project.id),
    ...pages.map((entry) => entry.id),
  ]);
  const check = (owner: string, content: PageContent | null) => {
    for (const id of content?.linkedPageIds ?? []) {
      if (!published.has(id))
        warn(
          `"${owner}" links to Notion page ${id}, which is not on the site; it renders as plain text`,
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

  const [postsSource, projectsSource, profileSource] = await Promise.all(
    [config.postsDatabaseId, config.projectsDatabaseId, config.profileDatabaseId].map((id) =>
      resolveDataSourceId(api, id),
    ),
  );
  const [postRows, projectRows, profileRows] = await Promise.all(
    [postsSource, projectsSource, profileSource].map((id) => api.queryDataSource(id as string)),
  );
  const posts = parsePosts(postRows ?? []);
  const projects = parseProjects(projectRows ?? []);
  const profile = parseProfile(profileRows ?? []);
  for (const message of [...posts.warnings, ...projects.warnings, ...profile.warnings])
    warn(message);
  const issues: ValidationIssue[] = [...posts.issues, ...projects.issues, ...profile.issues];
  if (issues.length > 0) throw new ContentValidationError(issues);

  const loadContent = contentLoader(options, warn);
  const cover = (url: string | null): Promise<MediaRef | null> =>
    url ? media.ensure(url, { kind: 'image' }) : Promise.resolve(null);
  const limit = pLimit(4);

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
            cover: await cover(post.coverUrl),
            lastEditedTime: post.lastEditedTime,
            readingMinutes: readingMinutes(content.plainText),
            content,
          };
        }),
      ),
  );

  const projectIssues: ValidationIssue[] = [];
  const projectEntries = await Promise.all(
    projects.items.map((project) =>
      limit(async (): Promise<ProjectEntry> => {
        const content = await loadContent(project.id, project.lastEditedTime);
        const hasBody = content.blocks.length > 0;
        if (hasBody && !project.slug) {
          projectIssues.push({
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
          cover: await cover(project.coverUrl),
          lastEditedTime: project.lastEditedTime,
          content: hasBody ? content : null,
        };
      }),
    ),
  );
  if (projectIssues.length > 0) throw new ContentValidationError(projectIssues);

  const pageEntries = await Promise.all(
    (Object.entries(config.pages) as [StandalonePageKey, string][]).map(([key, id]) =>
      limit(async (): Promise<StandalonePageEntry> => {
        const notionPage = await api.retrievePage(id);
        const pageId = normalizeId(notionPage.id);
        return {
          id: pageId,
          key,
          title: readTitle(notionPage.properties),
          icon: await toIcon(notionPage.icon, media),
          cover: await cover(coverUrl(notionPage)),
          lastEditedTime: notionPage.last_edited_time,
          content: await loadContent(pageId, notionPage.last_edited_time),
        };
      }),
    ),
  );

  const profileEntry = profile.items[0];
  if (!profileEntry) throw new Error('Profile could not be parsed');
  checkLinks(postEntries, projectEntries, pageEntries, warn);

  const mediaKeys = new Set<string>();
  for (const entry of [...postEntries, ...projectEntries, ...pageEntries]) {
    for (const key of entry.content?.mediaKeys ?? []) mediaKeys.add(key);
    if (entry.cover) mediaKeys.add(entry.cover.key);
  }
  for (const entry of pageEntries)
    if (entry.icon?.kind === 'image') mediaKeys.add(entry.icon.media.key);

  options.log.info(
    `Synced ${postEntries.length} posts, ${projectEntries.length} projects and ${pageEntries.length} pages from Notion`,
  );
  return {
    posts: postEntries.sort((a, b) => b.published.localeCompare(a.published)),
    projects: projectEntries.sort(
      (a, b) =>
        (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY) ||
        a.name.localeCompare(b.name),
    ),
    profile: profileEntry,
    pages: pageEntries,
    mediaKeys: [...mediaKeys].sort(),
    warnings,
  };
}
