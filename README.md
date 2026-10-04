# lil.horse

Source code of [lil.horse](https://lil.horse), the personal site and blog of Lil'Horse.

Content is written in Notion. At build time, Astro reads it through the official Notion API and renders a fully static site.

## Stack

- [Astro](https://astro.build) 7 with static output
- The official Notion API (`@notionhq/client`), read by a custom content loader
- [sharp](https://sharp.pixelplumbing.com) for images, [KaTeX](https://katex.org) for math and [Expressive Code](https://expressive-code.com) for code blocks
- [Pagefind](https://pagefind.app) for search, [Satori](https://github.com/vercel/satori) with resvg for share images, `@astrojs/rss` for the feed and [Giscus](https://giscus.app) for comments
- Plain CSS with cascade layers and `light-dark()`
- JetBrains Mono and IBM Plex Sans from [Fontsource](https://fontsource.org), self-hosted through Astro's Fonts API
- Vitest, Playwright with axe-core, ESLint, Prettier and html-validate

## How it works

1. **Content.** Posts, projects and the profile live in three Notion databases. About and Contact are ordinary Notion pages. Their IDs are in `site.config.ts`.
2. **Sync.** `src/notion/sync.ts` queries the databases, validates every row and turns each page's blocks into a serializable AST. If a row fails validation, the build stops, and the error names the page and the field. `src/notion/` is a self-contained Notion reader: `src/notion/loaders.ts` is the Astro adapter, and an ESLint rule keeps the rest of the folder from importing site code (`sync.ts` has one marked exception).
3. **Cache.** Each page's AST is cached in `.cache/`. The cached AST is reused while the page, its inline databases and its media stay unchanged. Notion reports edit times to the minute, so pages edited in the last two minutes are never cached. `NOTION_FULL_REFRESH=1` rebuilds every page.
4. **Media.** Images, files, covers and bookmark previews are downloaded during the build and served from `/_media`, so the site never links to Notion's expiring file URLs. Images are converted to AVIF and WebP at several widths.
5. **After the pages.** Once every page is built, Pagefind indexes the articles marked `data-pagefind-body` (Published posts, project pages, About and Contact) into one index for both languages, segmented as Chinese, in `dist/pagefind/`. Then `dist/_redirects` and `dist/_headers` are written for Cloudflare, with a Content-Security-Policy that lists the hash of every inline script in the built HTML.
6. **Output check.** `pnpm check:dist` scans `dist/` for:
   - expiring Notion URLs
   - broken internal links, including the share images named in `og:image` and `twitter:image`
   - missing routes
   - JavaScript, CSS or preloaded fonts over budget
   - invalid HTML
   - inline scripts whose hash is missing from the CSP
   - redirects that are not 301 or lead to a page that does not exist

## Design

The site looks like a terminal. Each page has a tab bar, a prompt and a command such as `ls -lt ~/blog`, and the page content is the output of that command.

- **Themes.** Night is the dark theme, and Mist with highlighter colours is the light theme. The header button cycles system, light and dark. The choice is stored in `localStorage` under `theme` and applied by an inline script in `<head>` before the first paint. `<html>` carries `data-theme` (the resolved theme) and `data-theme-pref`, and the `theme-color` metas follow.
- **Command palette.** ⌘K, Ctrl+K, `/`, the `search` buttons in the header and on the 404 page, and the phone's `menu` button open a `<dialog>` with search, navigation, the five latest posts and actions: switch the theme, copy the email address, send an email, open the feed and show the keyboard shortcuts. Search loads Pagefind on the first query. It splits the query into words with `Intl.Segmenter`, the way the index was segmented, and retries the raw query when that finds nothing. Without JavaScript, or when the palette fails to load, the phone's `menu` button opens a plain `<details>` menu.
- **Shortcuts.** `g` then `h`, `b`, `p` or `a` goes to home, the blog, projects or about. `[` and `]` open the older and newer post, or the previous and next project. `t` switches the theme, and `?` opens the help, where the single-key shortcuts can be switched off (stored in `localStorage` under `shortcuts`). Single keys do nothing while you type or while a dialog is open. ⌘K and Ctrl+K always work.
- **Page changes.** Cross-document view transitions keep the header in place, unless the visitor prefers reduced motion. Speculation Rules prerender a same-origin page when its link is hovered.
- **Comments.** Posts load Giscus when the comments section comes within 600 px of the viewport, never while the post is only prerendered, and switch its theme along with the site's. The Night and Mist themes for Giscus are in `public/giscus/`, and built pages load them from `https://lil.horse/giscus/`. The Giscus frame cannot load a stylesheet from a plain-http server, so `pnpm dev` shows Giscus's built-in light and dark themes instead. The repository and category are set in `site.config.ts`.
- **Colours.** Every theme colour is a token in `src/styles/tokens.css`. `tests/unit/tokens.test.ts` checks each token and the contrast of the text and background pairs the site uses, in both themes. The Giscus themes and the share-image template in `src/og/template.ts` cannot use the tokens, so they copy their values. `tests/unit/giscus-themes.test.ts` and `tests/unit/og.test.ts` fail when a copied value is not in the theme.
- **Styles.** `tokens.css`, `base.css` and `prose.css` (Notion content) in `src/styles/` are global. Components keep their own scoped styles. Code block colours are in `src/styles/code-themes.mjs`, and Expressive Code reads them through `ec.config.mjs`.
- **Logo.** The pixel horse with sunglasses is drawn in `brand/horse.ts`: a 24 × 24 grid for the home page and a 16 × 16 grid for the favicon and the header. `pnpm brand` regenerates the SVGs in `src/assets/brand/` and the favicons, app icons and web manifest in `public/`. The generated files are committed, and `tests/unit/brand.test.ts` fails when they are out of date.
- **Accessibility.** `pnpm test:e2e` runs axe on every built page in both themes, at desktop and phone sizes, and on the open command palette and shortcuts help. It also checks that no page scrolls sideways and that, on a phone, every link and button outside running text is at least 44 × 44 px.

## Pages

| Route                               | Content                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| `/`                                 | The profile as `neofetch`, featured projects and latest posts                      |
| `/blog`                             | All posts, grouped by year                                                         |
| `/blog/<slug>`                      | A post                                                                             |
| `/blog/tags/<tag>`                  | The posts with a tag                                                               |
| `/projects`                         | All visible projects                                                               |
| `/projects/<slug>`                  | A project whose Notion page has content                                            |
| `/about`, `/contact`                | The About and Contact pages                                                        |
| `/feed.xml`                         | RSS 2.0 with the full text of the 20 latest Published posts                        |
| `/og/<type>/<slug>.png`             | 1200 × 630 share images for the home page, posts, project pages, About and Contact |
| `/sitemap-index.xml`, `/robots.txt` | The sitemap and the crawler rules; Unlisted posts stay out of the sitemap          |

Every page's `<head>` has Open Graph and Twitter Card tags that point to its share image (pages without one of their own use the home page's) and a link to the feed. The home page, About and posts also carry JSON-LD structured data.

## Redirects and headers

At the end of the build, `integrations/cloudflare.ts` writes two files that Cloudflare reads but never serves:

- `_redirects`, built in `src/lib/redirects.ts`, sends the old site's addresses to the new ones with 301: each post's and page's Notion ID, alone or after its slug (`/<id>`, `/<slug>-<id>`), the two posts that used to live at the root (`/helloworld`, `/douban`) and `/feed`. A final rule strips trailing slashes.
- `_headers`, built in `src/lib/headers.ts`, sets the Content-Security-Policy and the other security headers for every path. It marks `/_astro/`, `/_media/` and the Pagefind index as immutable for a year, and puts uploaded files in `/_media/` under a sandboxing policy of their own.

The Content-Security-Policy, built in `src/lib/csp.ts`, has no `'unsafe-inline'` in `script-src`. Instead, the build scans `dist/` and lists the hash of every inline script the pages run. Never add or edit a hash by hand; change the script and rebuild. `pnpm check:dist` fails if a page has an inline script whose hash is missing. Beyond the site itself, the policy allows Giscus (its script, its frame and the `default.css` that its `client.js` adds to the page), the Cloudflare Web Analytics beacon, YouTube and Vimeo embeds, and WebAssembly for Pagefind.

`pnpm preview` ignores both files. To try them locally, run `pnpm exec tsx scripts/serve-dist.ts 4323`, which serves `dist/` on port 4323 and applies the redirects and headers as Cloudflare would. The end-to-end tests use the same server.

## Development

You need Node.js 24 (see `.nvmrc`) and pnpm 10.

```bash
pnpm install
cp .env.example .env # then set NOTION_TOKEN
pnpm dev
```

`NOTION_TOKEN` is the token of a Notion integration. The integration needs read access to the three databases and the two pages. If a page contains a linked view of a database, the integration also needs access to the view's source database; otherwise the table is skipped with a warning. `.env` is git-ignored. Never commit it.

`pnpm dev` and `pnpm build` load `.env` only, not `.env.local` or `.env.<mode>`. `pnpm dev` syncs with Notion once, when it starts. Restart it to pick up edits made in Notion.

`pnpm dev` has no search index of its own. If `dist/pagefind/` exists when it starts, it serves that index from the last build; otherwise the palette says search is not available.

`pnpm test:e2e` tests the last build in Chromium, at desktop and phone sizes, and runs the engine-specific checks in WebKit and Firefox too. Install the browsers once with `pnpm exec playwright install chromium webkit firefox`. The test server uses port 4322; set `E2E_PORT` to use another, for example to run several worktrees at once. End-to-end tests stub third-party requests, so they never load Giscus or the analytics beacon from the network.

`tests/e2e/visual.spec.ts` compares the home page, the blog list and a post, in both themes and at both sizes, with the screenshots in `tests/e2e/visual.spec.ts-snapshots/`. The baselines are macOS screenshots (their names end in `-darwin`), and the comparison runs only when `dist/` is a fixture build. After an intended visual change, refresh them with `pnpm build:fixtures && pnpm test:e2e tests/e2e/visual.spec.ts --update-snapshots`.

`SCREENSHOTS=1 pnpm test:e2e tests/e2e/screenshots.spec.ts` saves a full-page screenshot of every page, in both themes and at both sizes, to `test-results/screenshots/`.

| Command                | What it does                                                       |
| ---------------------- | ------------------------------------------------------------------ |
| `pnpm dev`             | Starts the dev server, with Draft posts included                   |
| `pnpm build`           | Builds the production site from live Notion data                   |
| `pnpm build:fixtures`  | Builds offline from the fixtures in `tests/fixtures/notion`        |
| `pnpm preview`         | Serves the last build, ignoring `_redirects` and `_headers`        |
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
| `E2E_PORT`                | Port of the end-to-end test server (default 4322)     |

Only `NOTION_TOKEN` belongs in `.env`; a flag set there would apply to every build. Set the others per command: `pnpm build:fixtures` sets `NOTION_FIXTURES`, and `NOTION_FULL_REFRESH=1 pnpm build` runs a full refresh. `pnpm build` refuses to run while `NOTION_SKIP_SYNC` or `NOTION_INCLUDE_DRAFTS` is set.

## Writing content

Every post needs a unique `Slug` (lowercase letters, digits and hyphens) and a `Status`:

- **Draft**, or an empty status: appears only in `pnpm dev`, marked DRAFT.
- **Published**: appears on the site and in lists.
- **Unlisted**: gets its own page, but stays out of lists, search, the feed and the sitemap, and is marked `noindex`.

Published and Unlisted posts also need a `Published` date. A post's `Language` (`en` or `zh`; `en` when empty) sets the language of its text.

Giscus finds a post's discussion by its `Slug`, so a post whose slug changes no longer shows its earlier comments.

Each tag used by a Published post gets a page at `/blog/tags/<tag>`. Tags that differ only in letter case or spacing share one page. When a tag loses characters on the way into its address, such as `C++` or `C#`, the address ends in a short hash (`/blog/tags/c-4c21a3`), so different tags never share a page. Very long tags get a shortened address. Tags never stop the build.

A visible project needs a `Description`. If its page has content, it also needs a `Slug`. Check `Featured` to list a project on the home page.

In the profile, `GitHub` and `X` take a handle, `@handle` or a full URL.

An inline database shows the columns and row order of its first table view. To pick the columns and sort order yourself, or to show a column as star ratings, add an entry for its block ID to `databaseDisplay` in `site.config.ts`.

Share images show the title in JetBrains Mono, with Noto Sans SC for Chinese; a post's image adds its date and tags. Emoji are dropped from the title, and a character that neither font covers is reported in the build log.

## Site configuration

Besides the Notion IDs, `site.config.ts` holds the site's name and URL, the Giscus repository and discussion category with their IDs, and the Cloudflare Web Analytics token, `analytics.cloudflareToken`.

The token is empty on purpose. The lil.horse site in Cloudflare Web Analytics uses automatic injection at the edge, set to exclude visitor data from the EU; a static page cannot do that, because it cannot tell where its visitor is. The CSP already allows the injected beacon. If you set a token, the site adds the beacon itself, and a prerendered page loads it only once it is shown. In that case, turn off automatic injection in Cloudflare, or every visit is counted twice. Fixture builds never include the beacon.

## History

This repository used to host a Next.js site based on [nextjs-notion-starter-kit](https://github.com/transitive-bullshit/nextjs-notion-starter-kit). That version is kept on the `archive/v1-nextjs` branch.

## License

The code is released under the [MIT License](LICENSE).

The site's content is licensed under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). This covers the posts and other writing published on lil.horse, including the copies recorded in `tests/fixtures`. Third-party material on the site, such as link-preview images, keeps its own license.
