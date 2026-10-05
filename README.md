# lil.horse

Source code of [lil.horse](https://lil.horse), the personal site and blog of Lil'Horse.

Content is written in Notion. At build time, Astro reads it through the official Notion API and renders a fully static site.

## Stack

- [Astro](https://astro.build) 7 with static output
- The official Notion API (`@notionhq/client`), read by a custom content loader
- [sharp](https://sharp.pixelplumbing.com) for images, [KaTeX](https://katex.org) for math and [Expressive Code](https://expressive-code.com) for code blocks
- [Pagefind](https://pagefind.app) for search, [Satori](https://github.com/vercel/satori) with resvg for share images, resvg and STIX Two Math for the masthead banner, `@astrojs/rss` for the feed and [Giscus](https://giscus.app) for comments
- Plain CSS with cascade layers and `light-dark()`
- JetBrains Mono and IBM Plex Sans from [Fontsource](https://fontsource.org), self-hosted through Astro's Fonts API
- [Cloudflare Workers](https://developers.cloudflare.com/workers/static-assets/) static assets for hosting, deployed with [Wrangler](https://developers.cloudflare.com/workers/wrangler/) from GitHub Actions
- Vitest, Playwright with axe-core, Lighthouse CI, ESLint, Prettier and html-validate

## How it works

1. **Content.** Posts, projects and the profile live in three Notion databases. About and Contact are ordinary Notion pages, and the home page's masthead comes from the workspace's root page. Their IDs are in `site.config.ts`.
2. **Sync.** `src/notion/sync.ts` queries the databases, validates every row and turns each page's blocks into a serializable AST. If a row fails validation, the build stops, and the error names the page and the field. `src/notion/` is a self-contained Notion reader: `src/notion/loaders.ts` is the Astro adapter, and an ESLint rule keeps the rest of the folder from importing site code (`sync.ts` has one marked exception).
3. **Cache.** Each page's AST is cached in `.cache/`. The cached AST is reused while the page, its inline databases and its media stay unchanged. Notion reports edit times to the minute, so pages edited in the last two minutes are never cached. `NOTION_FULL_REFRESH=1` rebuilds every page.
4. **Media.** Images, files, covers and bookmark previews are downloaded during the build and served from `/_media`, so the site never links to Notion's expiring file URLs. Images are converted to AVIF and WebP at several widths.
5. **After the pages.** Once every page is built, Pagefind indexes the articles marked `data-pagefind-body` (Published posts, project pages, About and Contact) into one index for both languages, segmented as Chinese, in `dist/pagefind/`. The build stops if no page carries the marker, since Pagefind would then index every page whole. Only the files the palette loads are kept, not Pagefind's UI bundles. Then `dist/_redirects` and `dist/_headers` are written for Cloudflare, with a Content-Security-Policy that lists the hash of every inline script in the built pages.
6. **Output check.** `pnpm check:dist` scans `dist/` for:
   - expiring Notion URLs
   - broken internal links, including the share images named in `og:image` and `twitter:image`
   - internal links that end in a slash or in `.html`, which Cloudflare answers with a redirect
   - missing routes
   - JavaScript, CSS or preloaded fonts over budget
   - invalid HTML
   - inline scripts whose hash is missing from the CSP, that a second, plain count finds but the scan missed, or that sit inside `<svg>` or `<math>`
   - `'unsafe-inline'`, `'unsafe-eval'` or `'strict-dynamic'` in the CSP's `script-src`
   - redirects that are not 301, lead to a page that does not exist or hide a built page
7. **Deploy.** GitHub Actions runs the same build and output check, then `wrangler deploy` uploads `dist/` to Cloudflare Workers together with the small Worker that receives Notion's webhooks. See [Deployment](#deployment).

## Design

The site looks like a terminal. Each page has a tab bar, a prompt and a command such as `ls -lt ~/blog`, and the page content is the output of that command.

- **Themes.** Night is the dark theme, and Mist with highlighter colours is the light theme. The header button cycles system, light and dark, and a visually hidden status announces each choice to screen readers. The choice is stored in `localStorage` under `theme` and applied by an inline script in `<head>` before the first paint. Other open tabs follow a change at once, and a prerendered page or one restored from the back-forward cache applies it when shown. `<html>` carries `data-theme` (the resolved theme) and `data-theme-pref`, and the `theme-color` metas follow.
- **Command palette.** ⌘K, Ctrl+K, `/`, the `search` buttons in the header and on the 404 page, and the phone's `menu` button open a `<dialog>` with search, navigation, the five latest posts and actions: switch the theme, copy the email address, send an email, open the feed and show the keyboard shortcuts. Search loads Pagefind on the first query. It splits the query into words with `Intl.Segmenter`, the way the index was segmented, and retries the raw query when that finds nothing. Without JavaScript, or when the palette fails to load, the phone's `menu` button opens a plain `<details>` menu. Elsewhere, when the palette or the help fails to load a second time, most likely because a deploy replaced its file, the page reloads, unless the browser is offline.
- **Shortcuts.** `g` then `h`, `b`, `p` or `a` goes to home, the blog, projects or about. `[` and `]` open the older and newer post, or the previous and next project. `t` switches the theme, and `?` opens the help, where the single-key shortcuts can be switched off (stored in `localStorage` under `shortcuts`; without storage, the choice lasts until the page is left). Single keys do nothing while you type or while a dialog is open. ⌘K and Ctrl+K always work.
- **Page changes.** Cross-document view transitions keep the header in place, unless the visitor prefers reduced motion. Speculation Rules prerender a same-origin page when its link is hovered.
- **Comments.** Posts load Giscus when the comments section comes within 600 px of the viewport, never while the post is only prerendered, and switch its theme along with the site's. The Night and Mist themes for Giscus are in `public/giscus/`, and built pages load them from `/giscus/` on the host that serves the page, so lil.horse, workers.dev and version URLs each use their own copy. The Giscus frame cannot load a stylesheet from a plain-http server, so `pnpm dev` shows Giscus's built-in light and dark themes instead. The repository and category are set in `site.config.ts`.
- **Colours.** Every theme colour is a token in `src/styles/tokens.css`. `tests/unit/tokens.test.ts` checks each token and the contrast of the text and background pairs the site uses, in both themes. The Giscus themes, the share-image template in `src/og/template.ts` and the standalone banners in `src/lib/banner.ts` cannot use the tokens, so they copy their values. `tests/unit/giscus-themes.test.ts`, `tests/unit/og.test.ts` and `tests/unit/banner.test.ts` fail when a copied value is not in the theme.
- **Styles.** `tokens.css`, `base.css` and `prose.css` (Notion content) in `src/styles/` are global. Components keep their own scoped styles. Code block colours are in `src/styles/code-themes.mjs`, and Expressive Code reads them through `ec.config.mjs`.
- **Logo.** The pixel horse with sunglasses is drawn in `brand/horse.ts`: a 24 × 24 grid for the home page and a 16 × 16 grid for the favicon and the header. `pnpm brand` regenerates the SVGs in `src/assets/brand/` and the favicons, app icons and web manifest in `public/`. The generated files are committed, and `tests/unit/brand.test.ts` fails when they are out of date.
- **Masthead.** The `neofetch` card on the home page opens with the root page's title as a pixel banner and its slogan below (see [Writing content](#writing-content)). At build time, `src/lib/banner.ts` renders the title with resvg at 16 px in the [banner font](#banner-font), the only font it loads, keeps the pixels whose alpha is at least 128 and crops them to the ink; today's title gives 72 × 14 pixels. The page draws that bitmap as an inline SVG, one rectangle per run of lit pixels in a row, filled with a gradient through the card's six swatch colours, at a whole number of screen pixels per pixel, close to 300 px wide. The banner's accessible name is the title in plain letters (Unicode NFKC, so `𝕷𝖎𝖑’𝕳𝖔𝖗𝖘𝖊` reads `Lil’Horse`). The [GitHub profile README](#github-profile-readme) shows the same bitmap as an image. The build warns about a character the font lacks and leaves it out; a title with nothing the font can draw shows as plain text.
- **Slogan.** On the first view of the home page in a browser session, the slogan types out at 35 ms a character. A copy hidden from screen readers does the typing over the slogan, which stays in the page, invisible: the card keeps its size, the cursor moves with a transform so the typing causes no layout shift, and screen readers, crawlers and visitors without JavaScript get the whole text. `sessionStorage` remembers under `slogan-typed` that it has run; without storage, it runs on every view. It never runs, and the cursor never blinks, for visitors who prefer reduced motion.
- **Accessibility.** `pnpm test:e2e` runs axe on every built page in both themes, at desktop and phone sizes, and on the open command palette and shortcuts help. It also checks that no page scrolls sideways and that, on a phone, every link and button outside running text is at least 44 × 44 px.

### Banner font

`src/assets/fonts/stix-two-math-subset.otf` is a subset of STIX Two Math 2.13 b171, from `fonts/static_otf/STIXTwoMath-Regular.otf` at the `v2.13b171` tag of [stipub/stixfonts](https://github.com/stipub/stixfonts). It is licensed under the SIL Open Font License 1.1, whose text is beside it in `OFL.txt`. The build reads it to draw the banner and never serves it. It keeps Basic Latin, Latin-1, the general punctuation from U+2010 to U+2027 (with `’`) and from U+2032 to U+2034, and the Mathematical Alphanumeric Symbols, the styled letters such as `𝕷` that a Notion title can use. To make it again, with fontTools (`pip install fonttools`):

```bash
pyftsubset STIXTwoMath-Regular.otf \
  --unicodes='U+0020-007E,U+00A0-00FF,U+2010-2027,U+2032-2034,U+1D400-1D7FF' \
  --name-IDs='*' \
  --output-file=src/assets/fonts/stix-two-math-subset.otf
```

`--name-IDs='*'` keeps the copyright and license entries in the font's name table.

## Pages

| Route                                                   | Content                                                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `/`                                                     | The profile as `neofetch`, featured projects and latest posts                             |
| `/blog`                                                 | All posts, grouped by year                                                                |
| `/blog/<slug>`                                          | A post                                                                                    |
| `/blog/tags/<tag>`                                      | The posts with a tag                                                                      |
| `/projects`                                             | All visible projects                                                                      |
| `/projects/<slug>`                                      | A project whose Notion page has content                                                   |
| `/about`, `/contact`                                    | The About and Contact pages                                                               |
| `/feed.xml`                                             | RSS 2.0 with the full text of the 20 latest Published posts                               |
| `/og/<type>/<slug>.png`                                 | 1200 × 630 share images for the home page, posts, project pages, About and Contact        |
| `/sitemap-index.xml`, `/robots.txt`                     | The sitemap and the crawler rules; Unlisted posts stay out of the sitemap                 |
| `/profile/README.md`                                    | The home page's card in Markdown, for the [GitHub profile README](#github-profile-readme) |
| `/brand/horse-night.svg`, `/brand/horse-chestnut.svg`   | The 24 × 24 horses from `src/assets/brand/`, which the profile README shows               |
| `/brand/masthead-dark.svg`, `/brand/masthead-light.svg` | The masthead banner as a file of its own in each theme, for the profile README            |

Every page's `<head>` has Open Graph and Twitter Card tags that point to its share image (pages without one of their own use the home page's) and a link to the feed. The home page, About and posts also carry JSON-LD structured data.

## Redirects and headers

At the end of the build, `integrations/cloudflare.ts` writes two files that Cloudflare reads but never serves:

- `_redirects`, built in `src/lib/redirects.ts`, sends the old site's addresses to the new ones with 301: each post's and page's Notion ID, alone or after its slug (`/<id>`, `/<slug>-<id>`), the two posts that used to live at the root (`/helloworld`, `/douban`) and `/feed`. A final rule strips trailing slashes.
- `_headers`, built in `src/lib/headers.ts`, sets the Content-Security-Policy and the other security headers for every path. It marks `/_astro/`, `/_media/` and the Pagefind index as immutable for a year, and puts uploaded files in `/_media/` under a sandboxing policy of their own.

The Content-Security-Policy, built in `src/lib/csp.ts`, has no `'unsafe-inline'` in `script-src`. Instead, the build scans `dist/` and lists the hash of every inline script the pages run, hashing the text as browsers do (line ends become `\n`). Uploaded files in `/_media/` are not scanned, so a script in an upload never widens the site's policy. Never add or edit a hash by hand; change the script and rebuild. `pnpm check:dist` fails if a page has an inline script whose hash is missing. Beyond the site itself, the policy allows Giscus (its script, its frame and the `default.css` that its `client.js` adds to the page), the Cloudflare Web Analytics beacon, YouTube and Vimeo embeds, and WebAssembly for Pagefind. It allows no plugins (`object-src 'none'`).

`pnpm preview` ignores both files. To try them locally, run `pnpm exec tsx scripts/serve-dist.ts 4323`, which serves `dist/` on port 4323 and applies the redirects and headers as Cloudflare would. Like Cloudflare, it sends any other spelling of a path, such as `/%5Fmedia/…`, `//blog` or `/blog.html`, to the canonical one with a 307, and gives files that no rule caches `Cache-Control: public, max-age=0, must-revalidate`. It also gzips the responses Cloudflare compresses (text, SVG, TrueType fonts and icons), so Lighthouse times the bytes a visitor downloads. The end-to-end tests and Lighthouse CI use the same server.

## Deployment

Cloudflare Workers serves the site as static assets. `wrangler.jsonc` names the Worker `lil-horse`, points its assets at `dist/`, serves `x.html` at `/x`, answers unknown paths with `404.html` and runs the Worker script only for `/hooks/*`. The Worker answers at `https://lil-horse.lilhorse.workers.dev`, and every version, deployed or only uploaded, gets a preview URL of its own on workers.dev. `wrangler.jsonc` sets `workers_dev` and `preview_urls` explicitly: both default to off once `routes` is set, and the Notion webhook and pull request previews depend on them. A `_headers` rule adds `X-Robots-Tag: noindex` to responses from every workers.dev address, which keeps those addresses out of search engines.

The Worker is in `src/worker/hook.ts`. It handles `POST /hooks/notion`, answers 404 for any other path under `/hooks/` and passes everything else to the static assets. The entry module, `src/worker/index.ts`, only re-exports its default handler, because the Workers runtime treats every export of the entry module as an entrypoint. An edit in Notion reaches the site like this:

1. Notion sends a webhook event. The Worker refuses a body over 1 MiB with 413. Before it parses the body, it checks `X-Notion-Signature`, the HMAC-SHA256 of the raw body keyed by the subscription's verification token (`NOTION_WEBHOOK_SECRET`), and answers 401 if it does not match.
2. For events that can change the site, the `page.*` and `data_source.*` events listed in `BUILD_EVENTS`, the Worker starts `deploy.yml` on `main` with a workflow dispatch on this repository (`vars.GITHUB_REPOSITORY` in `wrangler.jsonc`), using `GITHUB_DISPATCH_TOKEN`. The Worker answers 202 when GitHub accepts the dispatch and 502 when GitHub does not, so Notion retries. GitHub accepts the dispatch only once `deploy.yml` exists on `main`; before that, it answers 404, and the Worker answers 502. Other events, such as comments and page locks, get 200 and change nothing.
3. `.github/workflows/deploy.yml` builds from live Notion data, runs `pnpm check:dist`, deploys with `wrangler deploy` and syncs the [GitHub profile README](#github-profile-readme).

The deploy workflow also runs on every push to `main`, and by hand from the Actions tab or with `gh workflow run deploy.yml` (add `-f full_refresh=true` for a full refresh, which sets `NOTION_FULL_REFRESH=1`). Every day at 17:00 UTC, `.github/workflows/refresh.yml` runs it on `main` as a reusable workflow, with a full refresh. The schedule has a workflow of its own because GitHub disables a workflow with a schedule after 60 days without activity in a public repository: that rule can stop only the daily refresh, never the deploys from a push or from Notion. If it does, enable the Daily refresh workflow again from the Actions tab. The deploy workflow deploys only `main`: a run started by hand on another branch skips the job. A newer run cancels one still in progress, so a burst of edits deploys once. The `.cache/` page cache and Astro's data store in `node_modules/.astro` are restored from the last successful run.

To deploy from a laptop, run `pnpm build && pnpm check:dist && pnpm smoke:worker && pnpm exec wrangler deploy` after `pnpm exec wrangler login`.

`pnpm smoke:worker` uses `wrangler dev` to start the Worker and the last build in `dist/` under workerd, the runtime Cloudflare runs. It then checks the status codes of `GET /hooks/notion`, an unsigned `POST /hooks/notion`, `GET /hooks/other` and `GET /`. It never loads `.dev.vars` or `.env`, so no local secret reaches the Worker, and it listens on port 8787 unless `WORKER_SMOKE_PORT` names another. It should pass before any deploy that changes the Worker: `wrangler deploy --dry-run` only bundles the Worker and never starts the runtime, so it cannot tell whether the Worker starts.

### Notion webhook

The webhook subscription belongs to the Notion integration. It points at `https://lil-horse.lilhorse.workers.dev/hooks/notion` and subscribes to the twelve events in `BUILD_EVENTS`; the Worker ignores any other. Notion cannot change the URL of a verified subscription, so the subscription stays on workers.dev whatever domain serves the site.

Notion verifies a new subscription by posting a `verification_token`. While `NOTION_WEBHOOK_SECRET` is not set, the Worker writes that token to its logs and answers 200, and it refuses every event with 401. To connect a subscription:

1. Follow the Worker's logs with `pnpm exec wrangler tail lil-horse`, or open Workers & Pages → lil-horse → Observability in the Cloudflare dashboard.
2. Create the subscription in Notion. Take the log line `Notion verification token: "…"` that arrives as you do; its `cf-connecting-ip` and `user-agent` help tell Notion's request from anyone else's, since anyone can post a token while no secret is set. Copy the token without its quotes and paste it into Notion to verify the subscription.
3. With the token still on the clipboard, store it as the Worker secret: `pbpaste | tr -d '\n' | pnpm exec wrangler secret put NOTION_WEBHOOK_SECRET`, then `printf '' | pbcopy` (see [Secrets](#secrets)). From then on, the Worker never logs a token.

To rotate the token, first delete the secret with `pnpm exec wrangler secret delete NOTION_WEBHOOK_SECRET`, because the Worker logs a token only while no secret is set. Then delete the subscription in Notion, create it again and follow the three steps. Until the new secret is in place, the Worker refuses every event; the daily build picks up any edits made in the meantime.

### Secrets

The deploy workflow and the `preview` job read the GitHub secrets, and the Worker reads its own:

| Where          | Secret                  | Scope                                                                                                                                                                     |
| -------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Actions | `NOTION_TOKEN`          | The read-only Notion integration token                                                                                                                                    |
| GitHub Actions | `CLOUDFLARE_API_TOKEN`  | Account-owned Cloudflare API token with the Workers Editor role on this account, which deploys but cannot create or delete Workers                                        |
| GitHub Actions | `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account ID                                                                                                                                                 |
| GitHub Actions | `PROFILE_README_TOKEN`  | Fine-grained GitHub token for `lilhorse/lilhorse` only, with "Contents: Read and write" and the mandatory "Metadata: Read-only"; it can change nothing in this repository |
| Worker         | `NOTION_WEBHOOK_SECRET` | The webhook subscription's verification token                                                                                                                             |
| Worker         | `GITHUB_DISPATCH_TOKEN` | Fine-grained GitHub token for this repository only, with "Actions: Read and write" and the mandatory "Metadata: Read-only"; it cannot push code                           |

Nothing secret is in the repository or in `wrangler.jsonc`.

Set secrets from the clipboard, so a value never appears on screen, in the shell history or in a file. Put the command on the prompt first, then copy the value where it is created, then run the command: copying the command after the value would replace the value on the clipboard. As here for a GitHub secret and a Worker secret:

```bash
pbpaste | tr -d '\n' | gh secret set CLOUDFLARE_API_TOKEN --repo lilhorse/lil.horse
pbpaste | tr -d '\n' | pnpm exec wrangler secret put GITHUB_DISPATCH_TOKEN
printf '' | pbcopy
```

`tr -d '\n'` drops a trailing newline, and the last command clears the clipboard. `wrangler secret put` needs `pnpm exec wrangler login` first and takes effect at once, because it deploys a new version of the Worker.

Cloudflare refuses to change a secret while the Worker's newest version is not the deployed one. That is the case after every pull request preview, which runs `wrangler versions upload`, and after a rollback, until the next deployment. Deploy first (`gh workflow run deploy.yml`) and wait for the run to finish. Do not follow wrangler's suggestions to deploy the latest version or to use `wrangler versions secret put`: both build on the newest version, not on the deployed one.

`GITHUB_DISPATCH_TOKEN` does not expire, but GitHub revokes a personal access token that has not been used for a year, and the Worker uses this one only when an edit in Notion starts a build. Once the token is revoked, GitHub answers 401, the Worker logs `GitHub dispatch answered 401` and answers 502, and edits in Notion stop starting builds; the daily build still publishes them. Create a new token with the same permissions and store it the same way. Notion inactivates a subscription after repeated failed deliveries, so after storing the new token, check in the Webhooks tab of the integration's settings in Notion that the subscription is still active.

### GitHub profile README

The GitHub profile repository, `lilhorse/lilhorse`, shows the home page's card as its README. The build writes it to `dist/profile/README.md` (`src/pages/profile/README.md.ts`, from `src/lib/profile-readme.ts`): the horse, the masthead banner, the slogan, the profile's rows, the swatches and the bio. Text from Notion has its Markdown and HTML escaped and stays on one line. The email row links to the contact page, so the address itself never appears in the README.

The README shows two images from lil.horse, each in a `<picture>` whose dark variant follows the visitor's GitHub theme:

- The horses, `/brand/horse-night.svg` and `/brand/horse-chestnut.svg`, which the build serves from the same files in `src/assets/brand/` as the home page.
- The banner, `/brand/masthead-dark.svg` and `/brand/masthead-light.svg`. The build draws them from the same bitmap as the home page's banner, as SVG files of their own: the theme's six swatch colours as a gradient and its glow as an SVG filter, inside the file, four screen pixels to a bitmap pixel, with three pixels of margin for the glow. Their colours are copies of the theme tokens, kept in `BANNER_COLORS` in `src/lib/banner.ts`; `tests/unit/banner.test.ts` fails when they differ from `tokens.css`. The image's `alt` is the title in plain letters. For a title the banner font can draw none of, the files hold an empty image and the README shows the title as bold text instead.

Each image's link to lil.horse sits inside its `<picture>`, around the `<img>`. GitHub wraps every image whose parent is not a link in a link of its own; nested in an outer link, that link would split the `<picture>` and lose the dark variant.

After `wrangler deploy`, the deploy workflow runs `scripts/sync-profile-readme.ts` with `PROFILE_README_TOKEN` as `GH_TOKEN` and `PROFILE_REPOSITORY` set to `lilhorse/lilhorse`. Through GitHub's contents API, it compares the profile repository's `README.md` with the build and, when they differ, commits the build's version as `chore: sync the profile card from lil.horse` (or creates the file); otherwise it prints `Profile README unchanged`. The daily refresh runs the same workflow with the same secrets, so the card follows Notion within a day, and at once when an edit in Notion starts a deploy. Without a token, as in a fork or a local run, the script prints a notice and does nothing. When GitHub refuses, for example because the token was revoked, the step fails with GitHub's reason after the site is already deployed; create a new token with the same permissions and store it as above.

### Rollback

If a deployment is bad, run `pnpm exec wrangler rollback` after `pnpm exec wrangler login`. It puts the version of the previous deployment back live. Any later deployment, including the daily one, replaces it, so also revert the cause on `main` or in Notion. If a build or `pnpm check:dist` fails, nothing is deployed: the previous deployment stays live, and GitHub emails whoever started the failed run. That is the pusher for a push, the owner of `GITHUB_DISPATCH_TOKEN` for an edit in Notion, and for the daily refresh the person who created `refresh.yml` or last changed its schedule.

## Continuous integration

`.github/workflows/ci.yml` runs on pull requests, on pushes to `rebuild/**` branches and by hand:

- `test`: `pnpm lint`, `pnpm check`, `pnpm format:check` and `pnpm test`.
- `e2e`: a fixture build, `pnpm check:dist`, `wrangler deploy --dry-run` (bundles the Worker and validates `wrangler.jsonc` without deploying), `pnpm smoke:worker` (starts the Worker under workerd) and `pnpm test:e2e`, in the Playwright Docker image, so the Linux screenshot baselines come from the same fonts and browsers. When it fails, `test-results/` is kept as the `e2e-results` artifact.
- `lighthouse`: a fixture build and `pnpm lighthouse`, which runs Lighthouse CI (mobile emulation, three runs) on the home page, the blog list, a post, the projects list and About, and fails when the median performance score is under 0.98 or any run scores under 1 for accessibility, best practices or SEO. The reports are kept as the `lighthouse-reports` artifact.
- `preview`: for pull requests from this repository only, a build from live Notion data is uploaded as a Worker version with the alias `pr-<number>`, and a comment on the pull request links the version URL and `https://pr-<number>-lil-horse.lilhorse.workers.dev`. The comment names the pull request's head commit and the merge commit that was built, whose hash the site footer shows. Each push updates the same comment: the alias follows the latest push, and the version URL keeps showing its own build. Uploaded versions are never deployed and do not change what `wrangler rollback` returns to.

`.github/workflows/baselines.yml` regenerates the Linux screenshot baselines in the same image. Push the commit to test to a `baselines/<name>` branch (`git push origin HEAD:baselines/<name>`), or run the workflow by hand from the Actions tab. Then download the `visual-baselines-linux` artifact with `gh run download <run-id> -n visual-baselines-linux -D tests/e2e/visual.spec.ts-snapshots`, commit the `-linux.png` files next to the `-darwin.png` ones and delete the branch. When you upgrade `@playwright/test`, move the image tag in `ci.yml` and `baselines.yml` to the same version.

## Development

You need Node.js 24 (see `.nvmrc`) and pnpm 10.

```bash
pnpm install
cp .env.example .env # then set NOTION_TOKEN
pnpm dev
```

`NOTION_TOKEN` is the token of a Notion integration. The integration needs read access to the three databases and the three pages (About, Contact and the root page). If a page contains a linked view of a database, the integration also needs access to the view's source database; otherwise the table is skipped with a warning. `.env` is git-ignored. Never commit it.

`pnpm dev` and `pnpm build` load `.env` only, not `.env.local` or `.env.<mode>`. `pnpm dev` syncs with Notion once, when it starts. Restart it to pick up edits made in Notion.

`pnpm dev` has no search index of its own. If `dist/pagefind/` exists when it starts, it serves that index from the last build; otherwise the palette says search is not available.

`pnpm test:e2e` tests the last build in Chromium, at desktop and phone sizes, and runs the engine-specific checks in WebKit and Firefox too. Install the browsers once with `pnpm exec playwright install chromium webkit firefox`. The test server uses port 4322; set `E2E_PORT` to use another, for example to run several worktrees at once. End-to-end tests stub third-party requests, so they never load Giscus or the analytics beacon from the network.

`tests/e2e/visual.spec.ts` compares the home page, the blog list and a post, in both themes and at both sizes, with the screenshots in `tests/e2e/visual.spec.ts-snapshots/`. There is one set of baselines per platform: `-darwin` for a Mac and `-linux` for CI. The comparison runs only when `dist/` is a fixture build. After an intended visual change, refresh the Mac set with `pnpm build:fixtures && pnpm test:e2e tests/e2e/visual.spec.ts --update-snapshots` and the Linux set with the baselines workflow (see [Continuous integration](#continuous-integration)).

`pnpm lighthouse` runs the same Lighthouse checks as CI against the last build, served on the end-to-end port, and writes the reports to `test-results/lighthouse/`. It needs Chrome.

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
| `pnpm smoke:worker`    | Starts the Worker under workerd and checks how it answers          |
| `pnpm lighthouse`      | Runs Lighthouse CI against the last build in `dist/`               |
| `pnpm record:fixtures` | Records sanitized fixtures from the live workspace                 |
| `pnpm brand`           | Regenerates the logo, favicons and app icons from `brand/horse.ts` |

| Variable                  | Effect                                                      |
| ------------------------- | ----------------------------------------------------------- |
| `NOTION_TOKEN`            | Notion integration token, required for live builds          |
| `NOTION_FIXTURES=1`       | Reads the recorded fixtures instead of the Notion API       |
| `NOTION_FULL_REFRESH=1`   | Ignores the page cache and rebuilds every page              |
| `NOTION_INCLUDE_DRAFTS=1` | Includes Draft posts; the `dev` script sets it              |
| `NOTION_SKIP_SYNC=1`      | Skips the Notion sync; the `check` script sets it           |
| `E2E_PORT`                | Port of the end-to-end and Lighthouse server (default 4322) |
| `WORKER_SMOKE_PORT`       | Port of `pnpm smoke:worker` (default 8787)                  |

Only `NOTION_TOKEN` belongs in `.env`; a flag set there would apply to every build. Set the others per command: `pnpm build:fixtures` sets `NOTION_FIXTURES`, and `NOTION_FULL_REFRESH=1 pnpm build` runs a full refresh. `pnpm build` refuses to run while `NOTION_SKIP_SYNC` or `NOTION_INCLUDE_DRAFTS` is set.

## Writing content

Every post needs a unique `Slug` (lowercase letters, digits and hyphens) and a `Status`:

- **Draft**, or an empty status: appears only in `pnpm dev`, marked DRAFT.
- **Published**: appears on the site and in lists.
- **Unlisted**: gets its own page, but stays out of lists, search, the feed and the sitemap, and is marked `noindex`.

Published and Unlisted posts also need a `Published` date. A post's `Language` (`en` or `zh`; `en` when empty) sets the language of its text.

Giscus finds a post's discussion by its `Slug`, so a post whose slug changes no longer shows its earlier comments.

Start a page's headings at Heading 1 and do not skip levels. The page title is the `<h1>`, and Notion's Heading 1 to 4 become `<h2>` to `<h5>`, so a page that starts at Heading 2 jumps from `<h1>` to `<h3>`. Lighthouse's `heading-order` audit fails such a page, and `pnpm lighthouse` accepts no accessibility score under 1.

Each tag used by a Published post gets a page at `/blog/tags/<tag>`. Tags that differ only in letter case or spacing share one page. When a tag loses characters on the way into its address, such as `C++` or `C#`, the address ends in a short hash (`/blog/tags/c-4c21a3`), so different tags never share a page. Very long tags get a shortened address. Tags never stop the build.

A visible project needs a `Description`. If its page has content, it also needs a `Slug`. Check `Featured` to list a project on the home page.

In the profile, `GitHub` and `X` take a handle, `@handle` or a full URL.

The masthead of the home page comes from the root page, `mastheadPageId` in `site.config.ts`. Its title becomes the banner, and its first line of text becomes the slogan: the first heading, paragraph, quote or callout with any text, as plain text on one line. The root page never stops the build. If it cannot be read, the build warns and the home page shows the profile's `Name` with no slogan; an untitled root page also shows the `Name`.

An inline database shows the columns and row order of its first table view. To pick the columns and sort order yourself, or to show a column as star ratings, add an entry for its block ID to `databaseDisplay` in `site.config.ts`.

Share images show the title in JetBrains Mono, with Noto Sans SC for Chinese; a post's image adds its date and tags. Emoji are dropped from the title, and a character that neither font covers is reported in the build log.

## Site configuration

Besides the Notion IDs, `site.config.ts` holds the site's name and URL, the Giscus repository and discussion category with their IDs, and the Cloudflare Web Analytics token, `analytics.cloudflareToken`.

The token is empty on purpose. The lil.horse site in Cloudflare Web Analytics uses automatic injection at the edge, set to exclude visitor data from the EU; a static page cannot do that, because it cannot tell where its visitor is. The CSP already allows the injected beacon. If you set a token, the site adds the beacon itself, and a prerendered page loads it only once it is shown. In that case, turn off automatic injection in Cloudflare, or every visit is counted twice. Fixture builds never include the beacon.

## History

This repository used to host a Next.js site based on [nextjs-notion-starter-kit](https://github.com/transitive-bullshit/nextjs-notion-starter-kit). That version is kept on the `archive/v1-nextjs` branch.

## License

The code is released under the [MIT License](LICENSE). The banner font in `src/assets/fonts/` keeps its own license, the SIL Open Font License 1.1 (see [Banner font](#banner-font)).

The site's content is licensed under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). This covers the posts and other writing published on lil.horse, including the copies recorded in `tests/fixtures`. Third-party material on the site, such as link-preview images, keeps its own license.
