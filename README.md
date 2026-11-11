# Redirects: CMS UI extension

An Optimizely CMS (SaaS) UI extension, built as a CMS-scoped OCP app. It manages the CMS-driven redirects of `optimizely-nextjs-demo` from inside the editor, and checks them against what the site actually does.

## How the site's redirects work
- Each rule is a **Redirect Rule** shared block: from path, to path, permanent (308) or temporary (307), "also redirect everything under this path", enabled, and a note.
- The **Redirect Config** singleton lists the rules in its `rules` content area.
- The site's middleware reads them through `GET /api/redirects` before any page renders:
  - only the **newest** Redirect Config counts;
  - disabled rules are dropped;
  - a rule is dropped when a path has a backslash, whitespace or a control character (browsers can read `/\evil.example` as another host), or when its destination is `http://` rather than `https://`;
  - the longest from path is tried first;
  - a relative destination is only followed when it resolves on the site itself.

`src/shared/redirects.ts` reproduces that logic (`normalizeRedirectPath`, the filter and sort in `getRedirectRules()`, `matchRedirect()`, and the middleware's same-origin check as `followed()`), so the extension sees exactly what visitors get. `redirects.test.ts` pins the site's behavior, including a table of `normalizeRedirectPath` inputs and outputs. **When the site's redirect code changes, change it here too.**

## What it does

### Redirects view (Extensions in the navigation rail)
Every rule, as "From → To" with Permanent/Temporary and the note, its problems (a rule without one shows none), an **Open destination** button and an **Enabled** switch. The checks:
- **Ignored by the site:** a path the site drops (see above). Never shown as fine or as a dead end.
- **Loop:** A → B → A, or a path that keeps growing.
- **Chain:** A → B → C. Point A at C.
- **Dead end:** the destination doesn't exist on the site.
- **Duplicate:** an earlier rule has the same from path, so this one never fires.
- **Points at itself**, **incomplete**, **disabled**.
- **Hides a page:** a published page lives at the from path. Fine for a vanity URL.
- **Not live yet:** saved in the CMS, but `/api/redirects` doesn't serve it yet.
- **Not applied yet:** the rule block was changed, but Graph's copy of it inside Redirect Config is still the old one.

The view also has:
- one status line: whether everything is live on the site, and a warning when older Redirect Config items exist (their rules do nothing);
- **Test a URL** (collapsed): every hop a visitor goes through, how the final page answers, and **Open on the site**;
- **Add redirect**, with permanent / "and everything under it" / note under **More options**;
- an empty state when there are no rules, and a plain explanation when the instance has no Redirect Config.

### Redirects sidebar (on a page)
- The first line is the page's URL. "Open a page" when nothing is open; a note for items without a URL (blocks).
- The redirects that end on this page, counting `/x` and `/en/x` as the same page, as the catch-all does.
- A warning when a rule makes the page's own URL unreachable.
- **URL changed:** an older version of the page had a different URL segment, and nothing redirects the old URL. One confirmation ("Send visitors from /old to this page?") adds the redirect.
- **Add a redirect to this page:** only From is asked; To is the page.
- Without a Redirect Config it explains that and offers no Add. After switching page, nothing acts on the previous page's result.

### Confirmations
- **Enable/disable** asks inline before it publishes.
- **Adding a risky redirect** is refused by the backend with a code; the UI shows the reason with **Continue anyway** / **Cancel**, and the retry sends the code in `confirm`. The codes:
  - `external_destination`: the destination is another website;
  - `destination_missing`: the destination (after any further redirects) doesn't exist on the site;
  - `hides_page`: a published page lives at the from path (or under it, with "and everything under it");
  - `broad_subpaths`: "and everything under it" on a one-segment path such as `/en`.

## Writes
Every write runs as the CMS API client, so the CMS history shows that client, not the editor. Each successful write is logged as `audit` with the rule key, paths, flags and whether it was published.

- **Add redirect:**
  1. Checks the input (`validate.ts`), then the rule against the CMS's current rules, read through the REST API because Graph lags behind a write: no duplicate, no loop, not the homepage, not a site-owned address (`/api/`, `/_next/`, `__v_`, `robots.txt`, ...).
  2. Asks for any unconfirmed risk (above).
  3. Checks that Redirect Config has no unpublished version **before** creating anything, so a refusal never leaves a rule the site doesn't read.
  4. Creates a Redirect Rule block in the Redirect Config's own folder and publishes it.
  5. Publishes a new Redirect Config version with the rule appended, then reads it back and confirms the rule is in it.
- **Enable/disable:** checks both items for unpublished versions first, publishes a new version of the Redirect Rule, then Redirect Config again with its properties unchanged. The site reads the rules through Redirect Config, and Graph refreshes its copy of a rule there minutes after the rule itself (seen on joshCMS). If the rule changed but the second publish fails, the result says so plainly instead of failing the whole change.
- **Each new version** is the draft that its own `POST /versions` returned, never "the newest draft", so two editors can't publish each other's draft. It is written with the full properties of the published version: `POST /versions` makes a blank draft, so a partial patch would wipe the rest.
- **Publishing** re-reads the version's status. On an approval-workflow instance, both versions wait as drafts for a reviewer. A 403 becomes "the API key can read content but not change it".
- **When it goes live:** once the site's cached `/api/redirects` refreshes. That is within a minute when the CMS publish webhook reaches the site, and within an hour (the site's cache ceiling) without it.

