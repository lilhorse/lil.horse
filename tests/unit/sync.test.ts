import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BookmarkFetcher } from '../../src/notion/bookmarks';
import { MediaStore } from '../../src/notion/media';
import { PageCache } from '../../src/notion/page-cache';
import { placeholderFetch } from '../../src/notion/placeholder-fetch';
import { ContentValidationError } from '../../src/notion/schema';
import { LOADER_VERSION, syncNotion, type SyncOptions } from '../../src/notion/sync';
import type { NotionSiteConfig, PostStatus } from '../../src/notion/types';
import { FakeNotionApi } from '../helpers/fake-api';
import { block, database, dataSource, nextId, page, prop, rt } from '../helpers/notion-factory';

function workspace() {
  const api = new FakeNotionApi();
  const ids = {
    posts: nextId(),
    projects: nextId(),
    profile: nextId(),
    about: nextId(),
    contact: nextId(),
  };
  const sources = { posts: nextId(), projects: nextId(), profile: nextId() };
  for (const key of ['posts', 'projects', 'profile'] as const)
    api.databases.set(ids[key], database(ids[key], sources[key]));

  const hello = page(
    {
      Name: prop.title('Hello World'),
      Slug: prop.text('helloworld'),
      Status: prop.status('Published'),
      Published: prop.date('2024-01-11'),
      Language: prop.select('en'),
    },
    { cover: 'https://images.example.com/cover.jpg' },
  );
  const douban = page({
    Name: prop.title('My Douban Backup'),
    Slug: prop.text('douban'),
    Status: prop.status('Published'),
    Published: prop.date('2024-02-29'),
  });
  const secret = page({
    Name: prop.title('Secret'),
    Slug: prop.text('secret'),
    Status: prop.status('Unlisted'),
    Published: prop.date('2024-03-01'),
  });
  const draft = page({
    Name: prop.title('WIP'),
    Slug: prop.text('wip'),
    Status: prop.status('Draft'),
  });
  api.rows.set(sources.posts, [hello, douban, secret, draft]);

  const site = page({
    Name: prop.title('lil.horse'),
    Visible: prop.checkbox(true),
    Description: prop.text('This site'),
    Slug: prop.text('lil-horse'),
    Order: prop.number(2),
  });
  const tool = page({
    Name: prop.title('Tool'),
    Visible: prop.checkbox(true),
    Description: prop.text('A tool'),
    Order: prop.number(1),
  });
  api.rows.set(sources.projects, [site, tool]);
  api.rows.set(sources.profile, [
    page({
      Name: prop.title("Lil'Horse"),
      Role: prop.text('Developer'),
      Location: prop.text('Auckland'),
      Availability: prop.select('Open to work'),
    }),
  ]);
  api.pages.set(ids.about, page({ title: prop.title('About') }, { id: ids.about }));
  api.pages.set(ids.contact, page({ title: prop.title('Contact') }, { id: ids.contact }));

  const moviesDb = nextId();
  const moviesDs = nextId();
  api.databases.set(moviesDb, database(moviesDb, moviesDs, 'Movies'));
  api.dataSources.set(moviesDs, dataSource(moviesDs, { Name: { id: 'title', type: 'title' } }));
  api.rows.set(moviesDs, [page({ Name: prop.title('Strays') })]);
  api.latest.set(moviesDs, '2024-03-01T00:00:00.000Z');

  api.setChildren(hello.id, [
    block('paragraph', { rich_text: [rt('Welcome to my blog. '.repeat(3))], color: 'default' }),
  ]);
  api.setChildren(douban.id, [
    block('paragraph', { rich_text: [rt('Douban backup.')], color: 'default' }),
    block('child_database', { title: 'Movies' }, { id: moviesDb }),
  ]);
  api.setChildren(secret.id, [
    block('paragraph', { rich_text: [rt('Hidden', { href: `/${draft.id}` })], color: 'default' }),
  ]);
  api.setChildren(site.id, [
    block('paragraph', { rich_text: [rt('How this site is built.')], color: 'default' }),
  ]);
  api.setChildren(ids.about, [
    block('paragraph', { rich_text: [rt('About me.')], color: 'default' }),
  ]);
  api.setChildren(ids.contact, [
    block('paragraph', { rich_text: [rt('Say hi.')], color: 'default' }),
  ]);

  const config: NotionSiteConfig = {
    postsDatabaseId: ids.posts,
    projectsDatabaseId: ids.projects,
    profileDatabaseId: ids.profile,
    pages: { about: ids.about, contact: ids.contact },
    databaseDisplay: {},
  };
  return {
    api,
    config,
    posts: { hello, douban, secret, draft },
    projects: { site, tool },
    moviesDs,
  };
}

