# lil.horse

This repository holds the source code of [lil.horse](https://lil.horse), the personal site and blog of Lil'Horse. Content is written in Notion. At build time, Astro reads it through the official Notion API and renders a fully static site.

## Stack

The site uses the following tools:

| Area             | Tools                                                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework        | [Astro](https://astro.build) 7 with static output                                                                                                                                               |
| Content          | The official Notion API (`@notionhq/client`), read by a custom content loader                                                                                                                   |
| Images           | [sharp](https://sharp.pixelplumbing.com)                                                                                                                                                        |
| Math             | [KaTeX](https://katex.org)                                                                                                                                                                      |
| Code blocks      | [Expressive Code](https://expressive-code.com)                                                                                                                                                  |
| Search           | [Pagefind](https://pagefind.app)                                                                                                                                                                |
| Share images     | [Satori](https://github.com/vercel/satori) with resvg                                                                                                                                           |
| Masthead banner  | resvg and STIX Two Math                                                                                                                                                                         |
| Feed             | `@astrojs/rss`                                                                                                                                                                                  |
| Comments         | [Giscus](https://giscus.app)                                                                                                                                                                    |
| Styles           | Plain CSS with cascade layers and `light-dark()`                                                                                                                                                |
| Fonts            | JetBrains Mono and IBM Plex Sans from [Fontsource](https://fontsource.org), self-hosted through the Astro Fonts API                                                                             |
| Hosting          | [Cloudflare Workers](https://developers.cloudflare.com/workers/static-assets/) static assets, deployed with [Wrangler](https://developers.cloudflare.com/workers/wrangler/) from GitHub Actions |
| Tests and checks | Vitest, Playwright with axe-core, Lighthouse CI, ESLint, Prettier, and html-validate                                                                                                            |

## How it works

The site goes from Notion to Cloudflare in these stages:

1. **Content.** Posts, projects, and the profile live in three Notion databases. About and Contact are ordinary Notion pages, and the home page's masthead comes from the workspace's root page. `site.config.ts` holds their IDs.
2. **Sync.** `src/notion/sync.ts` queries the databases, validates every row, and turns each page's blocks into a serializable abstract syntax tree (AST). If a row fails validation, the build stops with an error that names the page and the field. `src/notion/` is a self-contained Notion reader: `src/notion/loaders.ts` is the Astro adapter, and an ESLint rule keeps the rest of the folder from importing site code (`sync.ts` has one marked exception).
3. **Cache.** The build caches each page's AST in `.cache/` and reuses it while the page, its inline databases, and its media stay unchanged. Notion reports edit times to the minute, so the build never caches a page edited in the last two minutes. `NOTION_FULL_REFRESH=1` rebuilds every page.
4. **Media.** The build downloads images, files, covers, and bookmark previews, and the site serves them from `/_media`, so it never links to expiring Notion file URLs. The build converts images to AVIF and WebP at several widths.
5. **After the pages.** After every page is built, Pagefind indexes the articles marked `data-pagefind-body` (Published posts, project pages, About, and Contact) into one index for both languages, segmented as Chinese, in `dist/pagefind/`. The build stops if no page carries the marker, because without it Pagefind indexes every page whole. The build keeps only the files that the palette loads, not the Pagefind UI bundles. Then it writes `dist/_redirects` and `dist/_headers` for Cloudflare, with a Content Security Policy (CSP) that lists the hash of every inline script in the built pages.
6. **Output check.** `pnpm check:dist` scans `dist/` for the following:
   - Expiring Notion URLs.
   - Broken internal links, including the share images named in `og:image` and `twitter:image`.
   - Internal links that end in a slash or in `.html`, which Cloudflare redirects.
   - Missing routes.
   - JavaScript, CSS, or preloaded fonts over budget.
   - Invalid HTML.
   - Inline scripts whose hash is missing from the CSP, that a second, plain count finds but the scan missed, or that sit inside `<svg>` or `<math>`.
   - `'unsafe-inline'`, `'unsafe-eval'`, or `'strict-dynamic'` in the CSP's `script-src`.
   - Redirects that aren't `301`, lead to a page that doesn't exist, or hide a built page.
7. **Deploy.** GitHub Actions runs the same build and output check. Then `wrangler deploy` uploads `dist/` to Cloudflare Workers, together with the small Worker that receives Notion webhooks. See [Deployment](#deployment).

## Design

The site looks like a terminal. Each page has a tab bar, a prompt, and a command such as `ls -lt ~/blog`, and the page content is the output of that command.

- **Themes.** Night is the dark theme, and Mist, with highlighter colors, is the light theme. The header button cycles through system, light, and dark, and a visually hidden status announces each choice to screen readers. The site stores the choice in `localStorage` under `theme`, and an inline script in `<head>` applies it before the first paint. Other open tabs follow a change immediately. A prerendered page, or one restored from the back-forward cache, applies the change when shown. `<html>` carries `data-theme` (the resolved theme) and `data-theme-pref`, and the `theme-color` meta tags follow the theme.
- **Command palette.** The palette is a `<dialog>` with search, navigation, the five latest posts, and actions. The actions switch the theme, copy the email address, send an email, open the feed, and show the keyboard shortcuts. `Command+K`, `Control+K`, `/`, the `search` buttons in the header and on the 404 page, and the `menu` button on phones open it. Search loads Pagefind on the first query. It splits the query into words with `Intl.Segmenter`, the way the index was segmented, and retries the raw query if that finds nothing. Without JavaScript, or when the palette fails to load, the `menu` button on phones opens a plain `<details>` menu. Elsewhere, when the palette or the help fails to load a second time, most likely because a deploy replaced its file, the page reloads, unless the browser is offline.
- **Shortcuts.** `g` then `h`, `b`, `p`, or `a` goes to home, the blog, projects, or about. `[` and `]` open the older and newer post, or the previous and next project. `t` switches the theme, and `?` opens the help, where you can switch off the single-key shortcuts. That choice is stored in `localStorage` under `shortcuts`; without storage, it lasts until you leave the page. Single keys do nothing while you type or while a dialog is open. `Command+K` and `Control+K` always work.
- **Page changes.** Cross-document view transitions keep the header in place, unless the visitor prefers reduced motion. Speculation Rules prerender a same-origin page when the visitor holds the pointer over its link.
- **Comments.** Posts load Giscus when the comments section comes within 600&nbsp;px of the viewport, never while the post is only prerendered, and switch its theme along with the site's. The Night and Mist themes for Giscus are in `public/giscus/`. Built pages load them from `/giscus/` on the host that serves the page, so lil.horse, workers.dev, and version URLs each use their own copy. The Giscus frame can't load a stylesheet from a plain-HTTP server, so `pnpm dev` shows the built-in Giscus light and dark themes instead. `site.config.ts` sets the repository and category.
- **Colors.** Every theme color is a token in `src/styles/tokens.css`. `tests/unit/tokens.test.ts` checks each token, and the contrast of the text and background pairs that the site uses, in both themes. The Giscus themes, the share-image template in `src/og/template.ts`, and the standalone banners in `src/lib/banner.ts` can't use the tokens, so they copy the values. `tests/unit/giscus-themes.test.ts`, `tests/unit/og.test.ts`, and `tests/unit/banner.test.ts` fail when a copied value isn't in the theme.
- **Styles.** In `src/styles/`, `tokens.css`, `base.css`, and `prose.css` (for Notion content) are global. Components keep their own scoped styles. Code block colors are in `src/styles/code-themes.mjs`, and Expressive Code reads them through `ec.config.mjs`.
- **Logo.** `brand/horse.ts` draws the pixel horse with sunglasses: a 24x24 grid for the home page, and a 16x16 grid for the favicon and the header. `pnpm brand` regenerates the SVGs in `src/assets/brand/`, and the favicons, app icons, and web manifest in `public/`. The generated files are committed, and `tests/unit/brand.test.ts` fails when they're out of date.
- **Masthead.** The `neofetch` card on the home page opens with the root page's title as a pixel banner, with its slogan below (see [Writing content](#writing-content)). At build time, `src/lib/banner.ts` renders the title with resvg at 16&nbsp;px in the [banner font](#banner-font), the only font it loads. It keeps the pixels whose alpha is at least 128 and crops them to the ink. The page draws that bitmap as an inline SVG: one rectangle per run of lit pixels in a row, filled with a gradient through the card's six swatch colors. Each bitmap pixel takes a whole number of screen pixels that brings the banner close to 300&nbsp;px wide, but at most five, so a short title stays title-sized. The banner's accessible name is the title in plain letters (Unicode NFKC, so `𝕷𝖎𝖑’𝕳𝖔𝖗𝖘𝖊` reads `Lil’Horse`). The [GitHub profile README](#github-profile-readme) shows the same bitmap as an image. The build warns about a character that the font lacks and leaves it out. A title with nothing the font can draw shows as plain text.
- **Slogan.** On the first view of the home page in a browser session, the slogan types out at 35&nbsp;ms per character. The typing starts when the page is in front of the visitor, not while it's only prerendered or in a background tab. A copy hidden from screen readers does the typing over the slogan, which stays in the page, invisible. The card therefore keeps its size, and screen readers, crawlers, and visitors without JavaScript get the whole text. The cursor moves with a transform, so the typing causes no layout shift. `sessionStorage` records under `slogan-typed` that the typing has run; without storage, it runs on every view. For visitors who prefer reduced motion, the typing never runs and the cursor never blinks.
- **Accessibility.** `pnpm test:e2e` runs axe on every built page in both themes, at desktop and phone sizes, and on the open command palette and shortcuts help. It also checks that no page scrolls sideways, and that on a phone, every link and button outside running text is at least 44x44&nbsp;px.

### Banner font

`src/assets/fonts/stix-two-math-subset.otf` is a subset of STIX Two Math 2.13 b171, from `fonts/static_otf/STIXTwoMath-Regular.otf` at the `v2.13b171` tag of [stipub/stixfonts](https://github.com/stipub/stixfonts). It's licensed under the SIL Open Font License 1.1, whose text is next to it in `OFL.txt`. The build reads the font to draw the banner and never serves it.

The subset keeps Basic Latin, Latin-1, and the general punctuation from U+2010 to U+2027 (with `’`) and from U+2032 to U+2034. It also keeps the Mathematical Alphanumeric Symbols: the styled letters, such as `𝕷`, that a Notion title can use.

To regenerate it with fontTools (`pip install fonttools`), run the following:

```bash
pyftsubset STIXTwoMath-Regular.otf \
  --unicodes='U+0020-007E,U+00A0-00FF,U+2010-2027,U+2032-2034,U+1D400-1D7FF' \
  --name-IDs='*' \
  --output-file=src/assets/fonts/stix-two-math-subset.otf
```

`--name-IDs='*'` keeps the copyright and license entries in the font's name table.

## Pages

The build generates these routes:

| Route                                                   | Content                                                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `/`                                                     | The profile as `neofetch`, featured projects, and latest posts                            |
| `/blog`                                                 | All posts, grouped by year                                                                |
| `/blog/<slug>`                                          | A post                                                                                    |
| `/blog/tags/<tag>`                                      | The posts with a tag                                                                      |
| `/projects`                                             | All visible projects                                                                      |
| `/projects/<slug>`                                      | A project whose Notion page has content                                                   |
| `/about`, `/contact`                                    | The About and Contact pages                                                               |
| `/feed.xml`                                             | RSS 2.0 with the full text of the 20 latest Published posts                               |
| `/og/<type>/<slug>.png`                                 | 1200x630 share images for the home page, posts, project pages, About, and Contact         |
| `/sitemap-index.xml`, `/robots.txt`                     | The sitemap and the crawler rules; Unlisted posts stay out of the sitemap                 |
| `/profile/README.md`                                    | The home page's card in Markdown, for the [GitHub profile README](#github-profile-readme) |
| `/brand/horse-night.svg`, `/brand/horse-chestnut.svg`   | The 24x24 horses from `src/assets/brand/`, which the profile README shows                 |
| `/brand/masthead-dark.svg`, `/brand/masthead-light.svg` | The masthead banner as a standalone file in each theme, for the profile README            |

Every page's `<head>` has Open Graph and Twitter Card tags that point to its share image, and a link to the feed. Pages without a share image of their own use the home page's. The home page, About, and posts also carry JSON-LD structured data.

## Redirects and headers

At the end of the build, `integrations/cloudflare.ts` writes two files that Cloudflare reads but never serves:

- `_redirects`, built in `src/lib/redirects.ts`, sends the old site's addresses to the new ones with `301`. It covers each post's and page's Notion ID, alone or after its slug (`/<id>`, `/<slug>-<id>`), the two posts that used to live at the root (`/helloworld`, `/douban`), and `/feed`. A final rule strips trailing slashes.
- `_headers`, built in `src/lib/headers.ts`, sets the CSP and the other security headers for every path. It marks `/_astro/`, `/_media/`, and the Pagefind index as immutable for a year, and puts uploaded files in `/_media/` under a sandboxing policy of their own.

The CSP, built in `src/lib/csp.ts`, has no `'unsafe-inline'` in `script-src`. Instead, the build scans `dist/` and lists the hash of every inline script that the pages run, hashing the text as browsers do (line ends become `\n`). The build doesn't scan uploaded files in `/_media/`, so a script in an upload never widens the site's policy. `pnpm check:dist` fails if a page has an inline script whose hash is missing. Never add or edit a hash manually; change the script and rebuild.

Beyond the site itself, the policy allows Giscus: its script, its frame, and the `default.css` that its `client.js` adds to the page. It also allows the Cloudflare Web Analytics beacon, YouTube and Vimeo embeds, and WebAssembly for Pagefind. It allows no plugins (`object-src 'none'`).

`pnpm preview` ignores both files. To try them locally, run `pnpm exec tsx scripts/serve-dist.ts 4323`, which serves `dist/` on port `4323` and applies the redirects and headers as Cloudflare does. Like Cloudflare, the server also does the following:

- Sends any other spelling of a path, such as `/%5Fmedia/…`, `//blog`, or `/blog.html`, to the canonical one with `307`.
- Gives files that no rule caches `Cache-Control: public, max-age=0, must-revalidate`.
- Gzips the responses that Cloudflare compresses (text, SVG, TrueType fonts, and icons), so Lighthouse times the bytes that a visitor downloads.

The end-to-end tests and Lighthouse CI use the same server.

## Deployment

Cloudflare Workers serves the site as static assets. `wrangler.jsonc` names the Worker `lil-horse`, points its assets at `dist/`, serves `x.html` at `/x`, returns `404.html` for unknown paths, and runs the Worker script only for `/hooks/*`. It sets `workers_dev` and `preview_urls` explicitly: both default to off when `routes` is set, and the Notion webhook and pull request previews depend on them.

The Worker responds at `https://lil-horse.lilhorse.workers.dev`, and every version, deployed or only uploaded, gets its own preview URL on workers.dev. A `_headers` rule adds `X-Robots-Tag: noindex` to responses from every workers.dev address, which keeps those addresses out of search engines.

The Worker code is in `src/worker/hook.ts`. It handles `POST /hooks/notion`, responds with `404` to any other path under `/hooks/`, and passes everything else to the static assets. The entry module, `src/worker/index.ts`, only re-exports the default handler, because the Workers runtime treats every export of the entry module as an entrypoint.

An edit in Notion reaches the site as follows:

1. Notion sends a webhook event. The Worker refuses a body over 1&nbsp;MiB with `413`. Before it parses the body, it checks `X-Notion-Signature`, the HMAC-SHA256 of the raw body keyed by the subscription's verification token (`NOTION_WEBHOOK_SECRET`). If the signature doesn't match, the Worker responds with `401`.
2. For events that can change the site, the Worker starts `deploy.yml` on `main` with a workflow dispatch, using `GITHUB_DISPATCH_TOKEN`. These are the `page.*` and `data_source.*` events listed in `BUILD_EVENTS`. The dispatch goes to this repository (`vars.GITHUB_REPOSITORY` in `wrangler.jsonc`). If GitHub accepts the dispatch, the Worker responds with `202`; if not, it responds with `502`, so Notion retries. GitHub accepts the dispatch only after `deploy.yml` exists on `main`; until then, GitHub responds with `404`, and the Worker responds with `502`. Other events, such as comments and page locks, get `200` and change nothing.
3. `.github/workflows/deploy.yml` builds from live Notion data, runs `pnpm check:dist`, and deploys with `wrangler deploy`. A second job then syncs the [GitHub profile README](#github-profile-readme).

The deploy workflow has these triggers:

| Trigger             | Details                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Edit in Notion      | The Worker's workflow dispatch, on `main`                                                                                                           |
| Push to `main`      | Every push                                                                                                                                          |
| Manual              | From the **Actions** tab, or with `gh workflow run deploy.yml`. For a full refresh, which sets `NOTION_FULL_REFRESH=1`, add `-f full_refresh=true`. |
| Daily, at 17:00 UTC | `.github/workflows/refresh.yml` runs it on `main` as a reusable workflow, with a full refresh.                                                      |

The schedule has a workflow of its own because GitHub disables a workflow with a schedule after 60 days without activity in a public repository. That rule can stop only the daily refresh, never the deploys from a push or from Notion. If GitHub disables it, enable the **Daily refresh** workflow again from the **Actions** tab.

The deploy workflow deploys only `main`: a manual run on another branch skips the job. A newer run cancels one still in progress, so a burst of edits deploys once. The workflow restores the `.cache/` page cache and the Astro data store in `node_modules/.astro` from the last successful run.

To deploy from your own machine, do the following:

1. Sign in with `pnpm exec wrangler login`.
2. Run `pnpm build && pnpm check:dist && pnpm smoke:worker && pnpm exec wrangler deploy`.

`pnpm smoke:worker` uses `wrangler dev` to start the Worker and the last build in `dist/` under workerd, the runtime that Cloudflare runs. It then checks the status codes of `GET /hooks/notion`, an unsigned `POST /hooks/notion`, `GET /hooks/other`, and `GET /`. It never loads `.dev.vars` or `.env`, so no local secret reaches the Worker. It listens on port `8787` unless `WORKER_SMOKE_PORT` names another. Before any deploy that changes the Worker, make sure that `pnpm smoke:worker` passes. `wrangler deploy --dry-run` only bundles the Worker and never starts the runtime, so it can't tell whether the Worker starts.

### Notion webhook

The webhook subscription belongs to the Notion integration. It points at `https://lil-horse.lilhorse.workers.dev/hooks/notion` and subscribes to the 12 events in `BUILD_EVENTS`; the Worker ignores any other event. Notion can't change the URL of a verified subscription, so the subscription stays on workers.dev whatever domain serves the site.

Notion verifies a new subscription by posting a `verification_token`. While `NOTION_WEBHOOK_SECRET` isn't set, the Worker writes that token to its logs and responds with `200`, and it refuses every event with `401`.

To connect a subscription, do the following:

1. Follow the Worker's logs with `pnpm exec wrangler tail lil-horse`, or, in the Cloudflare dashboard, open **Workers & Pages**, then **lil-horse**, then **Observability**.
2. Create the subscription in Notion. As you do, the log line `Notion verification token: "…"` arrives. Its `cf-connecting-ip` and `user-agent` help you tell Notion's request from anyone else's, because anyone can post a token while no secret is set.
3. Copy the token without its quotes, and paste it into Notion to verify the subscription.
4. With the token still on the clipboard, store it as the Worker secret with `pbpaste | tr -d '\n' | pnpm exec wrangler secret put NOTION_WEBHOOK_SECRET`, and then clear the clipboard with `printf '' | pbcopy` (see [Secrets](#secrets)). From then on, the Worker never logs a token.

During a rotation, the Worker refuses every event until the new secret is in place; the daily build picks up any edits made in the meantime. To rotate the token, do the following:

1. Delete the secret with `pnpm exec wrangler secret delete NOTION_WEBHOOK_SECRET`. The Worker logs a token only while no secret is set.
2. Delete the subscription in Notion.
3. Follow the steps to connect a subscription.

### Secrets

The deploy workflow and the `preview` job read the GitHub secrets, and the Worker reads its own. Nothing secret is in the repository or in `wrangler.jsonc`.

| Where          | Secret                  | Scope                                                                                                                                                                            |
| -------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Actions | `NOTION_TOKEN`          | The read-only Notion integration token                                                                                                                                           |
| GitHub Actions | `CLOUDFLARE_API_TOKEN`  | An account-owned Cloudflare API token with the Workers Editor role on this account. It deploys, but can't create or delete Workers.                                              |
| GitHub Actions | `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account ID                                                                                                                                                        |
| GitHub Actions | `PROFILE_README_TOKEN`  | A fine-grained GitHub token for `lilhorse/lilhorse` only, with **Contents: Read and write** and the mandatory **Metadata: Read-only**. It can change nothing in this repository. |
| Worker         | `NOTION_WEBHOOK_SECRET` | The webhook subscription's verification token                                                                                                                                    |
| Worker         | `GITHUB_DISPATCH_TOKEN` | A fine-grained GitHub token for this repository only, with **Actions: Read and write** and the mandatory **Metadata: Read-only**. It can't push code.                            |

Set secrets from the clipboard, so a value never appears on screen, in the shell history, or in a file. `wrangler secret put` requires `pnpm exec wrangler login` first. To set a secret, do the following:

1. Type or paste the command at the prompt, but don't run it yet. Copying the command after the value replaces the value on the clipboard.
2. Copy the value where it's created.
3. Run the command.

The following commands show both forms, for a GitHub secret and for a Worker secret:

```bash
pbpaste | tr -d '\n' | gh secret set CLOUDFLARE_API_TOKEN --repo lilhorse/lil.horse
pbpaste | tr -d '\n' | pnpm exec wrangler secret put GITHUB_DISPATCH_TOKEN
printf '' | pbcopy
```

`tr -d '\n'` drops a trailing newline, and the last command clears the clipboard. `wrangler secret put` takes effect immediately, because it deploys a new version of the Worker.

Cloudflare refuses to change a secret while the Worker's newest version isn't the deployed one. That's the case after every pull request preview, which runs `wrangler versions upload`, and after a rollback, until the next deployment. In that case, deploy first with `gh workflow run deploy.yml`, and wait for the run to finish. Don't follow the suggestions from wrangler to deploy the latest version or to use `wrangler versions secret put`: both build on the newest version, not on the deployed one.

`GITHUB_DISPATCH_TOKEN` doesn't expire, but GitHub revokes a personal access token that hasn't been used for a year. The Worker uses this token only when an edit in Notion starts a build. After GitHub revokes it, GitHub responds with `401`, and the Worker logs `GitHub dispatch answered 401` and responds with `502`. Edits in Notion then stop starting builds; the daily build still publishes them. To recover, do the following:

1. Create a new token with the same permissions, and store it the same way.
2. In the **Webhooks** tab of the integration's settings in Notion, check that the subscription is still active. Notion inactivates a subscription after repeated failed deliveries.

### GitHub profile README

The GitHub profile repository, `lilhorse/lilhorse`, shows the home page's card as its README. The build writes that README to `dist/profile/README.md` (`src/pages/profile/README.md.ts`, from `src/lib/profile-readme.ts`). It contains the horse, the masthead banner, the slogan, the profile's rows, the swatches, and the bio. Text from Notion has its Markdown and HTML escaped and stays on one line. The email row links to the contact page, so the address itself never appears in the README.

The README shows two images from lil.horse, each in a `<picture>` whose dark variant follows the visitor's GitHub theme:

- The horses, `/brand/horse-night.svg` and `/brand/horse-chestnut.svg`. The build serves them from the same files in `src/assets/brand/` as the home page.
- The banner, `/brand/masthead-dark.svg` and `/brand/masthead-light.svg`. The build draws these standalone SVG files from the same bitmap as the home page's banner. Each file contains its theme's six swatch colors as a gradient and its glow as an SVG filter. It uses four screen pixels to a bitmap pixel, with three pixels of margin for the glow. The colors are copies of the theme tokens, kept in `BANNER_COLORS` in `src/lib/banner.ts`; `tests/unit/banner.test.ts` fails when they differ from `tokens.css`. The image's `alt` is the title in plain letters. For a title that the banner font can draw none of, the files hold an empty image, and the README shows the title as bold text instead.

Each image's link to lil.horse sits inside its `<picture>`, around the `<img>`. GitHub wraps every image whose parent isn't a link in a link of its own. Nested in an outer link, that GitHub link splits the `<picture>` and loses the dark variant.

The sync runs as follows:

1. The deploy job keeps `dist/profile/README.md` as an artifact of its run.
2. After the deploy succeeds, the `sync-profile` job downloads the artifact and runs `scripts/sync-profile-readme.ts` with plain Node. Node strips the script's types itself, so the job installs no packages.
3. The job passes `PROFILE_README_TOKEN` as `GH_TOKEN` and sets `PROFILE_REPOSITORY` to `lilhorse/lilhorse`. The job's own `GITHUB_TOKEN` can only read this repository.
4. Through the GitHub contents API, the script compares the profile repository's `README.md` with the build. If they differ, it commits the build's version as `chore: sync the profile card from lil.horse` (or creates the file). Otherwise, it prints `Profile README unchanged`.

The daily refresh runs the same workflow with the same secrets, so the card follows Notion within a day, and immediately when an edit in Notion starts a deploy. Without a token, as in a fork or a local run, the script prints a notice and does nothing.

After a network error or a `5xx` response, the script tries once more two seconds later. If GitHub still fails, or refuses, for example because the token was revoked, only the `sync-profile` job fails, with the reason from GitHub. The site is deployed, and the deploy job has saved its cache. To recover, create a new token with the same permissions, store it as described in [Secrets](#secrets), and then run the deploy workflow again.

### Rollback

To roll back a bad deployment, do the following:

1. Sign in with `pnpm exec wrangler login`.
2. Run `pnpm exec wrangler rollback`. It puts the version of the previous deployment back live.
3. Revert the cause on `main` or in Notion. Any later deployment, including the daily one, replaces the rollback.

If a build or `pnpm check:dist` fails, nothing is deployed: the previous deployment stays live, and GitHub sends an email to whoever started the failed run:

| Run started by    | Email goes to                                                     |
| ----------------- | ----------------------------------------------------------------- |
| A push            | The pusher                                                        |
| An edit in Notion | The owner of `GITHUB_DISPATCH_TOKEN`                              |
| The daily refresh | The person who created `refresh.yml` or last changed its schedule |

## Continuous integration

`.github/workflows/ci.yml` runs the following jobs on pull requests, on pushes to `rebuild/**` branches, and manually:

- `test` runs `pnpm lint`, `pnpm check`, `pnpm format:check`, and `pnpm test`.
- `e2e` runs a fixture build, `pnpm check:dist`, `wrangler deploy --dry-run` (which bundles the Worker and validates `wrangler.jsonc` without deploying), `pnpm smoke:worker` (which starts the Worker under workerd), and `pnpm test:e2e`. It runs in the Playwright Docker image, so the Linux screenshot baselines come from the same fonts and browsers. If the job fails, it keeps `test-results/` as the `e2e-results` artifact.
- `lighthouse` runs a fixture build and `pnpm lighthouse`. Lighthouse CI runs on the home page, the blog list, a post, the projects list, and About, with mobile emulation and three runs. The job fails if the median performance score is under 0.98, or if any run scores under 1 for accessibility, best practices, or SEO. It keeps the reports as the `lighthouse-reports` artifact.
- `preview` runs only for pull requests from this repository. It uploads a build from live Notion data as a Worker version with the alias `pr-<number>`, and a comment on the pull request links the version URL and `https://pr-<number>-lil-horse.lilhorse.workers.dev`. The comment names the pull request's head commit and the merge commit that was built, whose hash the site footer shows. Each push updates the same comment: the alias follows the latest push, and the version URL keeps showing its own build. Uploaded versions are never deployed and don't change what `wrangler rollback` returns to.

`.github/workflows/baselines.yml` regenerates the Linux screenshot baselines in the same image. To refresh them, do the following:

1. Push the commit to test to a `baselines/<name>` branch (`git push origin HEAD:baselines/<name>`), or run the workflow manually from the **Actions** tab.
2. Download the `visual-baselines-linux` artifact with `gh run download <run-id> -n visual-baselines-linux -D tests/e2e/visual.spec.ts-snapshots`.
3. Commit the `-linux.png` files next to the `-darwin.png` ones.
4. Delete the branch.

When you upgrade `@playwright/test`, move the image tag in `ci.yml` and `baselines.yml` to the same version.

## Development

You need Node.js 24 (see `.nvmrc`) and pnpm 10. To install the dependencies and start the dev server, run the following:

```bash
pnpm install
cp .env.example .env # then set NOTION_TOKEN
pnpm dev
```

`NOTION_TOKEN` is the token of a Notion integration. The integration needs read access to the three databases and the three pages: About, Contact, and the root page. Sharing the root page with the integration also shares every page under it. After you share the root page, an edit anywhere under it starts a deploy through the [Notion webhook](#notion-webhook). If a page contains a linked view of a database, the integration also needs access to the view's source database; otherwise, the build skips the table with a warning. `.env` is git-ignored. Never commit it.

`pnpm dev` and `pnpm build` load only `.env`, not `.env.local` or `.env.<mode>`. `pnpm dev` syncs with Notion once, when it starts; to pick up edits made in Notion, restart it.

`pnpm dev` has no search index of its own. If `dist/pagefind/` exists when it starts, it serves that index from the last build; otherwise, the palette says that search isn't available.

### Tests

`pnpm test:e2e` tests the last build in Chromium, at desktop and phone sizes, and runs the engine-specific checks in WebKit and Firefox too. Install the browsers once with `pnpm exec playwright install chromium webkit firefox`. The test server uses port `4322`. To use another port, for example to run several worktrees at the same time, set `E2E_PORT`. End-to-end tests stub third-party requests, so they never load Giscus or the analytics beacon from the network.

`tests/e2e/visual.spec.ts` compares the home page, the blog list, and a post, in both themes and at both sizes, with the screenshots in `tests/e2e/visual.spec.ts-snapshots/`. Each platform has its own set of baselines: `-darwin` for a Mac and `-linux` for CI. The comparison runs only when `dist/` is a fixture build. After an intended visual change, refresh the Mac set with `pnpm build:fixtures && pnpm test:e2e tests/e2e/visual.spec.ts --update-snapshots`, and the Linux set with the baselines workflow (see [Continuous integration](#continuous-integration)).

`pnpm lighthouse` runs the same Lighthouse checks as CI against the last build, served on the end-to-end port, and writes the reports to `test-results/lighthouse/`. It requires Chrome.

To save a full-page screenshot of every page, in both themes and at both sizes, to `test-results/screenshots/`, run `SCREENSHOTS=1 pnpm test:e2e tests/e2e/screenshots.spec.ts`.

### Commands

These are the main commands:

| Command                | What it does                                                        |
| ---------------------- | ------------------------------------------------------------------- |
| `pnpm dev`             | Starts the dev server, with Draft posts included                    |
| `pnpm build`           | Builds the production site from live Notion data                    |
| `pnpm build:fixtures`  | Builds offline from the fixtures in `tests/fixtures/notion`         |
| `pnpm preview`         | Serves the last build, ignoring `_redirects` and `_headers`         |
| `pnpm test`            | Runs the unit, DOM, and component tests                             |
| `pnpm test:e2e`        | Runs Playwright and axe against the last build in `dist/`           |
| `pnpm lint`            | Runs ESLint                                                         |
| `pnpm check`           | Type-checks the project without syncing Notion                      |
| `pnpm check:dist`      | Checks the build output in `dist/`                                  |
| `pnpm smoke:worker`    | Starts the Worker under workerd and checks its responses            |
| `pnpm lighthouse`      | Runs Lighthouse CI against the last build in `dist/`                |
| `pnpm record:fixtures` | Records sanitized fixtures from the live workspace                  |
| `pnpm brand`           | Regenerates the logo, favicons, and app icons from `brand/horse.ts` |

### Environment variables

These variables change how the commands run:

| Variable                  | Effect                                                        |
| ------------------------- | ------------------------------------------------------------- |
| `NOTION_TOKEN`            | Notion integration token, required for live builds            |
| `NOTION_FIXTURES=1`       | Reads the recorded fixtures instead of the Notion API         |
| `NOTION_FULL_REFRESH=1`   | Ignores the page cache and rebuilds every page                |
| `NOTION_INCLUDE_DRAFTS=1` | Includes Draft posts; the `dev` script sets it                |
| `NOTION_SKIP_SYNC=1`      | Skips the Notion sync; the `check` script sets it             |
| `E2E_PORT`                | Port of the end-to-end and Lighthouse server (default `4322`) |
| `WORKER_SMOKE_PORT`       | Port of `pnpm smoke:worker` (default `8787`)                  |

Put only `NOTION_TOKEN` in `.env`, because a flag set there applies to every build. Set the others per command: `pnpm build:fixtures` sets `NOTION_FIXTURES`, and `NOTION_FULL_REFRESH=1 pnpm build` runs a full refresh. `pnpm build` refuses to run while `NOTION_SKIP_SYNC` or `NOTION_INCLUDE_DRAFTS` is set.

## Writing content

Every post needs a unique `Slug` (lowercase letters, digits, and hyphens) and a `Status`:

- **Draft**, or an empty status: appears only in `pnpm dev`, marked DRAFT.
- **Published**: appears on the site and in lists.
- **Unlisted**: gets its own page, but stays out of lists, search, the feed, and the sitemap, and is marked `noindex`.

Published and Unlisted posts also need a `Published` date. A post's `Language` (`en` or `zh`; `en` when empty) sets the language of its text.

Giscus finds a post's discussion by its `Slug`, so if a post's slug changes, the post no longer shows its earlier comments.

Start a page's headings at Heading 1, and don't skip levels. The page title is the `<h1>`, and Heading 1 to 4 in Notion become `<h2>` to `<h5>`, so a page that starts at Heading 2 jumps from `<h1>` to `<h3>`. The Lighthouse `heading-order` audit fails such a page, and `pnpm lighthouse` accepts no accessibility score under 1.

Each tag that a Published post uses gets a page at `/blog/tags/<tag>`. Tags that differ only in letter case or spacing share one page. If a tag loses characters on the way into its address, such as `C++` or `C#`, the address ends in a short hash (`/blog/tags/c-4c21a3`), so different tags never share a page. Very long tags get a shortened address. Tags never stop the build.

A visible project needs a `Description`. If its page has content, it also needs a `Slug`. To list a project on the home page, select `Featured`.

In the profile, `GitHub` and `X` take a handle, `@handle`, or a full URL.

The home page's masthead comes from the root page, `mastheadPageId` in `site.config.ts`. The root page's title becomes the banner, and its first line of text becomes the slogan. That line is the first heading (Heading 1 to 4), paragraph, quote, or callout with any text, shown as plain text on one line. The root page never stops the build. If the build can't read it, the build warns, and the home page shows the profile's `Name` with no slogan. An untitled root page also shows the `Name`.

To find the slogan, the build reads every block on the root page's first level. `pnpm record:fixtures` therefore records that whole level in `tests/fixtures/notion/`: the titles of the pages under the root page, its links, and its text, not only the slogan. Review the recorded `listBlockChildren` file of the root page before you commit it.

An inline database shows the columns and row order of its first table view. To pick the columns and sort order yourself, or to show a column as star ratings, add an entry for its block ID to `databaseDisplay` in `site.config.ts`.

Share images show the title in JetBrains Mono, with Noto Sans SC for Chinese; a post's share image adds its date and tags. The build drops emoji from the title and reports in the build log any character that neither font covers.

## Site configuration

Besides the Notion IDs, `site.config.ts` holds the site's name and URL, the Giscus repository and discussion category with their IDs, and the Cloudflare Web Analytics token, `analytics.cloudflareToken`.

The token is empty on purpose. The lil.horse site in Cloudflare Web Analytics uses automatic injection at the edge, set to exclude visitor data from the EU. A static page can't do that, because it can't tell where its visitor is. The CSP already allows the injected beacon.

If you set a token, turn off automatic injection in Cloudflare, or every visit is counted twice. With a token, the site adds the beacon itself, and a prerendered page loads it only after the page is shown. Fixture builds never include the beacon.

## History

This repository used to host a Next.js site based on [nextjs-notion-starter-kit](https://github.com/transitive-bullshit/nextjs-notion-starter-kit). The `archive/v1-nextjs` branch keeps that version.

## License

The code is released under the [MIT License](LICENSE). The banner font in `src/assets/fonts/` keeps its own license, the SIL Open Font License 1.1 (see [Banner font](#banner-font)).

The site's content is licensed under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). This covers the posts and other writing published on lil.horse, including the copies recorded in `tests/fixtures`. Third-party material on the site, such as link-preview images, keeps its own license.
