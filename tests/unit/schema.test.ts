import { describe, expect, it } from 'vitest';
import {
  ContentValidationError,
  parsePosts,
  parseProfile,
  parseProjects,
} from '../../src/notion/schema';
import { page, prop } from '../helpers/notion-factory';

const post = (overrides: Record<string, Record<string, unknown>> = {}, options = {}) =>
  page(
    {
      Name: prop.title('Hello World'),
      Slug: prop.text('helloworld'),
      Status: prop.status('Published'),
      Published: prop.date('2024-01-11'),
      Tags: prop.multiSelect(['ai']),
      Language: prop.select(null),
      Featured: prop.checkbox(false),
      ...overrides,
    },
    options,
  );

const project = (overrides: Record<string, Record<string, unknown>> = {}) =>
  page({
    Name: prop.title('Site'),
    Visible: prop.checkbox(true),
    Description: prop.text('This site'),
    Slug: prop.text('lil-horse'),
    ...overrides,
  });

describe('parsePosts', () => {
  it('parses a published post with defaults', () => {
    const row = post({}, { cover: 'https://images.unsplash.com/photo' });
    const result = parsePosts([row]);
    expect(result.issues).toEqual([]);
    expect(result.items[0]).toMatchObject({
      slug: 'helloworld',
      status: 'Published',
      published: '2024-01-11',
      language: 'en',
      tags: ['ai'],
      description: null,
      coverUrl: 'https://images.unsplash.com/photo',
    });
  });

  it('reports every problem on published and unlisted posts with the page link', () => {
    const rows = [
      post({ Slug: prop.text('') }),
      post({ Slug: prop.text('Hello World') }),
      post({
        Status: prop.status('Unlisted'),
        Slug: prop.text('secret'),
        Published: prop.date(null),
      }),
      post({ Language: prop.select('fr'), Slug: prop.text('french') }),
      post({ Status: prop.status('Archived'), Slug: prop.text('archived') }),
    ];
    const { issues } = parsePosts(rows);
    expect(issues.map((issue) => issue.field)).toEqual([
      'Slug',
      'Slug',
      'Published',
      'Language',
      'Status',
    ]);
    const error = new ContentValidationError(issues);
    expect(error.message).toContain(`https://www.notion.so/${rows[0]?.id}`);
    expect(error.message).toContain('"Hello World" must match');
  });

  it('accepts a valid unlisted post', () => {
    const result = parsePosts([post({ Status: prop.status('Unlisted') })]);
    expect(result.issues).toEqual([]);
    expect(result.items.map((item) => item.status)).toEqual(['Unlisted']);
  });

  it('treats an empty Status as Draft and accepts a select-typed Status', () => {
    const result = parsePosts([
      post({ Status: prop.status(null), Slug: prop.text('wip') }),
      post({ Status: prop.select('Published') }),
    ]);
    expect(result.issues).toEqual([]);
    expect(result.items.map((item) => [item.slug, item.status])).toEqual([
      ['helloworld', 'Published'],
      ['wip', 'Draft'],
    ]);
  });

  it('fails a post whose Status has the wrong type instead of skipping it as a draft', () => {
    const result = parsePosts([post({ Status: prop.multiSelect(['Published']) })]);
    expect(result.issues.map((issue) => issue.field)).toEqual(['Status']);
    expect(result.items).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('fails a post when the Status column is missing', () => {
    const row = post();
    delete row.properties.Status;
    const result = parsePosts([row]);
    expect(result.issues.map((issue) => `${issue.field}: ${issue.message}`)).toEqual([
      'Status: column is missing',
    ]);
    expect(result.items).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('flags duplicate slugs on the second post', () => {
    const first = post();
    const second = post();
    const { issues } = parsePosts([first, second]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.pageId).toBe(second.id);
    expect(issues[0]?.message).toContain(first.id);
  });

  it('flags a duplicate slug even when the first post has other problems', () => {
    const first = post({ Published: prop.date(null) });
    const second = post();
    const { issues } = parsePosts([first, second]);
    expect(issues.map((issue) => [issue.pageId, issue.field])).toEqual([
      [first.id, 'Published'],
      [second.id, 'Slug'],
    ]);
    expect(issues[1]?.message).toContain(first.id);
  });

  it('keeps the slug for a live post over a draft and links the skipped draft', () => {
    const draft = post({ Status: prop.status('Draft') });
    const live = post();
    const result = parsePosts([draft, live]);
    expect(result.issues).toEqual([]);
    expect(result.items.map((item) => item.id)).toEqual([live.id]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(`https://www.notion.so/${draft.id}`);
    expect(result.warnings[0]).toContain(`already used by https://www.notion.so/${live.id}`);
  });

  it('flags a duplicate draft slug even when the first draft has other problems', () => {
    const broken = post({ Status: prop.status('Draft'), Language: prop.select('fr') });
    const copy = post({ Status: prop.status('Draft') });
    const result = parsePosts([broken, copy]);
    expect(result.issues).toEqual([]);
    expect(result.items).toEqual([]);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain(`https://www.notion.so/${broken.id}`);
    expect(result.warnings[1]).toContain(`https://www.notion.so/${copy.id}`);
    expect(result.warnings[1]).toContain(`already used by https://www.notion.so/${broken.id}`);
  });

  it('rethrows reader errors that are not property errors', () => {
    const row = post();
    // Non-enumerable by default, so readTitle skips it and only the Description read hits it.
    Object.defineProperty(row.properties, 'Description', {
      get() {
        throw new Error('boom');
      },
    });
    expect(() => parsePosts([row])).toThrow('boom');
  });

  it('skips broken drafts with a warning instead of failing', () => {
    const result = parsePosts([
      post({ Status: prop.status('Draft'), Slug: prop.text(''), Published: prop.date(null) }),
      post({ Status: prop.status('Draft'), Slug: prop.text('wip'), Language: prop.select('fr') }),
    ]);
    expect(result.issues).toEqual([]);
    expect(result.items).toEqual([]);
    expect(result.warnings).toHaveLength(2);
  });

  it('uses the creation date for drafts without a published date', () => {
    const result = parsePosts([
      post({ Status: prop.status('Draft'), Slug: prop.text('wip'), Published: prop.date(null) }),
    ]);
    expect(result.items[0]?.published).toBe('2024-01-01');
  });
});

describe('parseProjects', () => {
  it('only validates visible projects', () => {
    const rows = [
      page({ Name: prop.title('Hidden'), Visible: prop.checkbox(false) }),
      page({
        Name: prop.title('Site'),
        Visible: prop.checkbox(true),
        Description: prop.text('This site'),
        Slug: prop.text('lil-horse'),
        Order: prop.number(1),
        Year: prop.number(2026),
        Status: prop.select('Active'),
        Stack: prop.multiSelect(['Astro']),
      }),
      page({
        Name: prop.title('Broken'),
        Visible: prop.checkbox(true),
        Description: prop.text(''),
        Slug: prop.text('Bad Slug'),
      }),
    ];
    const result = parseProjects(rows);
    expect(result.items.map((item) => item.name)).toEqual(['Site']);
    expect(result.items[0]).toMatchObject({
      slug: 'lil-horse',
      order: 1,
      year: 2026,
      status: 'Active',
      stack: ['Astro'],
    });
    expect(result.issues.map((issue) => issue.field)).toEqual(['Description', 'Slug']);
  });

  it('fails a project whose Visible has the wrong type instead of hiding it', () => {
    const result = parseProjects([project({ Visible: prop.select('Yes') })]);
    expect(result.issues.map((issue) => issue.field)).toEqual(['Visible']);
    expect(result.items).toEqual([]);
  });

  it('fails a project when the Visible column is missing', () => {
    const row = project();
    delete row.properties.Visible;
    const result = parseProjects([row]);
    expect(result.issues.map((issue) => `${issue.field}: ${issue.message}`)).toEqual([
      'Visible: column is missing',
    ]);
    expect(result.items).toEqual([]);
  });

  it('flags duplicate project slugs even when the first project has other problems', () => {
    const first = project({ Description: prop.text('') });
    const second = project();
    const { issues } = parseProjects([first, second]);
    expect(issues.map((issue) => [issue.pageId, issue.field])).toEqual([
      [first.id, 'Description'],
      [second.id, 'Slug'],
    ]);
    expect(issues[1]?.message).toContain(first.id);
  });

  it('rejects an unknown project status', () => {
    const { issues } = parseProjects([project({ Status: prop.select('Paused') })]);
    expect(issues.map((issue) => issue.field)).toEqual(['Status']);
    expect(issues[0]?.message).toContain('(found Paused)');
  });

  it('rejects project links that are not absolute http(s) URLs', () => {
    const rows = [
      project({ Link: prop.url('github.com/x/y'), Repo: prop.url('https://example.com') }),
      project({
        Slug: prop.text('script'),
        Link: prop.url('https://example.com'),
        Repo: prop.url('javascript:alert(1)'),
      }),
      project({ Slug: prop.text('same-scheme'), Link: prop.url('https:example.com') }),
    ];
    const { issues, items } = parseProjects(rows);
    expect(issues.map((issue) => [issue.pageId, issue.field, issue.message])).toEqual([
      [rows[0]?.id, 'Link', 'must be an http(s) URL (found "github.com/x/y")'],
      [rows[1]?.id, 'Repo', 'must be an http(s) URL (found "javascript:alert(1)")'],
      [rows[2]?.id, 'Link', 'must be an http(s) URL (found "https:example.com")'],
    ]);
    expect(items).toEqual([]);
    expect(new ContentValidationError(issues).message).toContain(
      `(https://www.notion.so/${rows[0]?.id}) Link: must be an http(s) URL (found "github.com/x/y")`,
    );
  });

  it('keeps trimmed http(s) project links and leaves blank ones null', () => {
    const result = parseProjects([
      project({ Link: prop.url('https://example.com'), Repo: prop.url(null) }),
      project({
        Slug: prop.text('padded'),
        Link: prop.url('  https://example.com '),
        Repo: prop.url(' \n '),
      }),
      project({
        Slug: prop.text('plain-http'),
        Link: prop.url('   '),
        Repo: prop.url('http://example.com'),
      }),
    ]);
    expect(result.issues).toEqual([]);
    expect(result.items.map((item) => [item.link, item.repo])).toEqual([
      ['https://example.com', null],
      ['https://example.com', null],
      [null, 'http://example.com'],
    ]);
  });
});

describe('parseProfile', () => {
  const valid = () =>
    page({
      Name: prop.title("Lil'Horse"),
      Role: prop.text('Freelance full-stack developer'),
      Location: prop.text('Auckland, New Zealand'),
      Availability: prop.select('Open to work'),
      Stack: prop.multiSelect(['TypeScript']),
      Email: prop.email('sup@lil.horse'),
      GitHub: prop.text('lilhorse'),
      X: prop.text('lil_horse_'),
      Bio: prop.text(''),
    });

  it('parses exactly one row', () => {
    const result = parseProfile([valid()]);
    expect(result.issues).toEqual([]);
    expect(result.items[0]).toMatchObject({
      name: "Lil'Horse",
      availability: 'Open to work',
      email: 'sup@lil.horse',
      bio: null,
    });
  });

  it('rejects zero or several rows and unknown availability', () => {
    expect(parseProfile([]).issues[0]?.message).toContain('exactly one row (found 0)');
    expect(parseProfile([valid(), valid()]).issues[0]?.message).toContain(
      'exactly one row (found 2)',
    );
    const bad = valid();
    bad.properties.Availability = {
      id: 'a',
      type: 'select',
      select: { id: 'x', name: 'Maybe', color: 'default' },
    } as never;
    expect(parseProfile([bad]).issues.map((issue) => issue.field)).toEqual(['Availability']);
  });
});
