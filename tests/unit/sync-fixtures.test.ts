import { join } from 'node:path';
import type { BlockObjectResponse } from '@notionhq/client';
import { describe, expect, it } from 'vitest';
import type { NotionApi } from '../../src/notion/api';
import { BookmarkFetcher } from '../../src/notion/bookmarks';
import { createFixtureApi, createRecordingApi } from '../../src/notion/fixture-api';
import { mediaCacheKey, MediaStore } from '../../src/notion/media';
import { PageCache } from '../../src/notion/page-cache';
import { placeholderFetch } from '../../src/notion/placeholder-fetch';
import { plain } from '../../src/notion/rich-text';
import { createFixtureSanitizer } from '../../src/notion/sanitize';
import { LOADER_VERSION, syncNotion } from '../../src/notion/sync';
import { walk } from '../../src/notion/text';
import type {
  NotionSiteConfig,
  Node,
  PageContent,
  PostStatus,
  SiteContent,
} from '../../src/notion/types';
import { FakeNotionApi } from '../helpers/fake-api';
import {
  block,
  database,
  dataSource,
  equation,
  mention,
  nextId,
  page,
  prop,
  rt,
  tableView,
} from '../helpers/notion-factory';
import { tempDir } from '../helpers/temp-dir';

const WORKSPACE_ID = '7f3d2c1b-4a5e-4f60-8b9c-0d1e2f3a4b5c';
const FILE_ID = 'c4b3a291-8076-4e5d-9c3b-2a1f0e9d8c7b';
const ZERO_ID = '00000000-0000-0000-0000-000000000000';

const fileUrl = (workspaceId: string, name: string) =>
  `https://prod-files-secure.s3.us-west-2.amazonaws.com/${workspaceId}/${FILE_ID}/${name}`;

const text = (content: string) =>
  block('paragraph', { rich_text: [rt(content)], color: 'default' });

