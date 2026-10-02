import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';

interface SmokeEntry {
  title: string;
}

export const collections = {
  smoke: defineCollection({
    loader: {
      name: 'smoke',
      load: async ({ store }) => {
        store.clear();
        store.set({ id: 'one', data: { title: 'Smoke entry' } });
      },
    },
    schema: z.custom<SmokeEntry>(),
  }),
};
