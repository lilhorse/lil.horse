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

  it('treats a missing Status as Draft and accepts a select-typed Status', () => {
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

  it('flags duplicate slugs on the second post', () => {
    const first = post();
    const second = post();
    const { issues } = parsePosts([first, second]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.pageId).toBe(second.id);
    expect(issues[0]?.message).toContain(first.id);
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