function workspace() {
  const api = new FakeNotionApi();
  const notionFiles: string[] = [];
  const notionFile = (name: string) => {
    notionFiles.push(name);
    return {
      type: 'file' as const,
      file: {
        url: `${fileUrl(WORKSPACE_ID, name)}?X-Amz-Signature=abc`,
        expiry_time: '2024-01-01T01:00:00.000Z',
      },
    };
  };
  const parent = (type: string, data: Record<string, unknown>, children: BlockObjectResponse[]) => {
    const item = block(type, data, { hasChildren: true });
    api.setChildren(item.id, children);
    return item;
  };
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

  const hello = page({
    Name: prop.title('Hello World'),
    Slug: prop.text('helloworld'),
    Status: prop.status('Published'),
    Published: prop.date('2024-01-11'),
    Updated: prop.date('2024-02-01'),
    Tags: prop.multiSelect(['notes']),
    Language: prop.select('en'),
    Featured: prop.checkbox(true),
  });
  hello.cover = notionFile('cover.png');
  const douban = page({
    Name: prop.title('My Douban Backup'),
    Slug: prop.text('douban'),
    Status: prop.status('Published'),
    Published: prop.date('2024-02-29'),
    Description: prop.text('Movies and books I logged.'),
    Language: prop.select('zh'),
  });
  api.rows.set(sources.posts, [hello, douban]);

  const site = page({
    Name: prop.title('lil.horse'),
    Visible: prop.checkbox(true),
    Description: prop.text('This site'),
    Slug: prop.text('lil-horse'),
    Stack: prop.multiSelect(['Astro', 'Notion']),
    Status: prop.select('Active'),
    Link: prop.url('https://lil.horse'),
    Repo: prop.url('https://github.com/lilhorse/lil.horse'),
    Order: prop.number(1),
    Year: prop.number(2026),
    Featured: prop.checkbox(true),
  });
  const tool = page({
    Name: prop.title('Tool'),
    Visible: prop.checkbox(true),
    Description: prop.text('A tool'),
    Order: prop.number(2),
  });
  api.rows.set(sources.projects, [site, tool]);
  api.rows.set(sources.profile, [
    page({
      Name: prop.title("Lil'Horse"),
      Role: prop.text('Developer'),
      Location: prop.text('Auckland'),
      Availability: prop.select('Open to work'),
      Email: prop.email('me@lil.horse'),
      GitHub: prop.text('lilhorse'),
      Stack: prop.multiSelect(['TypeScript']),
      Bio: prop.text('Hi.'),
    }),
  ]);

  const about = page({ title: prop.title('About') }, { id: ids.about });
  about.icon = { type: 'emoji', emoji: '🐴' };
  about.cover = notionFile('about.jpg');
  const contact = page({ title: prop.title('Contact') }, { id: ids.contact });
  contact.icon = { type: 'external', external: { url: 'https://images.example.com/horse.png' } };
  api.pages.set(ids.about, about);
  api.pages.set(ids.contact, contact);

  const [moviesDb, moviesDs, linkedDb, booksDb, booksDs, contactsDb, contactsDs] = Array.from(
    { length: 7 },
    nextId,
  );
  api.databases.set(moviesDb, database(moviesDb, moviesDs, 'Movies'));
  api.dataSources.set(moviesDs, {
    ...dataSource(moviesDs, {
      Name: { id: 'title', type: 'title' },
      Rating: { id: 'rating', type: 'select' },
      Watched: { id: 'watched', type: 'date' },
      Note: { id: 'note', type: 'rich_text' },
    }),
    title: [rt('Watched movies')],
  });
  const movies = ['Strays', 'Dune', 'Heat', 'Up'].map((name, index) =>
    page({
      Name: prop.title(name),
      Rating: prop.select(String(5 - index)),
      Watched: prop.date(`2024-0${index + 1}-01`),
      Note: prop.text(`Note on ${name}`),
    }),
  );
  const [strays, dune, heat, up] = movies;
  api.rows.set(moviesDs, movies);
  api.views.set(moviesDb, [
    {
      ...tableView('movies-view', [
        { property_id: 'title' },
        { property_id: 'rating' },
        { property_id: 'note', visible: false },
      ]),
      data_source_id: moviesDs,
    },
  ]);
  api.viewOrders.set('movies-view', [dune.id, strays.id, up.id]);
  api.databases.set(linkedDb, { ...database(linkedDb, moviesDs, 'Untitled'), data_sources: [] });
  api.views.set(linkedDb, [
    {
      ...tableView('linked-view', [{ property_id: 'title' }, { property_id: 'watched' }]),
      data_source_id: moviesDs,
    },
  ]);
  api.viewOrders.set('linked-view', [heat.id]);

  api.databases.set(booksDb, database(booksDb, booksDs, 'Books'));
  api.dataSources.set(
    booksDs,
    dataSource(booksDs, {
      Name: { id: 'title', type: 'title' },
      Score: { id: 'score', type: 'number' },
      Read: { id: 'read', type: 'date' },
      Thoughts: { id: 'thoughts', type: 'rich_text' },
    }),
  );
  const books = [
    { name: 'Solaris', score: 4, read: '2024-01-05' },
    { name: 'Ubik', score: 3, read: null },
    { name: 'Neuromancer', score: 5, read: '2024-03-02' },
  ];
  api.rows.set(
    booksDs,
    books.map(({ name, score, read }) =>
      page({
        Name: prop.title(name),
        Score: prop.number(score),
        Read: prop.date(read),
        Thoughts: prop.text('Not shown'),
      }),
    ),
  );

  api.databases.set(contactsDb, database(contactsDb, contactsDs, 'Contacts'));
  api.dataSources.set(
    contactsDs,
    dataSource(contactsDs, {
      Name: { id: 'title', type: 'title' },
      Email: { id: 'email', type: 'email' },
      Photo: { id: 'photo', type: 'files' },
      Count: { id: 'count', type: 'number' },
      Blank: { id: 'blank', type: 'rich_text' },
      Done: { id: 'done', type: 'checkbox' },
    }),
  );
  api.rows.set(contactsDs, [
    page({
      Name: prop.title('Ada'),
      Email: prop.email('ada@lil.horse'),
      Photo: prop.files([
        'https://images.example.com/ada.png',
        'https://images.example.com/cv.pdf',
      ]),
      Count: prop.number(3),
      Blank: prop.text(''),
      Done: prop.checkbox(true),
    }),
    page({
      Name: prop.title('Bob'),
      Email: prop.email(null),
      Photo: prop.files([]),
      Count: prop.number(null),
      Blank: prop.text(''),
      Done: prop.checkbox(false),
    }),
  ]);
  api.latest.set(moviesDs, '2024-04-01T00:00:00.000Z');
  api.latest.set(booksDs, '2024-03-02T00:00:00.000Z');
  api.latest.set(contactsDs, '2024-02-01T00:00:00.000Z');

  const thanks = block('paragraph', {
    rich_text: [
      rt('Thanks to '),
      mention(
        { type: 'user', user: { object: 'user', id: 'u-1', name: 'Real Name' } },
        '@Real Name',
      ),
      rt(' for reading '),
      rt('my Douban backup', { href: `https://www.notion.so/${douban.id}` }),
      rt(' and '),
      mention({ type: 'page', page: { id: ids.about } }, 'About'),
      rt(' on '),
      mention({ type: 'date', date: { start: '2024-01-11', end: null } }, 'January 11, 2024'),
      rt(' with '),
      equation('x^2'),
      rt('.', { annotations: { bold: true } }),
    ],
    color: 'default',
  });
  const original = parent('synced_block', { synced_from: null }, [text('Synced text')]);
  api.setChildren(hello.id, [
    text('Welcome to my blog. This post shows every block the site renders.'),
    block('heading_1', { rich_text: [rt('Setup')], color: 'default', is_toggleable: false }),
    thanks,
    parent('bulleted_list_item', { rich_text: [rt('First')], color: 'default' }, [
      text('Nested detail'),
    ]),
    block('bulleted_list_item', { rich_text: [rt('Second')], color: 'default' }),
    parent('numbered_list_item', { rich_text: [rt('One')], color: 'default' }, [
      block('bulleted_list_item', { rich_text: [rt('Sub-point')], color: 'default' }),
    ]),
    block('to_do', { rich_text: [rt('Done')], checked: true, color: 'default' }),
    parent('toggle', { rich_text: [rt('More')], color: 'default' }, [text('Toggle detail')]),
    parent('quote', { rich_text: [rt('Quoted')], color: 'default' }, [text('Quote detail')]),
    parent(
      'callout',
      { rich_text: [rt('Note')], icon: { type: 'emoji', emoji: '💡' }, color: 'gray_background' },
      [text('Callout detail')],
    ),
    block('code', {
      rich_text: [rt('const answer = 42;')],
      language: 'typescript',
      caption: [rt('src/answer.ts')],
    }),
    block('equation', { expression: 'E = mc^2' }),
    block('image', { ...notionFile('diagram.png'), caption: [rt('A diagram')] }),
    parent('table', { table_width: 2, has_column_header: true, has_row_header: false }, [
      block('table_row', { cells: [[rt('Name')], [rt('Value')]] }),
      block('table_row', { cells: [[rt('a')], [rt('1')]] }),
    ]),
    parent('column_list', {}, [
      parent('column', { width_ratio: 0.5 }, [text('Left')]),
      parent('column', { width_ratio: 0.5 }, [text('Right')]),
    ]),
    original,
    block(
      'synced_block',
      { synced_from: { type: 'block_id', block_id: original.id } },
      { hasChildren: true },
    ),
    block('bookmark', { url: 'https://example.com/article', caption: [rt('Worth reading')] }),
    block('video', {
      type: 'external',
      external: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      caption: [],
    }),
    block('audio', { ...notionFile('song.mp3'), caption: [] }),
    block('file', { ...notionFile('notes.pdf'), caption: [], name: 'notes.pdf' }),
    parent('heading_2', { rich_text: [rt('Details')], color: 'default', is_toggleable: true }, [
      text('Inside the toggle heading'),
    ]),
    block('divider', {}),
    block('link_to_page', { type: 'page_id', page_id: site.id }),
    block('child_page', { title: 'Subpage' }),
    block('table_of_contents', { color: 'default' }),
  ]);
  api.setChildren(douban.id, [
    text('Douban backup.'),
    block('child_database', { title: 'Movies' }, { id: moviesDb }),
    block('child_database', { title: '' }, { id: linkedDb }),
    block('child_database', { title: 'Books' }, { id: booksDb }),
  ]);
  api.setChildren(site.id, [
    block('paragraph', {
      rich_text: [rt('Read the intro', { href: `https://www.notion.so/${hello.id}` })],
      color: 'default',
    }),
  ]);
  api.setChildren(ids.about, [
    text('About me.'),
    block('child_database', { title: 'Contacts' }, { id: contactsDb }),
  ]);
  api.setChildren(ids.contact, [text('Say hi.')]);

  const config: NotionSiteConfig = {
    postsDatabaseId: ids.posts,
    projectsDatabaseId: ids.projects,
    profileDatabaseId: ids.profile,
    pages: { about: ids.about, contact: ids.contact },
    databaseDisplay: {
      [booksDb]: {
        columns: [{ property: 'Name' }, { property: 'Score', format: 'stars' }],
        sort: { property: 'Read', direction: 'descending' },
      },
    },
  };
  return { api, config, ids: { thanks: thanks.id, contactsDb }, notionFiles };
}

