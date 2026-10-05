import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const COMMIT_MESSAGE = 'chore: sync the profile card from lil.horse';
const README_FILE = 'dist/profile/README.md';
const REPOSITORY = /^[\w.-]+\/[\w.-]+$/;

export interface ProfileSyncDeps {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  readReadme(): Promise<string>;
}

interface Contents {
  sha: string;
  content: string;
}

/** Commits the built profile README to the profile repository when it changed; returns what to print. */
export async function syncProfileReadme({
  env,
  fetch,
  readReadme,
}: ProfileSyncDeps): Promise<string> {
  const token = env.GH_TOKEN?.trim();
  if (!token) return 'GH_TOKEN is not set, so the profile README is not synced';
  const repository = env.PROFILE_REPOSITORY?.trim() ?? '';
  if (!REPOSITORY.test(repository))
    throw new Error('PROFILE_REPOSITORY must name the profile repository as owner/name');
  const readme = await readReadme();
  const path = `/repos/${repository}/contents/README.md`;
  const request = async (method: 'GET' | 'PUT', body?: object) => {
    const response = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'lil.horse',
        ...(body && { 'Content-Type': 'application/json' }),
      },
      ...(body && { body: JSON.stringify(body) }),
    }).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not reach GitHub to ${method} ${path}: ${reason}`, { cause: error });
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: response.status, ok: response.ok, data };
  };
  const fail = (method: string, status: number, data: Record<string, unknown>) =>
    new Error(
      `GitHub answered ${status} to ${method} ${path}${typeof data.message === 'string' ? `: ${data.message}` : ''}`,
    );

  const current = await request('GET');
  if (!current.ok && current.status !== 404) throw fail('GET', current.status, current.data);
  const existing = current.ok ? (current.data as unknown as Contents) : null;
  if (existing && Buffer.from(existing.content, 'base64').toString('utf8') === readme)
    return 'Profile README unchanged';

  const update = await request('PUT', {
    message: COMMIT_MESSAGE,
    content: Buffer.from(readme, 'utf8').toString('base64'),
    ...(existing && { sha: existing.sha }),
  });
  if (!update.ok) throw fail('PUT', update.status, update.data);
  const commit = (update.data.commit as { sha?: string } | undefined)?.sha ?? '';
  return `Updated the profile README in ${repository}: ${commit.slice(0, 7)}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    console.log(
      await syncProfileReadme({
        env: process.env,
        fetch,
        readReadme: () => readFile(README_FILE, 'utf8'),
      }),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
