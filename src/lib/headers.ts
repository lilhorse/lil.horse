export const MAX_HEADER_LINE = 2000;
export const MAX_HEADER_RULES = 100;

const IMMUTABLE = 'Cache-Control: public, max-age=31536000, immutable';

/** Cloudflare applies every matching rule in file order and joins repeated headers, so cache paths never overlap. */
export function headersFile(csp: string): string {
  const blocks: [string, string[]][] = [
    [
      '/*',
      [
        `Content-Security-Policy: ${csp}`,
        'Strict-Transport-Security: max-age=31536000',
        'X-Content-Type-Options: nosniff',
        'Referrer-Policy: strict-origin-when-cross-origin',
        'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      ],
    ],
    ['/_astro/*', [IMMUTABLE]],
    [
      '/_media/*',
      [
        IMMUTABLE,
        '! Content-Security-Policy',
        "Content-Security-Policy: sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      ],
    ],
    ['/pagefind/index/*', [IMMUTABLE]],
    ['/pagefind/fragment/*', [IMMUTABLE]],
    ['/pagefind/filter/*', [IMMUTABLE]],
    ['/pagefind/*.pf_meta', [IMMUTABLE]],
    ['/og/*', ['Cache-Control: public, max-age=86400']],
    ['/giscus/*', ['Access-Control-Allow-Origin: https://giscus.app']],
    ['https://:version.:subdomain.workers.dev/*', ['X-Robots-Tag: noindex']],
  ];
  if (blocks.length > MAX_HEADER_RULES) throw new Error('_headers allows 100 rules');
  const lines = blocks.flatMap(([pattern, headers]) => [
    pattern,
    ...headers.map((header) => `  ${header}`),
    '',
  ]);
  for (const line of lines) {
    if (line.length > MAX_HEADER_LINE)
      throw new Error(
        `_headers line is ${line.length} characters; Cloudflare allows ${MAX_HEADER_LINE}`,
      );
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export interface HeaderRule {
  pattern: string;
  headers: [string, string | null][];
}

export function parseHeaders(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      rules.push({ pattern: raw.trim(), headers: [] });
      continue;
    }
    const line = raw.trim();
    const rule = rules.at(-1);
    if (!rule) continue;
    if (line.startsWith('! ')) rule.headers.push([line.slice(2).trim(), null]);
    else {
      const colon = line.indexOf(':');
      rule.headers.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
    }
  }
  return rules;
}

function matchesPattern(pattern: string, pathname: string): boolean {
  if (/^https?:\/\//.test(pattern)) return false;
  const source = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/:[A-Za-z_]+/g, '[^/]+');
  return new RegExp(`^${source}$`).test(pathname);
}

/** The headers a path gets: a first value replaces, a repeat appends with a comma, `!` removes. */
export function headersFor(rules: HeaderRule[], pathname: string): Record<string, string> {
  const result = new Map<string, string>();
  for (const rule of rules) {
    if (!matchesPattern(rule.pattern, pathname)) continue;
    for (const [name, value] of rule.headers) {
      const key = name.toLowerCase();
      const previous = result.get(key);
      if (value === null) result.delete(key);
      else result.set(key, previous === undefined ? value : `${previous}, ${value}`);
    }
  }
  return Object.fromEntries(result);
}