function contents(site: SiteContent): PageContent[] {
  return [
    ...site.posts.map((post) => post.content),
    ...site.projects.flatMap((project) => (project.content ? [project.content] : [])),
    ...site.pages.map((entry) => entry.content),
  ];
}

function nodes(site: SiteContent): Node[] {
  const found: Node[] = [];
  for (const content of contents(site)) walk(content.blocks, (node) => found.push(node));
  return found;
}

function paragraphText(site: SiteContent, id: string): string | null {
  const node = nodes(site).find((candidate) => candidate.id === id);
  return node?.type === 'paragraph' ? plain(node.text) : null;
}

function emailCell(site: SiteContent, databaseId: string): string | null {
  const node = nodes(site).find((candidate) => candidate.id === databaseId);
  if (node?.type !== 'database') return null;
  const column = node.columns.find((candidate) => candidate.name === 'Email');
  const cell = column && node.rows[0]?.cells[column.id];
  return cell?.kind === 'text' ? plain(cell.text) : null;
}

// Fixtures scrub emails, user names and the workspace ID of Notion files on purpose.
function withScrubbedValues(site: SiteContent, notionFiles: string[]): SiteContent {
  let json = JSON.stringify(site)
    .replaceAll('me@lil.horse', 'hello@example.com')
    .replaceAll('ada@lil.horse', 'hello@example.com')
    .replaceAll('@Real Name', '@someone');
  for (const name of notionFiles)
    json = json.replaceAll(
      mediaCacheKey(fileUrl(WORKSPACE_ID, name)),
      mediaCacheKey(fileUrl(ZERO_ID, name)),
    );
  const scrubbed = JSON.parse(json) as SiteContent;
  return { ...scrubbed, mediaKeys: scrubbed.mediaKeys.sort() };
}

