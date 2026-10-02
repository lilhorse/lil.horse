import { describe, expect, it } from 'vitest';
import { normalizeId } from '../../src/notion/ids';
import { nextId } from '../helpers/notion-factory';

describe('nextId', () => {
  it('generates distinct, normalized Notion IDs', () => {
    const ids = Array.from({ length: 200 }, nextId);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.map(normalizeId)).toEqual(ids);
  });
});
