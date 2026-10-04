export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  GITHUB_REPOSITORY: string;
  NOTION_WEBHOOK_SECRET?: string;
  GITHUB_DISPATCH_TOKEN?: string;
}

export interface HookDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  log: (message: string) => void;
  now: () => Date;
}

export const HOOK_PATH = '/hooks/notion';
export const DISPATCH_EVENT = 'notion-content-changed';

// Generous on purpose: a page.content_updated event can list many updated blocks.
const MAX_BODY_BYTES = 1_048_576;

/** Changes that alter what the site shows; comments, locks and the legacy database.* events do not. */
export const BUILD_EVENTS: ReadonlySet<string> = new Set([
  'page.created',
  'page.content_updated',
  'page.properties_updated',
  'page.moved',
  'page.deleted',
  'page.undeleted',
  'data_source.created',
  'data_source.content_updated',
  'data_source.schema_updated',
  'data_source.moved',
  'data_source.deleted',
  'data_source.undeleted',
]);

interface NotionEvent {
  type: string;
  entity: { id: string; type: string };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const defaultDeps: HookDeps = {
  fetch: (url, init) => fetch(url, init),
  log: (message) => console.log(message),
  now: () => new Date(),
};

const text = (status: number, body: string, headers: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...headers },
  });

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

/** Reads every byte of `a` whatever the inputs, so the time taken does not reveal where they differ. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** Notion's signature: `sha256=` and the hex HMAC-SHA256 of the raw body, keyed by the verification token. */
export async function signBody(secret: string, body: Uint8Array<ArrayBuffer>): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return `sha256=${hex(await crypto.subtle.sign('HMAC', key, body))}`;
}

export async function verifySignature(
  secret: string,
  body: Uint8Array<ArrayBuffer>,
  header: string | null,
): Promise<boolean> {
  if (header === null) return false;
  const expected = await signBody(secret, body);
  return timingSafeEqual(encoder.encode(expected), encoder.encode(header.trim().toLowerCase()));
}

async function readBody(request: Request): Promise<Uint8Array<ArrayBuffer> | null> {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body !== null) {
    const reader = request.body.getReader();
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      size += read.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(read.value);
    }
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

const sender = (request: Request) =>
  ['cf-connecting-ip', 'user-agent']
    .map((name) => `${name}: ${JSON.stringify(request.headers.get(name))}`)
    .join(', ');

function verificationToken(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const token = (payload as { verification_token?: unknown }).verification_token;
  return typeof token === 'string' ? token : null;
}

function parseEvent(payload: unknown): NotionEvent | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { type, entity } = payload as { type?: unknown; entity?: unknown };
  if (typeof type !== 'string' || typeof entity !== 'object' || entity === null) return null;
  const { id, type: entityType } = entity as { id?: unknown; type?: unknown };
  if (typeof id !== 'string' || typeof entityType !== 'string') return null;
  return { type, entity: { id, type: entityType } };
}

async function dispatchBuild(
  event: NotionEvent,
  env: Env,
  token: string,
  deps: HookDeps,
): Promise<Response> {
  let response: Response;
  try {
    response = await deps.fetch(
      `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/dispatches`,
      {
        method: 'POST',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'user-agent': 'lil-horse-webhook',
          'x-github-api-version': '2022-11-28',
        },
        body: JSON.stringify({
          event_type: DISPATCH_EVENT,
          client_payload: {
            type: event.type,
            entity: event.entity,
            received_at: deps.now().toISOString(),
          },
        }),
      },
    );
  } catch (error) {
    deps.log(`GitHub dispatch failed: ${String(error)}`);
    return text(502, 'GitHub unreachable');
  }
  if (!response.ok) {
    deps.log(
      `GitHub dispatch answered ${response.status}: ${(await response.text()).slice(0, 200)}`,
    );
    return text(502, `GitHub answered ${response.status}`);
  }
  deps.log(`Build requested for ${event.type} ${event.entity.id}`);
  return text(202, 'Build requested');
}

export async function handleHook(
  request: Request,
  env: Env,
  deps: HookDeps = defaultDeps,
): Promise<Response> {
  if (request.method !== 'POST') return text(405, 'Method Not Allowed', { allow: 'POST' });
  const body = await readBody(request);
  if (body === null) return text(413, 'Body is larger than 1 MiB');
  const secret = env.NOTION_WEBHOOK_SECRET || undefined;
  const signature = request.headers.get('x-notion-signature');
  const signed = secret !== undefined && signature !== null;
  if (signed && !(await verifySignature(secret, body, signature)))
    return text(401, 'Bad signature');
  let payload: unknown;
  try {
    payload = JSON.parse(decoder.decode(body));
  } catch {
    return text(400, 'Body is not JSON');
  }
  const token = verificationToken(payload);
  if (token !== null) {
    if (secret === undefined) {
      // Notion's one-time token is read from this line; until the secret is set anyone can post one, hence the sender.
      deps.log(`Notion verification token: ${JSON.stringify(token)} (${sender(request)})`);
      return text(200, 'Verification token logged');
    }
    return timingSafeEqual(encoder.encode(secret), encoder.encode(token))
      ? text(200, 'Already verified')
      : text(401, 'Unknown verification token');
  }
  if (secret === undefined) return text(401, 'Webhook secret not configured');
  if (!signed) return text(401, 'Bad signature');
  const event = parseEvent(payload);
  if (event === null) return text(400, 'Body is not a Notion event');
  if (!BUILD_EVENTS.has(event.type)) return text(200, `Ignored ${event.type}`);
  const dispatchToken = env.GITHUB_DISPATCH_TOKEN || undefined;
  if (dispatchToken === undefined) return text(500, 'GITHUB_DISPATCH_TOKEN not configured');
  return dispatchBuild(event, env, dispatchToken, deps);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith('/hooks/')) return env.ASSETS.fetch(request);
    if (pathname !== HOOK_PATH) return Promise.resolve(text(404, 'Not Found'));
    return handleHook(request, env);
  },
};
