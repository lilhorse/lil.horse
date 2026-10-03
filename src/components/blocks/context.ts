import type { AstroComponentFactory } from 'astro/runtime/server/index.js';
import type { LinkResolver } from '../../lib/html';
import type { HeadingRef } from '../../notion/types';

export interface BlockContext {
  resolve: LinkResolver;
  headings: HeadingRef[];
  priorityImageId: string | null;
}

/** Blocks passes itself to the components that hold nested blocks, so they never import it back. */
export type BlocksComponent = AstroComponentFactory;
