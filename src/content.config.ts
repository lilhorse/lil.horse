import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { notionLoader } from './notion/loaders';
import type {
  MastheadEntry,
  PostEntry,
  ProfileEntry,
  ProjectEntry,
  StandalonePageEntry,
} from './notion/types';

export const collections = {
  posts: defineCollection({ loader: notionLoader('posts'), schema: z.custom<PostEntry>() }),
  projects: defineCollection({
    loader: notionLoader('projects'),
    schema: z.custom<ProjectEntry>(),
  }),
  profile: defineCollection({ loader: notionLoader('profile'), schema: z.custom<ProfileEntry>() }),
  masthead: defineCollection({
    loader: notionLoader('masthead'),
    schema: z.custom<MastheadEntry>(),
  }),
  pages: defineCollection({
    loader: notionLoader('pages'),
    schema: z.custom<StandalonePageEntry>(),
  }),
};
