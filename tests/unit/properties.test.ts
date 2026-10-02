import { describe, expect, it } from 'vitest';
import {
  coverUrl,
  datePart,
  readDate,
  readOption,
  readText,
  readTitle,
  readUrl,
} from '../../src/notion/properties';
import { page, prop } from '../helpers/notion-factory';

describe('properties', () => {
  it('keeps the calendar date the author wrote, whatever the time zone', () => {
    expect(datePart('2024-02-29T23:30:00.000+13:00')).toBe('2024-02-29');
    expect(datePart('2024-02-29')).toBe('2024-02-29');
    expect(() => datePart('Feb 29')).toThrow('invalid date');
  });

  it('reads typed values and rejects the wrong property type', () => {
    const row = page({
      Name: prop.title('  Hello  '),
      Slug: prop.number(3),
      Published: prop.date('2024-01-11T08:00:00.000+13:00'),
      Status: prop.status('Published'),
      Language: prop.select('zh'),
    });
    expect(readTitle(row.properties)).toBe('Hello');
    expect(readDate(row.properties, 'Published')).toEqual({ start: '2024-01-11', end: null });
    expect(readOption(row.properties, 'Status')).toBe('Published');
    expect(readOption(row.properties, 'Language')).toBe('zh');
    expect(() => readText(row.properties, 'Slug')).toThrow('expected rich_text, found number');
    expect(readText(row.properties, 'Missing')).toBeNull();
  });

  it('reads URLs and rejects the wrong type', () => {
    const row = page({
      Link: prop.url('https://lil.horse'),
      Repo: prop.url(null),
      Docs: prop.text('lil.horse/docs'),
    });
    expect(readUrl(row.properties, 'Link')).toBe('https://lil.horse');
    expect(readUrl(row.properties, 'Repo')).toBeNull();
    expect(readUrl(row.properties, 'Missing')).toBeNull();
    expect(() => readUrl(row.properties, 'Docs')).toThrow('expected url, found rich_text');
  });

  it('keeps both calendar dates of a date range', () => {
    const row = page({
      Dates: prop.date('2024-01-11T08:00:00.000+13:00', '2024-01-12T23:30:00.000+13:00'),
    });
    expect(readDate(row.properties, 'Dates')).toEqual({ start: '2024-01-11', end: '2024-01-12' });
  });

  it('reads a Notion-hosted cover', () => {
    const row = page({});
    row.cover = {
      type: 'file',
      file: {
        url: 'https://prod-files-secure.s3.us-west-2.amazonaws.com/w/f/cover.png',
        expiry_time: '2024-01-01T01:00:00.000Z',
      },
    };
    expect(coverUrl(row)).toBe(
      'https://prod-files-secure.s3.us-west-2.amazonaws.com/w/f/cover.png',
    );
  });
});
