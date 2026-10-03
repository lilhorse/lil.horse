# lil.horse

Source code of [lil.horse](https://lil.horse), the personal site and blog of Lil'Horse.

Content is written in Notion. At build time, Astro reads it through the official Notion API and renders a fully static site.

## Stack

- [Astro](https://astro.build) 7 with static output
- The official Notion API (`@notionhq/client`), read by a custom content loader
- [sharp](https://sharp.pixelplumbing.com) for images, [KaTeX](https://katex.org) for math and [Expressive Code](https://expressive-code.com) for code blocks
- Plain CSS with cascade layers and `light-dark()`
- JetBrains Mono and IBM Plex Sans from [Fontsource](https://fontsource.org), self-hosted through Astro's Fonts API
- Vitest, Playwright with axe-core, ESLint, Prettier and html-validate

## How it works

1. **Content.** Posts, projects and the profile live in three Notion databases. About and Contact are ordinary Notion pages. Their IDs are in `site.config.ts`.
2. **Sync.** `src/notion/sync.ts` queries the databases, validates every row and turns each page's blocks into a serializable AST. If a row fails validation, the build stops, and the error names the page and the field.
3. **Cache.** Each page's AST is cached in `.cache/`. The cached AST is reused while the page, its inline databases and its media stay unchanged. Notion reports edit times to the minute, so pages edited in the last two minutes are never cached. `NOTION_FULL_REFRESH=1` rebuilds every page.
4. **Media.** Images, files, covers and bookmark previews are downloaded during the build and served from `/_media`, so the site never links to Notion's expiring file URLs. Images are converted to AVIF and WebP at several widths.
5. **Output check.** `pnpm check:dist` scans `dist/` for:
   - expiring Notion URLs
   - broken internal links
   - missing routes
   - JavaScript, CSS or preloaded fonts over budget
   - invalid HTML

## Design

The site looks like a terminal. Each page has a tab bar, a prompt and a command such as `ls -lt ~/blog`, and the page content is the output of that command.

- **Themes.** Night is the dark theme, and Mist with highlighter colours is the light theme. The site follows the system setting. Setting `data-theme="light"` or `data-theme="dark"` on `<html>` overrides it.
- **Colours.** Every theme colour is a token in `src/styles/tokens.css`. `tests/unit/tokens.test.ts` checks each token and the contrast of the text and background pairs the site uses, in both themes.
- **Styles.** `tokens.css`, `base.css` and `prose.css` (Notion content) in `src/styles/` are global. Components keep their own scoped styles. Code block colours are in `src/styles/code-themes.mjs`, and Expressive Code reads them through `ec.config.mjs`.
- **Logo.** The pixel horse with sunglasses is drawn in `brand/horse.ts`: a 24 × 24 grid for the home page and a 16 × 16 grid for the favicon and the header. `pnpm brand` regenerates the SVGs in `src/assets/brand/` and the favicons, app icons and web manifest in `public/`. The generated files are committed, and `tests/unit/brand.test.ts` fails when they are out of date.
- **Accessibility.** `pnpm test:e2e` runs axe on every built page in both themes, at desktop and phone sizes. It also checks that no page scrolls sideways and that, on a phone, every link and button outside running text is at least 44 × 44 px.

## Pages

| Route                | Content                                                       |
| -------------------- | ------------------------------------------------------------- |
| `/`                  | The profile as `neofetch`, featured projects and latest posts |
| `/blog`              | All posts, grouped by year                                    |
| `/blog/<slug>`       | A post                                                        |
| `/blog/tags/<tag>`   | The posts with a tag                                          |
| `/projects`          | All visible projects                                          |
| `/projects/<slug>`   | A project whose Notion page has content                       |
| `/about`, `/contact` | The About and Contact pages                                   |

## Development

You need Node.js 24 (see `.nvmrc`) and pnpm 10.

```bash
pnpm install
cp .env.example .env # then set NOTION_TOKEN
pnpm dev
```

`NOTION_TOKEN` is the token of a Notion integration. The integration needs read access to the three databases and the two pages. If a page contains a linked view of a database, the integration also needs access to the view's source database; otherwise the table is skipped with a warning. `.env` is git-ignored. Never commit it.

`pnpm dev` and `pnpm build` load `.env` only, not `.env.local` or `.env.<mode>`. `pnpm dev` syncs with Notion once, when it starts. Restart it to pick up edits made in Notion.

`pnpm test:e2e` tests the last build in Chromium. Install the browser once with `pnpm exec playwright install chromium`. `SCREENSHOTS=1 pnpm test:e2e tests/e2e/screenshots.spec.ts` saves a full-page screenshot of every page, in both themes and at both sizes, to `test-results/screenshots/`.

| Command                | What it does                                                       |
| ---------------------- | ------------------------------------------------------------------ |
| `pnpm dev`             | Starts the dev server, with Draft posts included                   |
| `pnpm build`           | Builds the production site from live Notion data                   |
| `pnpm build:fixtures`  | Builds offline from the fixtures in `tests/fixtures/notion`        |
| `pnpm preview`         | Serves the last build                                              |
| `pnpm test`            | Runs the unit, DOM and component tests                             |
| `pnpm test:e2e`        | Runs Playwright and axe against the last build in `dist/`          |
| `pnpm lint`            | Runs ESLint                                                        |
| `pnpm check`           | Type-checks the project without syncing Notion                     |
| `pnpm check:dist`      | Checks the build output in `dist/`                                 |
| `pnpm record:fixtures` | Records sanitized fixtures from the live workspace                 |
| `pnpm brand`           | Regenerates the logo, favicons and app icons from `brand/horse.ts` |

| Variable                  | Effect                                                |
| ------------------------- | ----------------------------------------------------- |
| `NOTION_TOKEN`            | Notion integration token, required for live builds    |
| `NOTION_FIXTURES=1`       | Reads the recorded fixtures instead of the Notion API |
| `NOTION_FULL_REFRESH=1`   | Ignores the page cache and rebuilds every page        |
| `NOTION_INCLUDE_DRAFTS=1` | Includes Draft posts; the `dev` script sets it        |
| `NOTION_SKIP_SYNC=1`      | Skips the Notion sync; the `check` script sets it     |

Only `NOTION_TOKEN` belongs in `.env`; a flag set there would apply to every build. Set the others per command: `pnpm build:fixtures` sets `NOTION_FIXTURES`, and `NOTION_FULL_REFRESH=1 pnpm build` runs a full refresh. `pnpm build` refuses to run while `NOTION_SKIP_SYNC` or `NOTION_INCLUDE_DRAFTS` is set.

## Writing content

Every post needs a unique `Slug` (lowercase letters, digits and hyphens) and a `Status`:

- **Draft**, or an empty status: appears only in `pnpm dev`, marked DRAFT.
- **Published**: appears on the site and in lists.
- **Unlisted**: gets its own page, but stays out of lists and is marked `noindex`.

Published and Unlisted posts also need a `Published` date. A post's `Language` (`en` or `zh`; `en` when empty) sets the language of its text.

Each tag used by a Published post gets a page at `/blog/tags/<tag>`. Tags that differ only in letter case or spacing share one page. When a tag loses characters on the way into its address, such as `C++` or `C#`, the address ends in a short hash (`/blog/tags/c-4c21a3`), so different tags never share a page. Very long tags get a shortened address. Tags never stop the build.

A visible project needs a `Description`. If its page has content, it also needs a `Slug`. Check `Featured` to list a project on the home page.

In the profile, `GitHub` and `X` take a handle, `@handle` or a full URL.

An inline database shows the columns and row order of its first table view. To pick the columns and sort order yourself, or to show a column as star ratings, add an entry for its block ID to `databaseDisplay` in `site.config.ts`.

## History

This repository used to host a Next.js site based on [nextjs-notion-starter-kit](https://github.com/transitive-bullshit/nextjs-notion-starter-kit). That version is kept on the `archive/v1-nextjs` branch.

## License

The code is released under the [MIT License](LICENSE).

The site's content is licensed under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). This covers the posts and other writing published on lil.horse, including the copies recorded in `tests/fixtures`. Third-party material on the site, such as link-preview images, keeps its own license.
