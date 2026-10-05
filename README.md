# lil.horse

Source of [lil.horse](https://lil.horse), the personal site and blog of Lil'Horse: a fully static Astro site built from content written in Notion.

## Stack

| Area                   | Tools                                                                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework              | [Astro](https://astro.build) 7, static output                                                                                                                                                   |
| Content                | The official Notion API (`@notionhq/client`), read by a custom loader                                                                                                                           |
| Rendering              | [sharp](https://sharp.pixelplumbing.com) (images), [KaTeX](https://katex.org) (math), [Expressive Code](https://expressive-code.com) (code blocks)                                              |
| Search, feed, comments | [Pagefind](https://pagefind.app), `@astrojs/rss`, [Giscus](https://giscus.app)                                                                                                                  |
| Generated images       | [Satori](https://github.com/vercel/satori) and resvg (share images); resvg and STIX Two Math (masthead banner)                                                                                  |
| Styles and fonts       | Plain CSS with cascade layers and `light-dark()`; JetBrains Mono and IBM Plex Sans from [Fontsource](https://fontsource.org), self-hosted through the Astro Fonts API                           |
| Hosting                | [Cloudflare Workers](https://developers.cloudflare.com/workers/static-assets/) static assets, deployed with [Wrangler](https://developers.cloudflare.com/workers/wrangler/) from GitHub Actions |
| Checks                 | Vitest, Playwright with axe-core, Lighthouse CI, ESLint, Prettier, html-validate                                                                                                                |

## How it works

1. **Content.** Posts, projects, and the profile are Notion databases; About, Contact, and the workspace's root page (the masthead) are pages. `site.config.ts` holds their IDs.
2. **Sync.** `src/notion/sync.ts` validates every row (an invalid one stops the build, naming the page and field) and turns each page's blocks into a serializable AST. `src/notion/` is a self-contained Notion reader behind the Astro adapter `src/notion/loaders.ts`; an ESLint rule bars it from importing site code, with one marked exception in `sync.ts`.
3. **Cache.** Page ASTs are cached in `.cache/` and reused while the page, its inline databases, and its media are unchanged; pages edited in the last two minutes are never cached. `NOTION_FULL_REFRESH=1` rebuilds every page.
4. **Media.** Images, files, covers, and bookmark previews are downloaded and served from `/_media`, never from Notion's expiring file URLs.
5. **Search.** Pagefind indexes the articles marked `data-pagefind-body` (Published posts, project pages, About, and Contact) into `dist/pagefind/`. The build stops if no page has the marker, since without it Pagefind indexes every page whole.
6. **Cloudflare files.** The build writes `dist/_redirects` and `dist/_headers`; see [Redirects and headers](#redirects-and-headers).
7. **Output check.** `pnpm check:dist` fails on:
   - expiring Notion URLs
   - broken internal links, including the share images in `og:image` and `twitter:image`
   - internal links ending in a slash or `.html`, which Cloudflare redirects
   - missing routes
   - JavaScript, CSS, or preloaded fonts over budget
   - invalid HTML
   - inline scripts whose hash the Content-Security-Policy (CSP) lacks, that only a second, plain count finds, or that sit inside `<svg>` or `<math>`
   - `'unsafe-inline'`, `'unsafe-eval'`, or `'strict-dynamic'` in the CSP's `script-src`
   - redirects that aren't `301`, lead to a missing page, or hide a built page
8. **Deploy.** GitHub Actions runs the same build and check, then `wrangler deploy`; see [Deployment](#deployment).

## Design

- **Themes.** Night (dark) and Mist (light). The header button cycles system, light, and dark, and the choice is stored in `localStorage` under `theme`.
- **Command palette.** ⌘K, Ctrl K, `/`, the `search` buttons in the header and on the 404 page, and the phone's `menu` button open it: search, navigation, the five latest posts, and actions. Without JavaScript, or if the palette fails to load, the `menu` button opens a plain `<details>` menu. From the `search` buttons, the keyboard shortcuts, and the help, a second failed load of the palette or the help reloads the page (most likely a deploy replaced the file), unless the browser is offline.
- **Shortcuts.** `?` opens the help, which lists the shortcuts (`g` then `h`, `b`, `p`, or `a`; `[` and `]`; `t`) and can turn single keys off. That choice is stored in `localStorage` under `shortcuts` (without storage, it lasts until you leave the page). Single keys do nothing while you type or a dialog is open; ⌘K and Ctrl K always work.
- **Comments.** Giscus loads within 600 px of the viewport, never on a page that's only prerendered, and follows the site's theme using the Night and Mist themes in `public/giscus/`, served from `/giscus/` on each host. `pnpm dev` shows Giscus's built-in themes, since its frame can't load a stylesheet over plain HTTP.
- **Colors.** Theme colors are tokens in `src/styles/tokens.css`; `tests/unit/tokens.test.ts` checks them and the contrast of text and background pairs in both themes. The Giscus themes, `src/og/template.ts`, and `BANNER_COLORS` in `src/lib/banner.ts` copy token values, and `tests/unit/giscus-themes.test.ts`, `tests/unit/og.test.ts`, and `tests/unit/banner.test.ts` fail when a copy drifts.
- **Styles.** `tokens.css`, `base.css`, and `prose.css` (Notion content) in `src/styles/` are global; components scope their own. The home card's motion (intro, strike, hover, shimmer) is in the global, unlayered `intro.css`, so the card's own styles stay under the 4 KB that Astro inlines instead of loading as another stylesheet. Code block colors are in `src/styles/code-themes.mjs`, read through `ec.config.mjs`.
- **Logo.** `pnpm brand` regenerates the SVGs in `src/assets/brand/` and the favicons, app icons, and web manifest in `public/` from `brand/horse.ts`. Commit them: `tests/unit/brand.test.ts` fails when they're stale.
- **Masthead.** `src/lib/banner.ts` rasterizes the [masthead](#writing-content) title in the [banner font](#banner-font) for the home page's `neofetch` card. The build warns about characters the font lacks and leaves them out; a title it can't draw at all shows as plain text.
- **Intro.** On the first home page view in a browser session, once the page is visible, the slogan types out at 35 ms a character, the stack items are struck through one by one, and the stack note (`stackNote` in `site.config.ts`) types out, with the cursor moving to its end (`sessionStorage` key `intro-played`; every view without storage). The card then looks exactly as without the intro. With a pointer that hovers, hovering a stack item lifts its strike. Reduced motion turns off the intro and the cursor blink, and makes the hover instant.

### Banner font

`src/assets/fonts/stix-two-math-subset.otf` is a subset of STIX Two Math 2.13 b171, from `fonts/static_otf/STIXTwoMath-Regular.otf` at the `v2.13b171` tag of [stipub/stixfonts](https://github.com/stipub/stixfonts), under the SIL Open Font License 1.1 (`OFL.txt` beside it). The build reads it to draw the banner and never serves it. To regenerate it with fontTools (`pip install fonttools`):

```bash
pyftsubset STIXTwoMath-Regular.otf \
  --unicodes='U+0020-007E,U+00A0-00FF,U+2010-2027,U+2032-2034,U+1D400-1D7FF' \
  --name-IDs='*' \
  --output-file=src/assets/fonts/stix-two-math-subset.otf
```

`--name-IDs='*'` keeps the copyright and license entries.

## Pages

| Route                                                   | Content                                                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `/`                                                     | The profile as `neofetch`, featured projects, latest posts                                |
| `/blog`                                                 | All posts by year                                                                         |
| `/blog/<slug>`                                          | A post                                                                                    |
| `/blog/tags/<tag>`                                      | The posts with a tag                                                                      |
| `/projects`                                             | All visible projects                                                                      |
| `/projects/<slug>`                                      | A project whose Notion page has content                                                   |
| `/about`, `/contact`                                    | About and Contact                                                                         |
| `/feed.xml`                                             | RSS 2.0 with the full text of the 20 latest Published posts                               |
| `/og/<type>/<slug>.png`                                 | 1200x630 share images for the home page, posts, project pages, About, and Contact         |
| `/sitemap-index.xml`, `/robots.txt`                     | The sitemap, without Unlisted posts, and the crawler rules                                |
| `/profile/README.md`                                    | The home page's card in Markdown, for the [GitHub profile README](#github-profile-readme) |
| `/brand/horse-night.svg`, `/brand/horse-chestnut.svg`   | The horses from `src/assets/brand/`, for the profile README                               |
| `/brand/masthead-dark.svg`, `/brand/masthead-light.svg` | The masthead banner in each theme, for the profile README                                 |

Every page links the feed and has Open Graph and Twitter Card tags for its share image (or the home page's); the home page, About, and posts also carry JSON-LD.

## Redirects and headers

`integrations/cloudflare.ts` writes two files that Cloudflare reads but never serves:

- `_redirects` (`src/lib/redirects.ts`) answers the old site's addresses with `301`: each post's and page's Notion ID, alone or after its slug (`/<id>`, `/<slug>-<id>`), the two posts that used to live at the root (`/helloworld`, `/douban`), and `/feed`. A final rule strips trailing slashes.
- `_headers` (`src/lib/headers.ts`) sets the CSP and other security headers on every path, marks `/_astro/`, `/_media/`, and the Pagefind index immutable for a year, and gives uploads in `/_media/` a sandboxing policy of their own.

The CSP (`src/lib/csp.ts`) has no `'unsafe-inline'` in `script-src`; it lists the hash of every inline script in `dist/` instead. Uploads in `/_media/` aren't scanned, so they never widen the policy. Never add or edit a hash by hand; change the script and rebuild. The CSP also allows Giscus (its script, its frame, and the `default.css` its `client.js` adds), the Cloudflare Web Analytics beacon, YouTube and Vimeo embeds, and WebAssembly for Pagefind, but no plugins (`object-src 'none'`).

`pnpm preview` ignores both files. `pnpm exec tsx scripts/serve-dist.ts 4323` serves `dist/` on port 4323 and applies them as Cloudflare does: other spellings of a path (`/%5Fmedia/…`, `//blog`, `/blog.html`) get a `307` to the canonical one, files no rule caches get `Cache-Control: public, max-age=0, must-revalidate`, and text, SVG, TrueType fonts, and icons are gzipped. The end-to-end tests and Lighthouse CI use this server.

## Deployment

`wrangler.jsonc` names the Worker `lil-horse`, serves `dist/` as static assets (`x.html` at `/x`, `404.html` for unknown paths), and runs the Worker script first only for `/hooks/*`. The asset layer answers every other request that matches a file, and every page navigation that matches none with `404.html`; any other unmatched request (a `fetch()`, a bot, a missing image) reaches the Worker, which passes it to the assets. Keep `workers_dev` and `preview_urls` set: both default to off once `routes` is set, and the webhook and pull request previews need them. The Worker answers at `https://lil-horse.lilhorse.workers.dev`, where every version, deployed or only uploaded, gets a preview URL; a `_headers` rule adds `X-Robots-Tag: noindex` on every workers.dev address.

`src/worker/hook.ts` handles `POST /hooks/notion` and answers `404` for other paths under `/hooks/`; the entry module, `src/worker/index.ts`, only re-exports its default handler, since the Workers runtime treats every export of it as an entrypoint. A Notion edit reaches the site like this:

1. Notion posts a webhook event. The Worker answers `413` to a body over 1 MiB and, before parsing the body, `401` unless `X-Notion-Signature` matches the HMAC-SHA256 of the raw body keyed by the verification token (`NOTION_WEBHOOK_SECRET`).
2. For the `page.*` and `data_source.*` events in `BUILD_EVENTS`, the Worker dispatches `deploy.yml` on `main` of this repository (`vars.GITHUB_REPOSITORY` in `wrangler.jsonc`) with `GITHUB_DISPATCH_TOKEN`. It answers `202` if GitHub accepts and `502` if not, so Notion retries; until `deploy.yml` exists on `main`, GitHub answers `404` and the Worker `502`. Other events, such as comments and page locks, get `200` and change nothing.
3. `.github/workflows/deploy.yml` builds from live Notion data, runs `pnpm check:dist`, deploys with `wrangler deploy`, and then syncs the [GitHub profile README](#github-profile-readme).

The workflow also runs on every push to `main`, by hand (from the Actions tab, or with `gh workflow run deploy.yml`, where `-f full_refresh=true` sets `NOTION_FULL_REFRESH=1`), and daily at 17:00 UTC with a full refresh through `.github/workflows/refresh.yml` on `main`. GitHub disables a scheduled workflow after 60 days without activity in a public repository; this stops only the daily refresh, not deploys from a push or from Notion. If it happens, re-enable Daily refresh in the Actions tab.

Only `main` deploys; a manual run on another branch skips both jobs. A newer run cancels one in progress, so a burst of edits deploys once. `.cache/` and Astro's data store in `node_modules/.astro` are restored from the last run that deployed.

To deploy from a laptop, run `pnpm build && pnpm check:dist && pnpm smoke:worker && pnpm exec wrangler deploy` after `pnpm exec wrangler login`. `pnpm smoke:worker` runs the Worker and the last build in `dist/` under workerd (`wrangler dev`) and checks the status codes of `GET /hooks/notion`, an unsigned `POST /hooks/notion`, `GET /hooks/other`, and `GET /`, never loading `.dev.vars` or `.env`, so no local secret reaches the Worker. Run it before deploying any Worker change; `wrangler deploy --dry-run` only bundles and can't tell whether the Worker starts.

### Notion webhook

The subscription belongs to the Notion integration, points at `https://lil-horse.lilhorse.workers.dev/hooks/notion`, and subscribes to the 12 events in `BUILD_EVENTS`; the Worker ignores any other. Notion can't change a verified subscription's URL, so it stays on workers.dev whatever domain serves the site.

Notion verifies a new subscription by posting a `verification_token`. While `NOTION_WEBHOOK_SECRET` isn't set, the Worker logs that token, answers `200`, and refuses every event with `401`; once the secret is set, it never logs a token. To connect a subscription:

1. Follow the logs with `pnpm exec wrangler tail lil-horse`, or in the Cloudflare dashboard under Workers & Pages → lil-horse → Observability.
2. Put `pbpaste | tr -d '\n' | pnpm exec wrangler secret put NOTION_WEBHOOK_SECRET` on a prompt without running it.
3. Create the subscription in Notion. Check the `cf-connecting-ip` and `user-agent` of the `Notion verification token: "…"` log line that arrives: while no secret is set, anyone can post a token.
4. Copy the token without its quotes, paste it into Notion to verify the subscription, run the prepared command, and clear the clipboard with `printf '' | pbcopy`.

To rotate the token, first delete the secret (`pnpm exec wrangler secret delete NOTION_WEBHOOK_SECRET`), since the token is logged only while no secret is set, then delete the subscription in Notion and connect a new one. Until the new secret is in place, every event is refused; the daily build picks up edits made meanwhile.

### Secrets

The deploy workflow and the `preview` job read the GitHub secrets; the Worker reads its own. Nothing secret is in the repository or in `wrangler.jsonc`.

| Where          | Secret                  | Scope                                                                                                                                                              |
| -------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub Actions | `NOTION_TOKEN`          | Read-only Notion integration token                                                                                                                                 |
| GitHub Actions | `CLOUDFLARE_API_TOKEN`  | Account-owned, with the Workers Editor role on this account: deploys, but can't create or delete Workers                                                           |
| GitHub Actions | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID                                                                                                                                              |
| GitHub Actions | `PROFILE_README_TOKEN`  | Fine-grained GitHub token for `lilhorse/lilhorse` only: "Contents: Read and write" plus the mandatory "Metadata: Read-only"; can change nothing in this repository |
| Worker         | `NOTION_WEBHOOK_SECRET` | Webhook subscription's verification token                                                                                                                          |
| Worker         | `GITHUB_DISPATCH_TOKEN` | Fine-grained GitHub token for this repository only: "Actions: Read and write" plus the mandatory "Metadata: Read-only"; can't push code                            |

Set secrets from the clipboard, so a value never appears on screen, in the shell history, or in a file: put the command on the prompt, copy the value where it's created, then run the command. Copying the command after the value replaces the value on the clipboard.

```bash
pbpaste | tr -d '\n' | gh secret set CLOUDFLARE_API_TOKEN --repo lilhorse/lil.horse
pbpaste | tr -d '\n' | pnpm exec wrangler secret put GITHUB_DISPATCH_TOKEN
printf '' | pbcopy
```

`tr -d '\n'` drops a trailing newline; the last line clears the clipboard. `wrangler secret put` needs `pnpm exec wrangler login` first and takes effect at once, since it deploys a new Worker version.

Cloudflare refuses to change a secret while the newest Worker version isn't the deployed one: after any pull request preview (`wrangler versions upload`) and after a rollback, until the next deployment. Deploy first (`gh workflow run deploy.yml`) and wait for the run; don't follow wrangler's suggestions to deploy the latest version or use `wrangler versions secret put`, which build on the newest version, not the deployed one.

`GITHUB_DISPATCH_TOKEN` doesn't expire, but GitHub revokes a personal access token unused for a year, and only Notion edits use this one. Once it's revoked, GitHub answers `401`, the Worker logs `GitHub dispatch answered 401` and answers `502`, and Notion edits stop starting builds (the daily build still publishes them). Create a new token with the same permissions, store it the same way, and check in the integration's Webhooks tab in Notion that the subscription is still active, since Notion inactivates one after repeated failed deliveries.

### GitHub profile README

`lilhorse/lilhorse` shows the home page's card as its README, which the build writes to `dist/profile/README.md` (`src/pages/profile/README.md.ts`, from `src/lib/profile-readme.ts`). Text from Notion has its Markdown and HTML escaped and stays on one line. The email row links to the contact page, so the address never appears there.

Its images load from lil.horse, each in a `<picture>` whose dark variant follows the visitor's GitHub theme: the horses (`/brand/horse-night.svg`, `/brand/horse-chestnut.svg`) and the banner (`/brand/masthead-dark.svg`, `/brand/masthead-light.svg`). The banner files are standalone SVGs at four screen pixels per bitmap pixel, with a glow margin of three bitmap pixels (12 screen pixels) and a slow shimmer across the letters that `prefers-reduced-motion` turns off. Their URLs carry `?v=` and a hash of the SVG, so GitHub fetches a changed banner at once. If the banner font can draw none of the title, the SVGs are empty and the README shows the title in bold. Keep both images in the one multi-line `<div>` block, each link outside its `<picture>` and each `<img>` a direct child of it; otherwise the browser ignores the dark `<source>`. GitHub's Markdown API renders this block differently from github.com, so check the live profile after changing it.

After a successful deploy, the `sync-profile` job takes `dist/profile/README.md` from the deploy job's artifact and runs `scripts/sync-profile-readme.ts` with plain Node (no installs), passing `PROFILE_README_TOKEN` as `GH_TOKEN` and `PROFILE_REPOSITORY` as `lilhorse/lilhorse`; the job's own `GITHUB_TOKEN` can only read this repository. The script compares the profile repository's `README.md` with the build and commits any difference as `chore: sync the profile card from lil.horse` (or creates the file); otherwise it prints `Profile README unchanged`. So the card follows Notion within a day, or at once after a Notion edit. Without a token, as in a fork or a local run, the script prints a notice and does nothing.

After a network error or a `5xx`, the script retries once, two seconds later. If GitHub still fails or refuses (for example, the token was revoked), only `sync-profile` fails, with GitHub's reason; the site is deployed and the cache saved. After fixing the cause (for a revoked token, a new one with the same permissions, stored as in [Secrets](#secrets)), start a new run with `gh workflow run deploy.yml`: re-running an old run redeploys its commit, and its artifact lasts only a day.

### Rollback

If a deployment is bad, run `pnpm exec wrangler rollback` after `pnpm exec wrangler login` to put the previous deployment's version back live, and revert the cause on `main` or in Notion: any later deployment, including the daily one, replaces the rollback.

If a build or `pnpm check:dist` fails, nothing is deployed and the previous deployment stays live. GitHub emails whoever started the run: the pusher, the owner of `GITHUB_DISPATCH_TOKEN` for a Notion edit, or, for the daily refresh, whoever created `refresh.yml` or last changed its schedule.

## Continuous integration

`.github/workflows/ci.yml` runs on pull requests, on pushes to `rebuild/**` branches, and by hand:

- `test`: `pnpm lint`, `pnpm check`, `pnpm format:check`, and `pnpm test`.
- `e2e`: a fixture build, `pnpm check:dist`, `wrangler deploy --dry-run` (bundles the Worker and validates `wrangler.jsonc`), `pnpm smoke:worker`, and `pnpm test:e2e`, in the Playwright Docker image that the Linux screenshot baselines share; on failure, `test-results/` is kept as the `e2e-results` artifact.
- `lighthouse`: a fixture build and `pnpm lighthouse` (Lighthouse CI, mobile emulation, three runs) on the home page, the blog list, a post, the projects list, and About. It fails if the median performance score is under 0.98 or any run scores under 1 for accessibility, best practices, or SEO, and keeps the reports as the `lighthouse-reports` artifact.
- `preview` (pull requests from this repository only): uploads a build from live Notion data as a Worker version with the alias `pr-<number>`. Its comment on the pull request links the version URL and `https://pr-<number>-lil-horse.lilhorse.workers.dev` and names the head commit and the built merge commit, whose hash the site footer shows. Each push updates that comment; the alias follows the latest push, and each version URL keeps its own build. Uploaded versions are never deployed and don't change what `wrangler rollback` returns to.

`.github/workflows/baselines.yml` regenerates the Linux screenshot baselines in the same image. Push the commit to test to a `baselines/<name>` branch (`git push origin HEAD:baselines/<name>`) or run the workflow by hand, download them with `gh run download <run-id> -n visual-baselines-linux -D tests/e2e/visual.spec.ts-snapshots`, commit the `-linux.png` files next to the `-darwin.png` ones, and delete the branch. When you upgrade `@playwright/test`, move the image tag in `ci.yml` and `baselines.yml` to match.

## Development

You need Node.js 24 (see `.nvmrc`) and pnpm 10.

```bash
pnpm install
cp .env.example .env # then set NOTION_TOKEN
pnpm dev
```

`NOTION_TOKEN` belongs to a Notion integration with read access to the three databases and the three pages (About, Contact, and the root page). Sharing the root page shares every page under it, so any edit there starts a deploy through the [Notion webhook](#notion-webhook). A linked database view also needs access to its source database, or the table is skipped with a warning. `.env` is git-ignored; never commit it.

`pnpm dev` and `pnpm build` load only `.env`, not `.env.local` or `.env.<mode>`. `pnpm dev` syncs with Notion only at startup, so restart it for new edits. For search, it serves the last build's `dist/pagefind/` if present; otherwise the palette says search isn't available.

`pnpm test:e2e` tests the last build in Chromium at desktop and phone sizes, with engine-specific checks in WebKit and Firefox (install the browsers once with `pnpm exec playwright install chromium webkit firefox`). It runs axe on every page, the open palette, and the shortcuts help in both themes. It also checks that no page scrolls sideways and that, on a phone, every link and button outside running text is at least 44x44 px. Third-party requests are stubbed, so it never loads Giscus or the analytics beacon. Set `E2E_PORT` to run several worktrees at once.

`tests/e2e/visual.spec.ts` compares the home page, the blog list, and a post, in both themes and sizes, with `tests/e2e/visual.spec.ts-snapshots/` (`-darwin` for a Mac, `-linux` for CI), only on a fixture build. After an intended visual change, refresh the Mac set with `pnpm build:fixtures && pnpm test:e2e tests/e2e/visual.spec.ts --update-snapshots` and the Linux set with the [baselines workflow](#continuous-integration).

`pnpm lighthouse` runs the CI Lighthouse checks on the last build, served on the end-to-end port, and writes reports to `test-results/lighthouse/`; it needs Chrome. `SCREENSHOTS=1 pnpm test:e2e tests/e2e/screenshots.spec.ts` saves full-page screenshots of every page, in both themes and sizes, to `test-results/screenshots/`.

| Command                | What it does                                                        |
| ---------------------- | ------------------------------------------------------------------- |
| `pnpm dev`             | Dev server, with Draft posts                                        |
| `pnpm build`           | Production build from live Notion data                              |
| `pnpm build:fixtures`  | Offline build from `tests/fixtures/notion`                          |
| `pnpm preview`         | Serves the last build, ignoring `_redirects` and `_headers`         |
| `pnpm test`            | Unit, DOM, and component tests                                      |
| `pnpm test:e2e`        | Playwright and axe against the last build in `dist/`                |
| `pnpm lint`            | ESLint                                                              |
| `pnpm format`          | Prettier, rewriting files                                           |
| `pnpm format:check`    | Prettier, checking only                                             |
| `pnpm check`           | Type-checks without syncing Notion                                  |
| `pnpm check:dist`      | Checks the build output in `dist/`                                  |
| `pnpm smoke:worker`    | Smoke-tests the Worker under workerd                                |
| `pnpm lighthouse`      | Lighthouse CI against the last build in `dist/`                     |
| `pnpm record:fixtures` | Records sanitized fixtures from the live workspace                  |
| `pnpm brand`           | Regenerates the logo, favicons, and app icons from `brand/horse.ts` |

| Variable                  | Effect                                                      |
| ------------------------- | ----------------------------------------------------------- |
| `NOTION_TOKEN`            | Notion integration token, required for live builds          |
| `NOTION_FIXTURES=1`       | Reads the recorded fixtures instead of the Notion API       |
| `NOTION_FULL_REFRESH=1`   | Ignores the page cache and rebuilds every page              |
| `NOTION_INCLUDE_DRAFTS=1` | Includes Draft posts; the `dev` script sets it              |
| `NOTION_SKIP_SYNC=1`      | Skips the Notion sync; the `check` script sets it           |
| `E2E_PORT`                | Port of the end-to-end and Lighthouse server (default 4322) |
| `WORKER_SMOKE_PORT`       | Port of `pnpm smoke:worker` (default 8787)                  |

Only `NOTION_TOKEN` belongs in `.env`, where a flag applies to every build. Set the others per command, as in `NOTION_FULL_REFRESH=1 pnpm build`; `pnpm build:fixtures` sets `NOTION_FIXTURES` itself. `pnpm build` refuses to run while `NOTION_SKIP_SYNC` or `NOTION_INCLUDE_DRAFTS` is set.

## Writing content

Every post needs a unique `Slug` (lowercase letters, digits, and hyphens) and a `Status`:

- **Draft**, or empty: only in `pnpm dev`, marked DRAFT.
- **Published**: on the site and in lists.
- **Unlisted**: its own page only, out of lists, search, the feed, and the sitemap, and marked `noindex`.

Published and Unlisted posts also need a `Published` date; `Language` is `en` or `zh` (empty means `en`). Giscus finds a post's comments by its `Slug`, so changing the slug loses them.

Start headings at Heading 1 and don't skip levels (the title is the `<h1>`; Heading 1 to 4 become `<h2>` to `<h5>`): Lighthouse's `heading-order` audit fails a skipped level, and `pnpm lighthouse` accepts no accessibility score under 1.

Each tag on a Published post gets `/blog/tags/<tag>`, shared by tags that differ only in letter case or spacing. A tag that loses characters in its address, such as `C++` or `C#`, gets a short hash (`/blog/tags/c-4c21a3`), so different tags never share a page; very long tags are shortened. Tags never stop the build.

A visible project needs a `Description`, and a `Slug` if its page has content; check `Featured` to list it on the home page. In the profile, `GitHub` and `X` take a handle, `@handle`, or a full URL.

The masthead comes from the root page (`mastheadPageId` in `site.config.ts`): its title is the banner, and its first heading (Heading 1 to 4), paragraph, quote, or callout with any text is the slogan, as plain text on one line. The root page never stops the build: if it can't be read, the home page shows the profile's `Name` and no slogan; if it's untitled, the `Name` and the slogan. The build warns in both cases.

`pnpm record:fixtures` records the root page's whole first level in `tests/fixtures/notion/` (child page titles, links, and text, not only the slogan); review its recorded `listBlockChildren` file before committing it.

An inline database shows its first table view's columns and row order; to pick columns and sort order, or show a column as star ratings, add an entry for its block ID to `databaseDisplay` in `site.config.ts`.

Share images set the title in JetBrains Mono (Noto Sans SC for Chinese), adding the date and tags for posts; emoji are dropped, and characters neither font covers are reported in the build log.

## Site configuration

Besides the Notion IDs, `site.config.ts` holds the site's name and URL, the Giscus repository and discussion category with their IDs, and the Cloudflare Web Analytics token, `analytics.cloudflareToken`. The token is empty on purpose: Cloudflare injects the beacon for lil.horse at the edge, excluding visitor data from the EU, which a static page can't do because it can't tell where its visitor is; the CSP allows the beacon. If you set a token, turn off that automatic injection, or every visit is counted twice; the site then adds the beacon itself, which counts EU visitors too, and a prerendered page loads it only once shown. Fixture builds never include it.

## History

This repository used to host a Next.js site based on [nextjs-notion-starter-kit](https://github.com/transitive-bullshit/nextjs-notion-starter-kit). The `archive/v1-nextjs` branch keeps that version.

## License

The code is released under the [MIT License](LICENSE). The banner font in `src/assets/fonts/` keeps its own license, the SIL Open Font License 1.1 (see [Banner font](#banner-font)).

The site's content is licensed under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). This covers the posts and other writing published on lil.horse, including the copies recorded in `tests/fixtures`. Third-party material on the site, such as link-preview images, keeps its own license.
