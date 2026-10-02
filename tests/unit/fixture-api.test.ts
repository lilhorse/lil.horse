import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NotionApi } from '../../src/notion/api';
import { createFixtureApi, createRecordingApi } from '../../src/notion/fixture-api';
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
});
