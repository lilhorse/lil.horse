export interface RuntimeEnv {
  notionToken: string | null;
  fixtures: boolean;
  includeDrafts: boolean;
  fullRefresh: boolean;
  skipSync: boolean;
}

type EnvSource = Record<string, string | boolean | undefined>;

export function readEnv(...sources: EnvSource[]): RuntimeEnv {
  const get = (name: string): string | undefined => {
    for (const source of sources) {
      const value = source[name];
      if (typeof value === 'string' && value.trim() !== '') return value.trim();
    }
    return undefined;
  };
  return {
    notionToken: get('NOTION_TOKEN') ?? null,
    fixtures: get('NOTION_FIXTURES') === '1',
    includeDrafts: get('NOTION_INCLUDE_DRAFTS') === '1',
    fullRefresh: get('NOTION_FULL_REFRESH') === '1',
    skipSync: get('NOTION_SKIP_SYNC') === '1',
  };
}
