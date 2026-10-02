const TRAILING_ID = /([0-9a-f]{32})$/;

export function parseId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let path = trimmed;
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')) {
    try {
      path = new URL(trimmed, 'https://www.notion.so').pathname;
    } catch {
      return null;
    }
  }
  const match = TRAILING_ID.exec(path.replace(/-/g, '').toLowerCase());
  return match?.[1] ?? null;
}

export function normalizeId(input: string): string {
  const id = parseId(input);
  if (!id) throw new Error(`Invalid Notion ID: "${input}"`);
  return id;
}

export function notionUrl(id: string): string {
  return `https://www.notion.so/${normalizeId(id)}`;
}
