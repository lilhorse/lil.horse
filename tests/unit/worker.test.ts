import { createHmac } from 'node:crypto';
import { describe, expect, it, vi, type Mock } from 'vitest';
import worker, {
  BUILD_EVENTS,
  DISPATCH_EVENT,
  handleHook,
  signBody,
  timingSafeEqual,
  verifySignature,
  type Env,
} from '../../src/worker/index';

const SECRET = 'secret_fake-verification-token-for-tests';
const HOOK = 'https://lil.horse/hooks/notion';
const RECEIVED = new Date('2026-10-04T05:00:00.000Z');

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const bytes = (value: string) => new TextEncoder().encode(value);

function env(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: vi.fn(async () => new Response('asset')) },
    GITHUB_REPOSITORY: 'lilhorse/lil.horse',
    NOTION_WEBHOOK_SECRET: SECRET,
    GITHUB_DISPATCH_TOKEN: 'github_pat_test',
    ...overrides,
  };
}

const github = (status: number) =>
  vi.fn<Fetch>(async () => new Response(status === 204 ? null : 'nope', { status }));

function deps(fetch: Mock<Fetch> = github(204)) {
  return { fetch, log: vi.fn(), now: () => RECEIVED };
}

const event = (type: string) =>
  JSON.stringify({
    id: 'c6e6a6c6-0000-4000-8000-000000000001',
    type,
    entity: { id: '1174bd3d-0b2b-8073-a433-ea2cd4eb814b', type: 'page' },
    attempt_number: 1,
  });

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request(HOOK, { method: 'POST', body, headers });

async function signed(body: string, secret = SECRET): Promise<Request> {
  return post(body, { 'x-notion-signature': await signBody(secret, body) });
}

describe('timingSafeEqual', () => {
  it('is true only for identical byte strings', () => {
    expect(timingSafeEqual(bytes('abc'), bytes('abc'))).toBe(true);
    expect(timingSafeEqual(bytes('abc'), bytes('abd'))).toBe(false);
    expect(timingSafeEqual(bytes('abc'), bytes('abcd'))).toBe(false);
    expect(timingSafeEqual(bytes(''), bytes(''))).toBe(true);
    expect(timingSafeEqual(bytes('a'), bytes(''))).toBe(false);
  });
});

