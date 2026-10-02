const TRAILING_ID = /([0-9a-f]{32})$/;

function trailingId(path: string): string | null {
  const match = TRAILING_ID.exec(path.replace(/-/g, '').toLowerCase());
  return match?.[1] ?? null;
}

export function parseId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(
      /^https?:\/\//i.test(trimmed)
        ? trimmed
        : `https://www.notion.so/${trimmed.replace(/^\/+/, '')}`,
    );
  } catch {
    return null;
  }
  // A peek link (`<database>?p=<page>`) names the open page in `p`, not in the path.
  return trailingId(url.searchParams.get('p') ?? '') ?? trailingId(url.pathname);
}

export function normalizeId(input: string): string {
  const id = parseId(input);
  if (!id) throw new Error(`Invalid Notion ID: "${input}"`);
  return id;
}

export function notionUrl(id: string): string {
  return `https://www.notion.so/${normalizeId(id)}`;
}
