import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished } from 'vitest';

/** A temp dir removed after the current test; from beforeAll, opt out and remove it in afterAll. */
export async function tempDir(prefix: string, { removeAfterTest = true } = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  if (removeAfterTest) onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