async function options(
  api: FakeNotionApi,
  config: NotionSiteConfig,
  overrides: Partial<SyncOptions> = {},
  dir?: string,
) {
  const root = dir ?? (await mkdtemp(join(tmpdir(), 'sync-')));
  const media = new MediaStore({ cacheDir: join(root, 'media'), fetch: placeholderFetch });
  const warnings: string[] = [];
  const value: SyncOptions = {
    api,
    media,
    bookmarks: new BookmarkFetcher({
      cacheDir: join(root, 'bookmarks'),
      media,
      fetch: placeholderFetch,
    }),
    cache: new PageCache(join(root, 'pages'), LOADER_VERSION),
    config,
    statuses: ['Published', 'Unlisted'] satisfies PostStatus[],
    fullRefresh: false,
    log: { info: () => undefined, warn: (message) => warnings.push(message) },
    ...overrides,
  };
  return { value, warnings, root };
}

const blockFetches = (api: FakeNotionApi, pageId: string) =>
  api.calls.filter((call) => call === `listBlockChildren:${pageId}`).length;

describe('syncNotion', () => {
  it('assembles posts, projects, profile and pages', async () => {
    const { api, config, posts, projects } = workspace();
    const { value, warnings } = await options(api, config);
    const site = await syncNotion(value);

    expect(site.posts.map((post) => post.slug)).toEqual(['secret', 'douban', 'helloworld']);
    const hello = site.posts.find((post) => post.slug === 'helloworld');
    expect(hello?.description).toBe('Welcome to my blog. Welcome to my blog. Welcome to my blog.');
    expect(hello?.readingMinutes).toBe(1);
    expect(hello?.cover?.key).toMatch(/^[0-9a-f]{16}$/);
    expect(site.mediaKeys).toContain(hello?.cover?.key);
    expect(
      site.posts.find((post) => post.slug === 'douban')?.content.childDataSourceIds,
    ).toHaveLength(1);

    expect(site.projects.map((project) => [project.name, project.content === null])).toEqual([
      ['Tool', true],
      ['lil.horse', false],
    ]);
    expect(site.projects.find((project) => project.id === projects.site.id)?.slug).toBe(
      'lil-horse',
    );
    expect(site.profile.name).toBe("Lil'Horse");
    expect(site.pages.map((entry) => [entry.key, entry.title])).toEqual([
      ['about', 'About'],
      ['contact', 'Contact'],
    ]);
    expect(warnings.some((warning) => warning.includes(posts.draft.id))).toBe(true);
  });

  it('includes drafts only when asked', async () => {
    const { api, config } = workspace();
    const { value } = await options(api, config, { statuses: ['Draft', 'Published', 'Unlisted'] });
    expect((await syncNotion(value)).posts.map((post) => post.slug)).toContain('wip');
  });

  it('reuses cached pages until the page or its inline database changes', async () => {
    const { api, config, posts, moviesDs } = workspace();
    const { root } = await options(api, config);
    await syncNotion((await options(api, config, {}, root)).value);
    expect(blockFetches(api, posts.hello.id)).toBe(1);

    await syncNotion((await options(api, config, {}, root)).value);
    expect(blockFetches(api, posts.hello.id)).toBe(1);
    expect(blockFetches(api, posts.douban.id)).toBe(1);

    api.latest.set(moviesDs, '2024-04-01T00:00:00.000Z');
    posts.hello.last_edited_time = '2024-05-01T00:00:00.000Z';
    await syncNotion((await options(api, config, {}, root)).value);
    expect(blockFetches(api, posts.hello.id)).toBe(2);
    expect(blockFetches(api, posts.douban.id)).toBe(2);

    await syncNotion((await options(api, config, { fullRefresh: true }, root)).value);
    expect(blockFetches(api, posts.hello.id)).toBe(3);
  });

  it('treats a corrupt cache file as a miss', async () => {
    const { api, config, posts } = workspace();
    const { root } = await options(api, config);
    await syncNotion((await options(api, config, {}, root)).value);
    await writeFile(join(root, 'pages', `${posts.hello.id}.json`), '{ not json');
    await expect(syncNotion((await options(api, config, {}, root)).value)).resolves.toBeDefined();
    expect(blockFetches(api, posts.hello.id)).toBe(2);
  });

  it('reports every validation issue at once', async () => {
    const { api, config, posts } = workspace();
    posts.hello.properties.Slug = {
      id: 's',
      type: 'rich_text',
      rich_text: [rt('Hello World')],
    } as never;
    posts.douban.properties.Published = { id: 'p', type: 'date', date: null } as never;
    const { value } = await options(api, config);
    const error = await syncNotion(value).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ContentValidationError);
    expect((error as ContentValidationError).issues.map((issue) => issue.field).sort()).toEqual([
      'Published',
      'Slug',
    ]);
  });

  it('requires a slug for projects that have a page body', async () => {
    const { api, config, projects } = workspace();
    api.setChildren(projects.tool.id, [
      block('paragraph', { rich_text: [rt('Details')], color: 'default' }),
    ]);
    const { value } = await options(api, config);
    await expect(syncNotion(value)).rejects.toThrow(
      'is required when the project page has content',
    );
  });
});
