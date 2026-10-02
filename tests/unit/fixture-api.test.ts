import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isNotFoundError, type NotionApi } from '../../src/notion/api';
import { createFixtureApi, createRecordingApi, fixtureKey } from '../../src/notion/fixture-api';
import { block } from '../helpers/notion-factory';

describe('fixture api', () => {
  it('replays exactly what the recording api saw, after sanitizing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fixtures-'));
    const children = [block('paragraph', { rich_text: [], color: 'default' }, { id: 'x' })];
    const inner = { listBlockChildren: async () => children } as unknown as NotionApi;
    const recording = createRecordingApi(inner, dir, (_method, _arg, value) => ({
      wrapped: value,
    }));

    await expect(recording.listBlockChildren('page-1')).resolves.toBe(children);
    const replay = createFixtureApi(dir);
    await expect(replay.listBlockChildren('page-1')).resolves.toEqual({
      wrapped: JSON.parse(JSON.stringify(children)),
    });
  });

  it('names the missing fixture', async () => {
    const replay = createFixtureApi(await mkdtemp(join(tmpdir(), 'fixtures-')));
    await expect(replay.retrievePage('nope')).rejects.toThrow(
      'Missing Notion fixture for retrievePage(nope)',
    );
  });

  it('replays a recorded 404 as not found, and records nothing for other errors', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fixtures-'));
    const notFound = Object.assign(new Error('Could not find database'), {
      code: 'object_not_found',
    });
    const inner = {
      retrieveDatabase: async () => {
        throw notFound;
      },
      retrievePage: async () => {
        throw new Error('Bad gateway');
      },
    } as unknown as NotionApi;
    const recording = createRecordingApi(inner, dir, (_method, _arg, value) => value);
    await expect(recording.retrieveDatabase('db-1')).rejects.toBe(notFound);
    await expect(recording.retrievePage('page-1')).rejects.toThrow('Bad gateway');

    const replay = createFixtureApi(dir);
    const replayed = await replay.retrieveDatabase('db-1').catch((error: unknown) => error);
    expect(isNotFoundError(replayed)).toBe(true);
    await expect(replay.retrievePage('page-1')).rejects.toThrow(
      'Missing Notion fixture for retrievePage(page-1)',
    );
  });

  it('tells an unreadable fixture apart from a missing one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fixtures-'));
    await writeFile(join(dir, `${fixtureKey('retrievePage', 'page-1')}.json`), '{ "id": ');
    await expect(createFixtureApi(dir).retrievePage('page-1')).rejects.toThrow(
      'Invalid JSON in Notion fixture for retrievePage(page-1)',
    );
  });
});