describe('signBody and verifySignature', () => {
  it("matches Notion's HMAC-SHA256 hex signature", async () => {
    const body = event('page.content_updated');
    const expected = `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
    expect(await signBody(SECRET, body)).toBe(expected);
    expect(await verifySignature(SECRET, body, expected)).toBe(true);
    expect(await verifySignature(SECRET, body, expected.toUpperCase())).toBe(true);
  });

  it('rejects a missing, foreign or tampered signature', async () => {
    const body = event('page.content_updated');
    const good = await signBody(SECRET, body);
    expect(await verifySignature(SECRET, body, null)).toBe(false);
    expect(await verifySignature(SECRET, body, await signBody('other', body))).toBe(false);
    expect(await verifySignature(SECRET, `${body} `, good)).toBe(false);
    expect(await verifySignature(SECRET, body, 'sha256=')).toBe(false);
  });
});

describe('handleHook', () => {
  it('allows only POST', async () => {
    const response = await handleHook(new Request(HOOK), env(), deps());
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('rejects a body that is not JSON', async () => {
    expect((await handleHook(post('not json'), env(), deps())).status).toBe(400);
  });

  it('logs the verification token while no secret is configured', async () => {
    const d = deps();
    const response = await handleHook(
      post(JSON.stringify({ verification_token: SECRET })),
      env({ NOTION_WEBHOOK_SECRET: undefined }),
      d,
    );
    expect(response.status).toBe(200);
    expect(d.log).toHaveBeenCalledWith(`Notion verification token: ${SECRET}`);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it('answers a repeated verification quietly once the secret matches, and refuses another token', async () => {
    const same = deps();
    expect(
      (await handleHook(post(JSON.stringify({ verification_token: SECRET })), env(), same)).status,
    ).toBe(200);
    expect(same.log).not.toHaveBeenCalled();
    const other = deps();
    expect(
      (
        await handleHook(
          post(JSON.stringify({ verification_token: 'secret_someoneElse' })),
          env(),
          other,
        )
      ).status,
    ).toBe(401);
    expect(other.log).not.toHaveBeenCalled();
  });

  it('refuses every event while no secret is configured', async () => {
    const d = deps();
    const response = await handleHook(
      await signed(event('page.content_updated')),
      env({ NOTION_WEBHOOK_SECRET: '' }),
      d,
    );
    expect(response.status).toBe(401);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it('refuses a missing or wrong signature with 401', async () => {
    const body = event('page.content_updated');
    const d = deps();
    expect((await handleHook(post(body), env(), d)).status).toBe(401);
    expect((await handleHook(await signed(body, 'wrong'), env(), d)).status).toBe(401);
    expect(
      (await handleHook(post(body, { 'x-notion-signature': 'sha256=00' }), env(), d)).status,
    ).toBe(401);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it('ignores events that do not change the site', async () => {
    for (const type of ['comment.created', 'page.locked', 'database.content_updated']) {
      const d = deps();
      const response = await handleHook(await signed(event(type)), env(), d);
      expect(response.status, type).toBe(200);
      expect(await response.text(), type).toBe(`Ignored ${type}`);
      expect(d.fetch, type).not.toHaveBeenCalled();
    }
  });

  it('rejects a signed body that is not an event', async () => {
    const d = deps();
    const response = await handleHook(await signed(JSON.stringify({ hello: 1 })), env(), d);
    expect(response.status).toBe(400);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it('asks GitHub for a build and answers 202 once GitHub accepts', async () => {
    const d = deps();
    const response = await handleHook(await signed(event('page.content_updated')), env(), d);
    expect(response.status).toBe(202);
    expect(d.fetch).toHaveBeenCalledTimes(1);
    expect(d.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/lilhorse/lil.horse/dispatches',
      {
        method: 'POST',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: 'Bearer github_pat_test',
          'content-type': 'application/json',
          'user-agent': 'lil-horse-webhook',
          'x-github-api-version': '2022-11-28',
        },
        body: JSON.stringify({
          event_type: DISPATCH_EVENT,
          client_payload: {
            type: 'page.content_updated',
            entity: { id: '1174bd3d-0b2b-8073-a433-ea2cd4eb814b', type: 'page' },
            received_at: '2026-10-04T05:00:00.000Z',
          },
        }),
      },
    );
  });

  it('dispatches for every page and data source event that changes the site', async () => {
    expect(BUILD_EVENTS.size).toBe(12);
    for (const type of BUILD_EVENTS) {
      const d = deps();
      expect((await handleHook(await signed(event(type)), env(), d)).status, type).toBe(202);
    }
  });

  it('answers 502 when GitHub refuses or cannot be reached, so Notion retries', async () => {
    const refused = deps(github(403));
    const response = await handleHook(await signed(event('page.created')), env(), refused);
    expect(response.status).toBe(502);
    expect(await response.text()).toBe('GitHub answered 403');
    const down = deps(vi.fn<Fetch>(async () => Promise.reject(new TypeError('fetch failed'))));
    expect((await handleHook(await signed(event('page.created')), env(), down)).status).toBe(502);
    expect(down.log).toHaveBeenCalledWith('GitHub dispatch failed: TypeError: fetch failed');
  });

  it('answers 500 without a GitHub token instead of pretending to dispatch', async () => {
    const d = deps();
    const response = await handleHook(
      await signed(event('page.created')),
      env({ GITHUB_DISPATCH_TOKEN: undefined }),
      d,
    );
    expect(response.status).toBe(500);
    expect(d.fetch).not.toHaveBeenCalled();
  });
});

describe('worker.fetch', () => {
  it('hands every path outside /hooks/ to the static assets unchanged', async () => {
    const e = env();
    const request = new Request('https://lil.horse/blog/douban?x=1');
    const response = await worker.fetch(request, e);
    expect(await response.text()).toBe('asset');
    expect(e.ASSETS.fetch).toHaveBeenCalledWith(request);
  });

  it('knows only /hooks/notion under /hooks/', async () => {
    const e = env();
    expect((await worker.fetch(new Request('https://lil.horse/hooks/other'), e)).status).toBe(404);
    expect((await worker.fetch(new Request('https://lil.horse/hooks/notion'), e)).status).toBe(405);
    expect(e.ASSETS.fetch).not.toHaveBeenCalled();
  });
});
