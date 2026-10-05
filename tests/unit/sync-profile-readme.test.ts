import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  COMMIT_MESSAGE,
  RETRY_DELAY_MS,
  syncProfileReadme,
} from '../../scripts/sync-profile-readme';

const README = '```text\n▄█▀\n```\n\n*Chill 🍻.*\n';
const CONTENTS = 'https://api.github.com/repos/lilhorse/lilhorse/contents/README.md';
const ENV = { GH_TOKEN: 'github_pat_secret', PROFILE_REPOSITORY: 'lilhorse/lilhorse' };

const base64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');
// GitHub wraps the base64 content of a file at 60 characters.
const wrapped = (text: string) => base64(text).replace(/.{60}/g, '$&\n');

type Reply = { status: number; body?: unknown } | { fails: string };

function github(...replies: Reply[]) {
  const requests: { url: string; method: string; headers: Headers; body: unknown }[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    requests.push({
      url: String(input),
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const reply = replies.shift();
    if (!reply) throw new Error('unexpected request');
    if ('fails' in reply) throw new TypeError(reply.fails);
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, requests };
}

const run = (
  fetch: typeof globalThis.fetch,
  env: Record<string, string | undefined> = ENV,
  wait: (ms: number) => Promise<void> = async () => undefined,
) => syncProfileReadme({ env, fetch, readReadme: async () => README, wait });

describe('syncProfileReadme', () => {
  it('leaves the profile alone when its README already matches', async () => {
    const { fetch, requests } = github({
      status: 200,
      body: { sha: 'old', encoding: 'base64', content: wrapped(README) },
    });
    expect(await run(fetch)).toBe('Profile README unchanged');
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.url).toBe(CONTENTS);
    expect(request?.method).toBe('GET');
    expect(request?.headers.get('authorization')).toBe('Bearer github_pat_secret');
    expect(request?.headers.get('accept')).toBe('application/vnd.github+json');
    expect(request?.headers.get('x-github-api-version')).toBe('2022-11-28');
  });

  it('commits a changed README over the current one', async () => {
    const { fetch, requests } = github(
      { status: 200, body: { sha: 'old', encoding: 'base64', content: wrapped('Before\n') } },
      { status: 200, body: { commit: { sha: '0123456789abcdef0123456789abcdef01234567' } } },
    );
    expect(await run(fetch)).toBe('Updated the profile README in lilhorse/lilhorse: 0123456');
    expect(requests[1]).toMatchObject({
      url: CONTENTS,
      method: 'PUT',
      body: { message: COMMIT_MESSAGE, content: base64(README), sha: 'old' },
    });
    expect(COMMIT_MESSAGE).toBe('chore: sync the profile card from lil.horse');
  });

  it('creates the README when the profile repository has none', async () => {
    const { fetch, requests } = github(
      { status: 404, body: { message: 'Not Found' } },
      { status: 201, body: { commit: { sha: 'fedcba9876543210fedcba9876543210fedcba98' } } },
    );
    expect(await run(fetch)).toBe('Updated the profile README in lilhorse/lilhorse: fedcba9');
    expect(requests[1]?.method).toBe('PUT');
    expect(requests[1]?.body).toEqual({ message: COMMIT_MESSAGE, content: base64(README) });
  });

  it('does nothing without a token, as in forks and local runs', async () => {
    const { fetch } = github();
    const readReadme = vi.fn(async () => README);
    for (const env of [{ PROFILE_REPOSITORY: 'lilhorse/lilhorse' }, { ...ENV, GH_TOKEN: '' }])
      expect(await syncProfileReadme({ env, fetch, readReadme })).toBe(
        'GH_TOKEN is not set, so the profile README is not synced',
      );
    expect(fetch).not.toHaveBeenCalled();
    expect(readReadme).not.toHaveBeenCalled();
  });

  it('fails with GitHub’s reason when GitHub refuses', async () => {
    const { fetch } = github({
      status: 403,
      body: { message: 'Resource not accessible by personal access token' },
    });
    await expect(run(fetch)).rejects.toThrow(
      'GitHub answered 403 to GET /repos/lilhorse/lilhorse/contents/README.md: Resource not accessible by personal access token',
    );
  });

  it('fails when the commit is refused', async () => {
    const { fetch } = github(
      { status: 404, body: { message: 'Not Found' } },
      { status: 409, body: { message: 'README.md does not match sha' } },
    );
    await expect(run(fetch)).rejects.toThrow(
      'GitHub answered 409 to PUT /repos/lilhorse/lilhorse/contents/README.md: README.md does not match sha',
    );
  });

  it('tries each request once more after a network error or a 5xx, after a pause', async () => {
    const waits: number[] = [];
    const { fetch, requests } = github(
      { status: 503, body: { message: 'Service Unavailable' } },
      { status: 200, body: { sha: 'old', encoding: 'base64', content: wrapped('Before\n') } },
      { fails: 'fetch failed' },
      { status: 200, body: { commit: { sha: '0123456789abcdef0123456789abcdef01234567' } } },
    );
    expect(
      await run(fetch, ENV, async (ms: number) => {
        waits.push(ms);
      }),
    ).toBe('Updated the profile README in lilhorse/lilhorse: 0123456');
    expect(requests.map((request) => request.method)).toEqual(['GET', 'GET', 'PUT', 'PUT']);
    expect(waits).toEqual([RETRY_DELAY_MS, RETRY_DELAY_MS]);
  });

  it('names the request when GitHub gives no reason or cannot be reached', async () => {
    const silent = github({ status: 502 }, { status: 502 });
    await expect(run(silent.fetch)).rejects.toThrow(
      /^GitHub answered 502 to GET \/repos\/lilhorse\/lilhorse\/contents\/README\.md$/,
    );
    const offline = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof globalThis.fetch;
    await expect(run(offline)).rejects.toThrow(
      'Could not reach GitHub to GET /repos/lilhorse/lilhorse/contents/README.md: fetch failed',
    );
  });

  it('needs the profile repository as owner/name', async () => {
    const { fetch } = github();
    for (const repository of [undefined, '', 'lilhorse'])
      await expect(run(fetch, { ...ENV, PROFILE_REPOSITORY: repository })).rejects.toThrow(
        'PROFILE_REPOSITORY must name the profile repository as owner/name',
      );
    expect(fetch).not.toHaveBeenCalled();
  });
});

// The sync-profile job runs the script with plain Node, without installing any package.
describe('scripts/sync-profile-readme.ts', () => {
  const SCRIPT = 'scripts/sync-profile-readme.ts';

  it('imports only Node built-ins', () => {
    const source = readFileSync(SCRIPT, 'utf8');
    const specifiers = Array.from(
      source.matchAll(/\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(?\s*['"]([^'"]+)['"]/g),
      (match) => match[1] ?? match[2],
    );
    expect(specifiers).toContain('node:fs/promises');
    expect(specifiers.filter((specifier) => !specifier?.startsWith('node:'))).toEqual([]);
  });

  it('runs under plain Node, which strips its types', () => {
    const run = spawnSync(process.execPath, [SCRIPT], { env: {}, encoding: 'utf8' });
    expect(run.stderr).toBe('');
    expect(run.stdout).toBe('GH_TOKEN is not set, so the profile README is not synced\n');
    expect(run.status).toBe(0);
  });
});
