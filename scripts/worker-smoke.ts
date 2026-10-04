import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { devNull } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = Number(process.env.WORKER_SMOKE_PORT || 8787);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const READY_TIMEOUT_MS = 60_000;

interface Check {
  method: 'GET' | 'POST';
  path: string;
  status: number;
  allow?: string;
}

// Status codes and headers only, so the checks hold whether or not a local secret exists.
const CHECKS: Check[] = [
  { method: 'GET', path: '/hooks/notion', status: 405, allow: 'POST' },
  { method: 'POST', path: '/hooks/notion', status: 401 },
  { method: 'GET', path: '/hooks/other', status: 404 },
  { method: 'GET', path: '/', status: 200 },
];

const EVENT = JSON.stringify({
  type: 'page.content_updated',
  entity: { id: '00000000-0000-4000-8000-000000000000', type: 'page' },
});

const reason = (error: unknown) =>
  error instanceof Error
    ? `${error.message}${error.cause instanceof Error ? ` (${error.cause.message})` : ''}`
    : String(error);

function fail(message: string): number {
  console.error(`✗ ${message}`);
  return 1;
}

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
      .once('error', () => resolve(false))
      .listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

function startWrangler(): ChildProcess {
  return spawn(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'dev',
      '--ip',
      '127.0.0.1',
      '--port',
      String(PORT),
      '--env-file',
      devNull,
    ],
    {
      // A process group of its own, so one signal stops wrangler and the workerd it starts.
      detached: true,
      stdio: ['ignore', 'inherit', 'inherit'],
      // With --env-file, this keeps .dev.vars and .env, which may hold real secrets, out of wrangler and the Worker.
      env: {
        ...process.env,
        CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
        WRANGLER_SEND_METRICS: 'false',
      },
    },
  );
}

function signalGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

async function stop(pid: number): Promise<void> {
  for (const [signal, ms] of [
    ['SIGTERM', 10_000],
    ['SIGKILL', 5_000],
  ] as const) {
    if (!signalGroup(pid, signal)) return;
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (!signalGroup(pid, 0)) return;
      await delay(100);
    }
  }
  throw new Error(`wrangler's processes (group ${pid}) are still running`);
}

async function waitUntilServing(wrangler: ChildProcess): Promise<void> {
  const end = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < end) {
    if (wrangler.exitCode !== null || wrangler.signalCode !== null)
      throw new Error(
        `wrangler dev exited (${wrangler.exitCode ?? wrangler.signalCode}) before serving; its output is above`,
      );
    try {
      const response = await fetch(ORIGIN, { signal: AbortSignal.timeout(5_000) });
      await response.body?.cancel();
      return;
    } catch {
      await delay(250);
    }
  }
  throw new Error(
    `wrangler dev did not answer on ${ORIGIN} within ${READY_TIMEOUT_MS / 1000} s; its output is above`,
  );
}

async function check({ method, path, status, allow }: Check): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch(`${ORIGIN}${path}`, {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      ...(method === 'POST'
        ? { headers: { 'content-type': 'application/json' }, body: EVENT }
        : {}),
    });
    await response.body?.cancel();
  } catch (error) {
    console.error(`✗ ${method} ${path} → ${reason(error)}`);
    return false;
  }
  const summary = (code: number, allowed: string | null | undefined) =>
    allowed === undefined ? `${code}` : `${code}, Allow: ${allowed ?? '(none)'}`;
  const got = summary(
    response.status,
    allow === undefined ? undefined : response.headers.get('allow'),
  );
  const want = summary(status, allow);
  if (got === want) console.log(`✓ ${method} ${path} → ${got}`);
  else console.error(`✗ ${method} ${path} → ${got}, expected ${want}`);
  return got === want;
}

async function main(): Promise<number> {
  if (!existsSync('dist'))
    return fail('dist/ is missing: build the site first with pnpm build:fixtures or pnpm build');
  if (!(await portIsFree(PORT)))
    return fail(`port ${PORT} is in use: set WORKER_SMOKE_PORT to a free port`);
  console.log(`Starting the Worker with wrangler dev on ${ORIGIN}`);
  const wrangler = startWrangler();
  const { pid } = wrangler;
  if (pid === undefined) return fail('wrangler dev could not be started');
  process.once('exit', () => signalGroup(pid, 'SIGKILL'));
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => void stop(pid).finally(() => process.exit(1)));
  let passed = false;
  try {
    await waitUntilServing(wrangler);
    const results: boolean[] = [];
    for (const each of CHECKS) results.push(await check(each));
    passed = results.every(Boolean);
  } catch (error) {
    fail(reason(error));
  }
  try {
    await stop(pid);
  } catch (error) {
    return fail(reason(error));
  }
  if (!passed) return fail('the Worker smoke test failed');
  console.log('✓ the Worker started under workerd and answered as expected');
  return 0;
}

process.exitCode = await main();
