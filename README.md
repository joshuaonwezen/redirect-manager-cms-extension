# Redirects: CMS UI extension

An Optimizely CMS (SaaS) UI extension, built as a CMS-scoped OCP app. It manages the CMS-driven redirects of `optimizely-nextjs-demo` from inside the editor, and checks them against what the site actually does.

## How the site's redirects work
- Each rule is a **Redirect Rule** shared block: from path, to path, permanent (308) or temporary (307), "also redirect everything under this path", enabled, and a note.
- The **Redirect Config** singleton lists the rules in its `rules` content area.
- The site's middleware reads them through `GET /api/redirects` before any page renders:
  - only the **newest** Redirect Config counts;
  - disabled rules are dropped;
  - the longest from path is tried first.

`src/shared/redirects.ts` reproduces that logic (`normalizeRedirectPath`, the filter and sort in `getRedirectRules()`, `matchRedirect()`), so the extension sees exactly what visitors get. `redirects.test.ts` pins the site's behavior. **When the site's redirect code changes, change it here too.**

## What it does

### Redirects view (Extensions in the navigation rail)
Every rule, with checks:
- **Loop:** A → B → A, or a path that keeps growing.
- **Chain:** A → B → C. Point A at C.
- **Dead end:** the destination returns 404 on the site.
- **Duplicate:** an earlier rule has the same from path, so this one never fires.
- **Points at itself**, **incomplete**, **disabled**.
- **Hides a page:** a published page lives at the from path. Fine for a vanity URL.
- **Not live yet:** saved in the CMS, but `/api/redirects` doesn't serve it yet.
- **Changed, not applied:** the rule block was changed, but Graph's copy of it inside Redirect Config is still the old one.

The view also has:
- a warning when older Redirect Config items exist, since their rules do nothing;
- **Test a URL:** every hop a visitor goes through, and how the final page answers;
- **Add redirect** and an **Enabled** switch per rule. Each change asks for confirmation.

### Redirects sidebar (on a page)
- The redirects that end on this page, counting `/x` and `/en/x` as the same page, as the catch-all does.
- A warning when a rule makes the page's own URL unreachable.
- **URL changed:** an older version of the page had a different URL segment, and nothing redirects the old URL. One click adds the redirect.

## Writes
Every write runs as the CMS API client, so the CMS history shows that client, not the editor.

- **Add redirect:**
  1. Checks the rule against the CMS's current rules, read through the REST API because Graph lags behind a write: no duplicate, no loop, not the homepage.
  2. Creates a Redirect Rule block in the Redirect Config's own folder and publishes it.
  3. Publishes a new Redirect Config version with the rule appended.
- **Enable/disable:** publishes a new version of that Redirect Rule, then Redirect Config again with its properties unchanged. The site reads the rules through Redirect Config, and Graph refreshes its copy of a rule there minutes after the rule itself (seen on joshCMS); indexing the config refreshes it. A rule edited directly in the CMS shows as "Changed, not applied" in the view until Graph catches up.
- **When it goes live:** once the site's cached `/api/redirects` refreshes. That is within a minute when the CMS publish webhook reaches the site, and within an hour (the site's cache ceiling) without it.
- **Each new version** is written with the full properties of the published one. `POST /versions` makes a blank draft, so a partial patch would wipe the rest.
- **Refusals:**
  - It refuses when someone else has an unpublished version, because publishing it later would undo this change.
  - On an approval-workflow instance, both versions wait as drafts for a reviewer.

Re-running the site's `scripts/seed-redirects.ts` rebuilds Redirect Config from the seed's own list, so rules added here drop out of it. Their blocks stay in the Redirects folder.

## Platform constraints (CMS UI extensions beta, SDK 1.1.0)
- **The extension context is only `{key, version, locale, publicUrl}`.** The page's path comes from `publicUrl`.
- **Extensions get no CMS token.** The app stores a CMS API client in its settings.
- **Reading settings an install never saved throws** in the production runtime. `readSection` treats that as empty.

## Settings
- **Site:** the front end for this CMS instance, e.g. `https://optimizely-onboarding.vercel.app` for joshCMS.
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
| `src/backend/functions/CmsUiExtension.ts` | Action router: `overview`, `pageRedirects`, `testUrl`, `addRule`, `setEnabled` |
| `src/backend/lib/manager.ts` | The actions |
| `src/backend/lib/writes.ts` | Publishing a changed version without losing the other properties |
| `src/backend/lib/graph.ts`, `site.ts`, `cms.ts` | Graph rules and page URLs, the site's status and `/api/redirects`, CMS REST |
| `src/cms-ui-extensions/redirects/` | `RedirectManager.view.tsx`, `PageRedirects.sidebar.tsx`, the add form |

## Deploy

```bash
ocp app register --appId cms_redirects --name "Redirects" --product HUB --personal   # once
ocp app prepare --bump-dev-version --publish
ocp directory install cms_redirects@<version> --scope <cms-instance-uuid>
```
