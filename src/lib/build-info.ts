import { execFileSync } from 'node:child_process';

type Run = (command: string, args: string[]) => string;

const git: Run = (command, args) =>
  execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/** The short commit hash shown in the footer; CI provides GITHUB_SHA, local builds ask git. */
export function buildVersion(
  env: Record<string, string | undefined> = process.env,
  run: Run = git,
): string {
  const sha = env.GITHUB_SHA?.trim() ?? '';
  if (/^[0-9a-f]{7,40}$/i.test(sha)) return sha.slice(0, 7).toLowerCase();
  try {
    const hash = run('git', ['rev-parse', '--short=7', 'HEAD']).trim();
    return /^[0-9a-f]{7,40}$/.test(hash) ? hash : 'unknown';
  } catch {
    return 'unknown';
  }
}

let cached: string | undefined;

export function siteVersion(): string {
  cached ??= buildVersion();
  return cached;
}
