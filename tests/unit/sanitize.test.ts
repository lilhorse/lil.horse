import { describe, expect, it } from 'vitest';
import { createFixtureSanitizer, scrub } from '../../src/notion/sanitize';
import { database, page, prop } from '../helpers/notion-factory';

const POSTS = 'a'.repeat(32);
const PROJECTS = 'b'.repeat(32);
const PROFILE = 'c'.repeat(32);

describe('scrub', () => {
  it('removes signatures, users, emails, people and request ids', () => {
    const input = {
      request_id: 'r-1',
      created_by: { object: 'user', id: 'real-user', name: 'Real Name' },
      cover: {
        type: 'file',
        file: {
          url: 'https://prod-files-secure.s3.us-west-2.amazonaws.com/w/f/cover.png?X-Amz-Signature=abc',
          expiry_time: 'x',
        },
      },
      external: 'https://images.unsplash.com/photo?ixlib=rb-4',
      properties: {
        Email: { id: 'e', type: 'email', email: 'sup@lil.horse' },
        Owner: {
          id: 'o',
          type: 'people',
          people: [{ object: 'user', id: 'u', name: 'Real Name' }],
        },
      },
      rich_text: [
        {
          type: 'mention',
          mention: { type: 'user', user: { object: 'user', id: 'u', name: 'Real Name' } },
          plain_text: '@Real Name',
        },
      ],
    };
    expect(scrub(input)).toEqual({
      created_by: { object: 'user', id: '00000000-0000-0000-0000-000000000000' },
      cover: {
        type: 'file',
        file: {
          url: 'https://prod-files-secure.s3.us-west-2.amazonaws.com/w/f/cover.png',
          expiry_time: 'x',
        },
      },
      external: 'https://images.unsplash.com/photo?ixlib=rb-4',
      properties: {
        Email: { id: 'e', type: 'email', email: 'hello@example.com' },
        Owner: { id: 'o', type: 'people', people: [] },
      },
      rich_text: [
        {
          type: 'mention',
          mention: {
            type: 'user',
            user: { object: 'user', id: '00000000-0000-0000-0000-000000000000' },
          },
          plain_text: '@someone',
        },
      ],
    });
  });
});

describe('createFixtureSanitizer', () => {
  it('keeps only published posts, visible projects, and truncates inline databases', () => {
    const sanitize = createFixtureSanitizer(
      { postsDatabaseId: POSTS, projectsDatabaseId: PROJECTS, profileDatabaseId: PROFILE },
      2,
    );
    sanitize('retrieveDatabase', POSTS, database(POSTS, 'd'.repeat(32)));
    sanitize('retrieveDatabase', PROJECTS, database(PROJECTS, 'e'.repeat(32)));

    const posts = [
      page({ Name: prop.title('A'), Status: prop.status('Published') }),
      page({ Name: prop.title('B'), Status: prop.status('Draft') }),
    ];
    expect(
      (sanitize('queryDataSource', 'd'.repeat(32), posts) as { id: string }[]).map((row) => row.id),
    ).toEqual([posts[0]?.id]);

    const projects = [
      page({ Name: prop.title('P1'), Visible: prop.checkbox(true), Status: prop.select('Active') }),
      page({ Name: prop.title('P2'), Visible: prop.checkbox(false) }),
    ];
    expect(
      (sanitize('queryDataSource', 'e'.repeat(32), projects) as { id: string }[]).map(
        (row) => row.id,
      ),
    ).toEqual([projects[0]?.id]);

    const inline = [
      page({ Name: prop.title('1') }),
      page({ Name: prop.title('2') }),
      page({ Name: prop.title('3') }),
    ];
    const kept = sanitize('queryDataSource', 'f'.repeat(32), inline) as { id: string }[];
    expect(kept).toHaveLength(2);
    const keptIds = kept.map((row) => row.id);
    const allIds = inline.map((row) => row.id);
    expect(sanitize('queryViewPageIds', 'view', allIds)).toEqual(keptIds);
  });
});