Re-running the site's `scripts/seed-redirects.ts` rebuilds Redirect Config from the seed's own list, so rules added here drop out of it. Their blocks stay in the Redirects folder.

## Platform constraints (CMS UI extensions beta, SDK 1.1.0)
- **The extension context is only `{key, version, locale, publicUrl}`.** The page's path comes from `publicUrl`.
- **Extensions get no CMS token.** The app stores a CMS API client in its settings.
- **Reading settings an install never saved throws** in the production runtime. `readSection` treats that as empty.

## Settings
- **Site:** the front end for this CMS instance, `https://` only, e.g. `https://optimizely-onboarding.vercel.app` for joshCMS.
- **Optimizely Graph:** the instance's single key.
- **CMS API client:** **with content write access**.

## Develop

```bash
yarn install
yarn validate      # lint + typecheck + unit tests + build + ocp-app-sdk validate
ocp dev -p 3100    # the view and sidebar in a simulated CMS host
```

The live suite only reads: it never adds or changes a rule.

```bash
REDIRECTS_LIVE=1 OPTIMIZELY_CMS_CLIENT_ID=… OPTIMIZELY_CMS_CLIENT_SECRET=… OPTIMIZELY_GRAPH_SINGLE_KEY=… \
REDIRECTS_SITE_URL=https://optimizely-onboarding.vercel.app REDIRECTS_LIVE_KEY=<page key> \
REDIRECTS_LIVE_PATH=/en/personal/savings REDIRECTS_LIVE_OUT=/tmp/redirects.json yarn vitest run tests/live
```

## Layout

| Path | What |
|---|---|
| `src/shared/redirects.ts` | The site's matching, plus trace, checks and new-rule validation: shared by the UI and backend |
| `src/backend/functions/CmsUiExtension.ts` | Action router: `overview`, `pageRedirects`, `testUrl`, `addRule`, `setEnabled`; audit log |
| `src/backend/lib/validate.ts` | One parser per action: every field checked before a handler runs |
| `src/backend/lib/manager.ts` | The actions |
| `src/backend/lib/risks.ts` | The risks an addition must confirm |
| `src/backend/lib/writes.ts` | Publishing a changed version without losing the other properties |
| `src/backend/lib/graph.ts`, `site.ts`, `cms.ts` | Graph rules and page URLs, the site's status and `/api/redirects`, CMS REST |
| `src/cms-ui-extensions/redirects/` | `RedirectManager.view.tsx`, `PageRedirects.sidebar.tsx`, the add form and its confirmations |

## Deploy

```bash
ocp app register --appId cms_redirects --name "Redirects" --product HUB --personal   # once
ocp app prepare --bump-dev-version --publish
ocp directory install cms_redirects@<version> --scope <cms-instance-uuid>
```
