import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BookmarkFetcher } from '../../src/notion/bookmarks';
import { MediaStore } from '../../src/notion/media';
import { PageCache } from '../../src/notion/page-cache';
import { placeholderFetch } from '../../src/notion/placeholder-fetch';
import { ContentValidationError } from '../../src/notion/schema';
import { LOADER_VERSION, syncNotion, type SyncOptions } from '../../src/notion/sync';
import type { NotionSiteConfig, PostStatus } from '../../src/notion/types';
import { FakeNotionApi } from '../helpers/fake-api';
import { block, database, dataSource, nextId, page, prop, rt } from '../helpers/notion-factory';
import { tempDir } from '../helpers/temp-dir';

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
  const about = page({ title: prop.title('About') }, { id: ids.about });
  const contact = page({ title: prop.title('Contact') }, { id: ids.contact });
  api.pages.set(ids.about, about);
  api.pages.set(ids.contact, contact);

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
    sources,
    posts: { hello, douban, secret, draft },
    projects: { site, tool },
    pages: { about, contact },
    moviesDb,
    moviesDs,
  };
}

async function options(
  api: FakeNotionApi,
  config: NotionSiteConfig,
  overrides: Partial<SyncOptions> = {},
  dir?: string,
) {
  const root = dir ?? (await tempDir('sync-'));
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

  it('warns about rich-text and page links to pages the site does not publish', async () => {
    const { api, config, posts, projects } = workspace();
    api.setChildren(posts.hello.id, [
      block('paragraph', {
        rich_text: [
          rt('About', { href: `/${config.pages.about}` }),
          rt('Douban', { href: `https://www.notion.so/${posts.douban.id}` }),
        ],
        color: 'default',
      }),
      block('link_to_page', { type: 'page_id', page_id: projects.site.id }),
      block('link_to_page', { type: 'page_id', page_id: projects.tool.id }),
    ]);
    const { value, warnings } = await options(api, config);
    await syncNotion(value);

    expect(warnings.filter((warning) => warning.includes('links to Notion page')).sort()).toEqual([
      `"Hello World" links to Notion page ${projects.tool.id}, which is not on the site; the link is not published`,
      `"Secret" links to Notion page ${posts.draft.id}, which is not on the site; the link is not published`,
    ]);
  });

  it('counts included drafts as on the site when checking links', async () => {
    const { api, config } = workspace();
    const { value, warnings } = await options(api, config, {
      statuses: ['Draft', 'Published', 'Unlisted'],
    });
    await syncNotion(value);
    expect(warnings.filter((warning) => warning.includes('links to Notion page'))).toEqual([]);
  });

  it('warns that a standalone page cannot show a built-in Notion icon', async () => {
    const { api, config, pages } = workspace();
    pages.about.icon = { type: 'icon', icon: { name: 'star', color: 'gray' } };
    const { value, warnings } = await options(api, config);
    const site = await syncNotion(value);

    expect(site.pages.find((entry) => entry.key === 'about')?.icon).toBeNull();
    expect(warnings).toContain(
      `Page "About" (${pages.about.id}) uses a built-in Notion icon, which can't be shown on the site; use an emoji instead`,
    );
  });

  it('lists page covers and image icons among the media the site needs', async () => {
    const { api, config, pages } = workspace();
    pages.about.icon = { type: 'external', external: { url: 'https://images.example.com/me.png' } };
    pages.about.cover = {
      type: 'external',
      external: { url: 'https://images.example.com/sky.jpg' },
    };
    const { value } = await options(api, config);
    const site = await syncNotion(value);

    const about = site.pages.find((entry) => entry.key === 'about');
    const icon = about?.icon?.kind === 'image' ? about.icon.media.key : undefined;
    expect(icon).toMatch(/^[0-9a-f]{16}$/);
    expect(site.mediaKeys).toEqual(expect.arrayContaining([icon, about?.cover?.key]));
  });

  it('orders same-day posts by slug, whatever order Notion returns them in', async () => {
    const { api, config, sources, posts } = workspace();
    posts.hello.properties.Published = posts.douban.properties.Published;
    for (const rows of [
      [posts.hello, posts.douban],
      [posts.douban, posts.hello],
    ]) {
      api.rows.set(sources.posts, rows);
      const { value } = await options(api, config);
      expect((await syncNotion(value)).posts.map((post) => post.slug)).toEqual([
        'douban',
        'helloworld',
      ]);
    }
  });

  it('orders projects by Order with blanks last, then by name in pinyin order', async () => {
    const { api, config, sources, projects } = workspace();
    const city = (name: string) =>
      page({
        Name: prop.title(name),
        Visible: prop.checkbox(true),
        Description: prop.text(name),
        Order: prop.number(2),
      });
    projects.tool.properties.Order = { id: 'o', type: 'number', number: null } as never;
    const rows = [projects.tool, projects.site, city('上海'), city('北京')];
    for (const input of [rows, [...rows].reverse()]) {
      api.rows.set(sources.projects, input);
      const { value } = await options(api, config);
      expect((await syncNotion(value)).projects.map((project) => project.name)).toEqual([
        '北京',
        '上海',
        'lil.horse',
        'Tool',
      ]);
    }
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

  it('fetches a page edited in the last two minutes again until its edit time settles', async () => {
    const { api, config, posts } = workspace();
    posts.hello.last_edited_time = '2024-05-01T12:00:00.000Z';
    const { root } = await options(api, config);
    const syncAt = async (now: string) =>
      syncNotion((await options(api, config, { now: () => Date.parse(now) }, root)).value);

    await syncAt('2024-05-01T12:01:30.000Z');
    await syncAt('2024-05-01T12:02:00.000Z');
    expect(blockFetches(api, posts.hello.id)).toBe(2);
    expect(blockFetches(api, posts.douban.id)).toBe(1);

    await syncAt('2024-05-01T12:02:00.001Z');
    await syncAt('2024-05-01T12:02:00.001Z');
    expect(blockFetches(api, posts.hello.id)).toBe(3);
  });

  it('fetches a page again while its inline database was edited in the last two minutes', async () => {
    const { api, config, posts, moviesDs } = workspace();
    api.latest.set(moviesDs, '2024-05-01T12:00:00.000Z');
    const { root } = await options(api, config);
    const now = () => Date.parse('2024-05-01T12:01:30.000Z');
    await syncNotion((await options(api, config, { now }, root)).value);
    await syncNotion((await options(api, config, { now }, root)).value);
    expect(blockFetches(api, posts.douban.id)).toBe(2);
    expect(blockFetches(api, posts.hello.id)).toBe(1);
  });

  it('does not serve a trashed inline database row from an older cache record', async () => {
    const { api, config, posts, moviesDs } = workspace();
    const strays = page({ Name: prop.title('Strays') });
    api.rows.set(moviesDs, [strays, page({ Name: prop.title('Heat') })]);
    api.latest.set(moviesDs, strays.last_edited_time);
    const { root } = await options(api, config);
    const syncAt = async (now: string) =>
      syncNotion((await options(api, config, { now: () => Date.parse(now) }, root)).value);

    await syncAt('2024-05-01T12:01:30.000Z');
    api.latest.set(moviesDs, '2024-05-01T12:01:00.000Z');
    await syncAt('2024-05-01T12:01:30.000Z');
    api.rows.set(moviesDs, [strays]);
    api.latest.set(moviesDs, strays.last_edited_time);
    const site = await syncAt('2024-05-01T13:00:00.000Z');

    expect(blockFetches(api, posts.douban.id)).toBe(3);
    const douban = site.posts.find((post) => post.slug === 'douban');
    expect(
      douban?.content.blocks
        .flatMap((node) => (node.type === 'database' ? node.rows : []))
        .map((row) => row.id),
    ).toEqual([strays.id]);
  });

  it('names the page in its content warnings, also when a cached page repeats them', async () => {
    const { api, config, posts } = workspace();
    const unsupported = block('unsupported', { block_type: 'ai_block' });
    api.setChildren(posts.hello.id, [unsupported]);
    const warning = `https://www.notion.so/${posts.hello.id}: Unsupported Notion block "ai_block" (${unsupported.id}) skipped`;
    const { root } = await options(api, config);

    const first = await options(api, config, {}, root);
    await syncNotion(first.value);
    expect(first.warnings).toContain(warning);

    const second = await options(api, config, {}, root);
    const site = await syncNotion(second.value);
    expect(blockFetches(api, posts.hello.id)).toBe(1);
    expect(second.warnings).toContain(warning);
    expect(site.warnings).toContain(warning);
  });

  it('stores bookmark warnings with the page and repeats them on a cache hit', async () => {
    const { api, config, posts } = workspace();
    api.setChildren(posts.hello.id, [
      block('bookmark', { url: 'ftp://example.com/a', caption: [] }),
    ]);
    const warning = `https://www.notion.so/${posts.hello.id}: Bookmark metadata unavailable for ftp://example.com/a: not an http(s) URL`;
    const { root } = await options(api, config);

    const first = await options(api, config, {}, root);
    expect((await syncNotion(first.value)).warnings).toContain(warning);
    const record = await new PageCache(join(root, 'pages'), LOADER_VERSION).read(posts.hello.id);
    expect(record?.warnings).toContain(warning);

    const second = await options(api, config, {}, root);
    const site = await syncNotion(second.value);
    expect(blockFetches(api, posts.hello.id)).toBe(1);
    expect(second.warnings).toContain(warning);
    expect(site.warnings).toContain(warning);
  });

  it('rebuilds cached pages when the inline database display config changes', async () => {
    const { api, config, posts, moviesDb } = workspace();
    const { root } = await options(api, config);
    await syncNotion((await options(api, config, {}, root)).value);

    const configured: NotionSiteConfig = {
      ...config,
      databaseDisplay: { [moviesDb]: { columns: [{ property: 'Name' }] } },
    };
    await syncNotion((await options(api, configured, {}, root)).value);
    expect(blockFetches(api, posts.douban.id)).toBe(2);

    await syncNotion((await options(api, structuredClone(configured), {}, root)).value);
    expect(blockFetches(api, posts.douban.id)).toBe(2);
  });

  it('rebuilds a cached page whose media is missing from the store', async () => {
    const { api, config, posts } = workspace();
    api.setChildren(posts.hello.id, [
      block('image', {
        type: 'external',
        external: { url: 'https://images.example.com/photo.jpg' },
        caption: [rt('A photo')],
      }),
    ]);
    const { root } = await options(api, config);
    const first = await options(api, config, {}, root);
    const site = await syncNotion(first.value);
    const [key] = site.posts.find((post) => post.slug === 'helloworld')?.content.mediaKeys ?? [];
    expect(key).toMatch(/^[0-9a-f]{16}$/);

    await rm(first.value.media.directoryFor(key), { recursive: true });
    await syncNotion((await options(api, config, {}, root)).value);
    expect(blockFetches(api, posts.hello.id)).toBe(2);
  });

  it('does not check inline databases with Notion while a cached page is missing media', async () => {
    const { api, config, posts, moviesDb, moviesDs } = workspace();
    api.setChildren(posts.douban.id, [
      block('image', {
        type: 'external',
        external: { url: 'https://images.example.com/poster.jpg' },
        caption: [rt('A poster')],
      }),
      block('child_database', { title: 'Movies' }, { id: moviesDb }),
    ]);
    const { root } = await options(api, config);
    const first = await options(api, config, {}, root);
    const site = await syncNotion(first.value);
    const [key] = site.posts.find((post) => post.slug === 'douban')?.content.mediaKeys ?? [];
    await rm(first.value.media.directoryFor(key), { recursive: true });

    const before = api.calls.length;
    await syncNotion((await options(api, config, {}, root)).value);
    expect(blockFetches(api, posts.douban.id)).toBe(2);
    expect(
      api.calls.slice(before).filter((call) => call === `latestEditedTime:${moviesDs}`),
    ).toHaveLength(1);
  });

  it('rebuilds a cached page whose inline database is no longer shared', async () => {
    const { api, config, posts, moviesDb } = workspace();
    const { root } = await options(api, config);
    await syncNotion((await options(api, config, {}, root)).value);

    api.databases.delete(moviesDb);
    vi.spyOn(api, 'latestEditedTime').mockRejectedValue(
      Object.assign(new Error('Could not find data source'), { code: 'object_not_found' }),
    );
    const { value, warnings } = await options(api, config, {}, root);
    const site = await syncNotion(value);

    expect(blockFetches(api, posts.douban.id)).toBe(2);
    const douban = site.posts.find((post) => post.slug === 'douban');
    expect(douban?.content.childDataSourceIds).toEqual([]);
    expect(douban?.content.blocks.map((node) => node.type)).toEqual(['paragraph']);
    expect(warnings).toContainEqual(
      expect.stringContaining(`Inline database "Movies" (${moviesDb}) is not shared`),
    );
  });

  it('fails when an inline database cannot be checked for any other reason', async () => {
    const { api, config } = workspace();
    const { root } = await options(api, config);
    await syncNotion((await options(api, config, {}, root)).value);

    vi.spyOn(api, 'latestEditedTime').mockRejectedValue(new Error('Bad gateway'));
    await expect(syncNotion((await options(api, config, {}, root)).value)).rejects.toThrow(
      'Bad gateway',
    );
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

  it('reports a missing project slug together with the other validation issues', async () => {
    const { api, config, posts, projects } = workspace();
    posts.douban.properties.Published = { id: 'p', type: 'date', date: null } as never;
    api.setChildren(projects.tool.id, [
      block('paragraph', { rich_text: [rt('Details')], color: 'default' }),
    ]);
    const { value } = await options(api, config);
    const error = await syncNotion(value).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ContentValidationError);
    expect((error as ContentValidationError).issues.map((issue) => issue.field).sort()).toEqual([
      'Published',
      'Slug',
    ]);
  });

  it('reports validation issues before a project page that fails to load', async () => {
    const { api, config, posts, projects } = workspace();
    const published = posts.douban.properties.Published;
    posts.douban.properties.Published = { id: 'p', type: 'date', date: null } as never;
    const listBlockChildren = api.listBlockChildren.bind(api);
    vi.spyOn(api, 'listBlockChildren').mockImplementation((id) =>
      id === projects.tool.id ? Promise.reject(new Error('Bad gateway')) : listBlockChildren(id),
    );
    const error = await syncNotion((await options(api, config)).value).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ContentValidationError);
    expect((error as ContentValidationError).issues).toMatchObject([
      { pageId: posts.douban.id, field: 'Published' },
    ]);

    posts.douban.properties.Published = published;
    await expect(syncNotion((await options(api, config)).value)).rejects.toThrow(
      `${projects.tool.id}: Bad gateway`,
    );
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
