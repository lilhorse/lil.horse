import { describe, expect, it } from 'vitest';
import { datePart, readDate, readOption, readText, readTitle } from '../../src/notion/properties';
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
});
