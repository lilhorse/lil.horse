import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SNAPSHOTS = 'tests/e2e/visual.spec.ts-snapshots';

const read = (command: string, ...args: string[]) =>
  execFileSync(command, args, { encoding: 'utf8' }).trim();
const run = (command: string, ...args: string[]) =>
  execFileSync(command, args, { stdio: 'inherit' });

const branch = read('git', 'branch', '--show-current');
if (!branch || branch === 'main') throw new Error('Check out the branch to refresh first.');
if (read('git', 'status', '--porcelain')) throw new Error('Commit or stash your changes first.');

run('git', 'push', '--set-upstream', 'origin', branch);
const { workflow_run_id: id, html_url: url } = JSON.parse(
  read(
    'gh',
    'api',
    '--method',
    'POST',
    'repos/{owner}/{repo}/actions/workflows/baselines.yml/dispatches',
    '-f',
    `ref=${branch}`,
    '-F',
    'return_run_details=true',
  ),
) as { workflow_run_id: number; html_url: string };
console.log(`Regenerating the Linux baselines in ${url}`);
run('gh', 'run', 'watch', String(id), '--exit-status', '--compact', '--interval', '15');

const dir = mkdtempSync(join(tmpdir(), 'linux-baselines-'));
try {
  run('gh', 'run', 'download', String(id), '-n', 'visual-baselines-linux', '-D', dir);
  for (const file of readdirSync(dir)) cpSync(join(dir, file), join(SNAPSHOTS, file));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

run('git', 'add', SNAPSHOTS);
if (read('git', 'diff', '--cached', '--name-only')) {
  run('git', 'commit', '-m', 'test: refresh the Linux visual baselines');
  run('git', 'push');
} else {
  console.log('The Linux baselines are already up to date.');
}
