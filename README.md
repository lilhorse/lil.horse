# lil.horse

Source code of [lil.horse](https://lil.horse), the personal site and blog of Lil'Horse.

Content is written in Notion. At build time, Astro reads it through the official Notion API and renders a fully static site.

## Stack

- [Astro](https://astro.build) 7 with static output
- The official Notion API (`@notionhq/client`), read by a custom content loader
- [sharp](https://sharp.pixelplumbing.com) for images, [KaTeX](https://katex.org) for math and [Expressive Code](https://expressive-code.com) for code blocks
- Vitest, ESLint, Prettier and html-validate

## How it works

1. **Content.** Posts, projects and the profile live in three Notion databases. About and Contact are ordinary Notion pages. Their IDs are in `site.config.ts`.
2. **Sync.** `src/notion/sync.ts` queries the databases, validates every row and turns each page's blocks into a serializable AST. If a row fails validation, the build stops, and the error names the page and the field.
3. **Cache.** Each page's AST is cached in `.cache/`. The cached AST is reused while the page, its inline databases and its media stay unchanged. Notion reports edit times to the minute, so pages edited in the last two minutes are never cached. `NOTION_FULL_REFRESH=1` rebuilds every page.
4. **Media.** Images, files, covers and bookmark previews are downloaded during the build and served from `/_media`, so the site never links to Notion's expiring file URLs. Images are converted to AVIF and WebP at several widths.
5. **Output check.** `pnpm check:dist` scans `dist/` for:
   - expiring Notion URLs
   - broken internal links
   - missing routes
   - JavaScript or CSS over budget
   - invalid HTML

## Development

You need Node.js 24 (see `.nvmrc`) and pnpm 10.

```bash
pnpm install
cp .env.example .env # then set NOTION_TOKEN
pnpm dev
```

`NOTION_TOKEN` is the token of a Notion integration. The integration needs read access to the three databases and the two pages. `.env` is git-ignored. Never commit it.

| Command                | What it does                                                |
| ---------------------- | ----------------------------------------------------------- |
| `pnpm dev`             | Starts the dev server, with Draft posts included            |
| `pnpm build`           | Builds the production site from live Notion data            |
| `pnpm build:fixtures`  | Builds offline from the fixtures in `tests/fixtures/notion` |
| `pnpm preview`         | Serves the last build                                       |
| `pnpm test`            | Runs the unit tests                                         |
| `pnpm lint`            | Runs ESLint                                                 |
| `pnpm check`           | Type-checks the project without syncing Notion              |
| `pnpm check:dist`      | Checks the build output in `dist/`                          |
| `pnpm record:fixtures` | Records sanitized fixtures from the live workspace          |

| Variable                  | Effect                                                |
| ------------------------- | ----------------------------------------------------- |
| `NOTION_TOKEN`            | Notion integration token, required for live builds    |
| `NOTION_FIXTURES=1`       | Reads the recorded fixtures instead of the Notion API |
| `NOTION_FULL_REFRESH=1`   | Ignores the page cache and rebuilds every page        |
| `NOTION_INCLUDE_DRAFTS=1` | Includes Draft posts; the `dev` script sets it        |
| `NOTION_SKIP_SYNC=1`      | Skips the Notion sync; the `check` script sets it     |

## Writing content

Every post needs a unique `Slug` (lowercase letters, digits and hyphens) and a `Status`:

- **Draft**, or an empty status: appears only in `pnpm dev`, marked DRAFT.
- **Published**: appears on the site and in lists.
- **Unlisted**: gets its own page, but stays out of lists and is marked `noindex`.

Published and Unlisted posts also need a `Published` date.

A visible project needs a `Description`. If its page has content, it also needs a `Slug`.

## History

This repository used to host a Next.js site based on [nextjs-notion-starter-kit](https://github.com/transitive-bullshit/nextjs-notion-starter-kit). That version is kept on the `archive/v1-nextjs` branch.

## License

The code is released under the [MIT License](LICENSE).