const coverKey = (site: SiteContent) =>
  site.posts.find((post) => post.slug === 'helloworld')?.cover?.key;

// Pages load concurrently, so warnings arrive in no fixed order.
const comparable = (site: SiteContent) => ({ ...site, warnings: [...site.warnings].sort() });

describe('recorded fixtures', () => {
  it('replay offline to the same site the live sync built', async () => {
    const { api, config, ids, notionFiles } = workspace();
    const root = await tempDir('sync-fixtures-');
    const fixtures = join(root, 'fixtures');
    const media = new MediaStore({
      cacheDir: join(root, 'media'),
      // One image for every URL, so a scrubbed file URL changes nothing but the media key.
      fetch: (_url, init) => placeholderFetch('https://placeholder.test/', init),
    });
    const bookmarks = new BookmarkFetcher({
      cacheDir: join(root, 'bookmarks'),
      media,
      fetch: placeholderFetch,
    });
    const sync = (source: NotionApi, pages: string, statuses: PostStatus[], fullRefresh: boolean) =>
      syncNotion({
        api: source,
        media,
        bookmarks,
        cache: new PageCache(join(root, pages), LOADER_VERSION),
        config,
        statuses,
        fullRefresh,
        log: { info: () => undefined, warn: () => undefined },
      });

    const sanitize = createFixtureSanitizer(config);
    const live = await sync(
      createRecordingApi(api, fixtures, sanitize),
      'live',
      ['Published'],
      true,
    );
    await sanitize.prune(fixtures);
    const replayed = await sync(
      createFixtureApi(fixtures),
      'replay',
      ['Published', 'Unlisted'],
      false,
    );

    expect(new Set(nodes(live).map((node) => node.type))).toEqual(
      new Set([
        'paragraph',
        'heading',
        'list',
        'toggle',
        'quote',
        'callout',
        'code',
        'equation',
        'image',
        'table',
        'columns',
        'container',
        'bookmark',
        'video',
        'audio',
        'file',
        'divider',
        'page_link',
        'toc',
        'database',
      ]),
    );
    expect(
      nodes(live).flatMap((node) =>
        node.type === 'database' ? [[node.title, node.columns.length, node.rows.length]] : [],
      ),
    ).toEqual([
      ['Movies', 2, 3],
      ['Watched movies', 2, 1],
      ['Books', 2, 3],
      ['Contacts', 5, 2],
    ]);

    expect([live.profile.email, replayed.profile.email]).toEqual([
      'me@lil.horse',
      'hello@example.com',
    ]);
    expect([emailCell(live, ids.contactsDb), emailCell(replayed, ids.contactsDb)]).toEqual([
      'ada@lil.horse',
      'hello@example.com',
    ]);
    expect([paragraphText(live, ids.thanks), paragraphText(replayed, ids.thanks)]).toEqual([
      'Thanks to @Real Name for reading my Douban backup and About on January 11, 2024 with x^2.',
      'Thanks to @someone for reading my Douban backup and About on January 11, 2024 with x^2.',
    ]);
    expect([coverKey(live), coverKey(replayed)]).toEqual([
      mediaCacheKey(fileUrl(WORKSPACE_ID, 'cover.png')),
      mediaCacheKey(fileUrl(ZERO_ID, 'cover.png')),
    ]);
    expect(comparable(replayed)).toEqual(comparable(withScrubbedValues(live, notionFiles)));
  });
});
