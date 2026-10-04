import { normalizeId } from './src/notion/ids';
import type { NotionSiteConfig } from './src/notion/types';

const POSTS_DATABASE_ID = '74b6877d51464ca3abd3ef610c2d3bd5';
const PROJECTS_DATABASE_ID = 'b95fcd0869a547d3aafad78b5325afbc';
const PROFILE_DATABASE_ID = '319ecb9af9674a32a7fb47de665c856b';
const WATCHED_MOVIES_VIEW_BLOCK_ID = '1174bd3d0b2b80a496b0d3f52a53e9cf';

const notion: NotionSiteConfig = {
  postsDatabaseId: normalizeId(POSTS_DATABASE_ID),
  projectsDatabaseId: normalizeId(PROJECTS_DATABASE_ID),
  profileDatabaseId: normalizeId(PROFILE_DATABASE_ID),
  pages: {
    about: normalizeId('055e368444314f2f953c65a79982553c'),
    contact: normalizeId('47088e3f3cb448acb439045cbcf61680'),
  },
  databaseDisplay: {
    [normalizeId(WATCHED_MOVIES_VIEW_BLOCK_ID)]: {
      columns: [
        { property: '电影/电视剧/番组' },
        { property: '个人评分', format: 'stars' },
        { property: '打分日期' },
      ],
      sort: { property: '打分日期', direction: 'descending' },
    },
  },
};

export const siteConfig = {
  name: "Lil'Horse",
  url: 'https://lil.horse',
  notion,
  // Cloudflare Web Analytics site token; empty means no beacon.
  analytics: { cloudflareToken: '' },
  giscus: {
    repo: 'lilhorse/lil.horse',
    repoId: 'R_kgDOGbvmeg',
    category: 'Announcements',
    categoryId: 'DIC_kwDOGbvmes4CcjmH',
  },
};
