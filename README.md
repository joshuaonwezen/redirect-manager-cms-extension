# Redirects

Redirects lets editors manage the site's redirects without leaving Optimizely CMS. A full-page view lists every redirect with the problems it causes (loops, chains, dead ends, duplicates, rules the site ignores), and a sidebar on each page shows the redirects that lead to it and offers to cover an old address after the page's URL changes. Editors can add, enable and disable redirects; each change is checked against what the site actually does before it is published.

Documentation: [walkthrough](https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#redirects) - [install on another CMS instance](https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#reuse) - [troubleshooting](https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#troubleshooting)

## What editors get

**Extensions > Redirects** (full-page view):
- every redirect as "From → To", permanent or temporary, its note, an **Enabled** switch and **Open destination**;
- the problems of each one: **Loop**, **Chain** (A → B → C), **Dead end** (the destination doesn't exist on the site), **Duplicate** (an earlier rule has the same From, so this one never fires), **Points at itself**, **Incomplete**, **Disabled**, **Ignored by the site** (see the path rules below), **Hides a page** (a published page lives at the From address), **Not live yet** (saved, but the site doesn't serve it yet) and **Not applied yet** (changed, but Graph still has the previous version);
- one status line: whether everything is live, and a warning when older redirect lists exist (they do nothing);
- **Test a URL**: every redirect a visitor to an address goes through, where they end up, and how that page answers;
- **Add redirect**, with permanent or temporary, "and everything under it", and a note.

**Redirects** sidebar, on a page:
- the redirects that end on this page;
- a warning when a redirect sends visitors away from the page's own address;
- the page's earlier addresses (its URL segment changed) that nothing redirects yet, each fixed with one confirmation;
- **Add a redirect to this page**: only the old address is asked.

## Setup

1. Make sure the site follows the pattern in [What your site needs](#what-your-site-needs), and that the two content types exist in the CMS.
2. Install the app on the CMS instance (see [Deploy](#deploy)), then fill in its settings:

| Setting | Required | Where to find it | Used for |
|---|---|---|---|
| Site URL | No | The site's public `https://` address, e.g. `https://www.example.com` | Which site the checks run on. Leave blank to use the site address in CMS **Settings > Applications**. Needed only when the CMS serves several sites. |
| Graph single key | Yes | CMS **Settings > API Keys** | Reading the published redirects and the addresses of published pages |
| CMS client ID and secret | Yes | CMS **Settings > API Keys**: create an API client. The secret is shown once. | Adding, enabling and disabling redirects (creating and publishing content), reading the current versions, and reading **Settings > Applications** |

The CMS API client needs **write access to content**: every change publishes content. A client that can only read gets "can read content but not change it".

How the site is chosen when **Site URL** is blank: the sidebar uses the open page's own site (when its host is listed in Settings > Applications), and the view uses the CMS's only primary host. On a CMS with several sites, the view asks for the setting. Only `https` hosts are used.

## What your site needs

The extension reads and writes the redirects as CMS content, and assumes the site applies them as described here. `src/shared/redirects.ts` has no dependencies and implements every rule below (`normalizeRedirectPath`, `effectiveRules`, `matchRedirect`, `followed`), so you can use it as the reference for your own code.

### Content types

Both are blocks (base type `_component`) and must be indexed by Optimizely Graph under exactly these keys. Don't exclude any of these properties from indexing: the extension queries all of them.

**`RedirectConfig`**, the redirect list. Create one item, in a folder editors can reach; new rules are created in the same folder.

| Property | Type | Meaning |
|---|---|---|
| `rules` | Content area (`array` of `content`) allowing `RedirectRule` | The redirects, in any order |
| `notes` | String | Notes for editors |

**`RedirectRule`**, one redirect.

| Property | Type | Meaning |
|---|---|---|
| `fromPath` | String | The old address: a path on the site, like `/old-page` |
| `toPath` | String | The new address: a path, or a full `https://` address |
| `permanent` | Boolean | On: 308 Permanent Redirect. Off or empty: 307 Temporary Redirect |
| `matchSubpaths` | Boolean | Also redirect every address under `fromPath` |
| `enabled` | Boolean | Off: the site ignores the rule. Empty counts as on |
| `note` | String | Why the redirect exists |

### Reading the rules

1. Query Graph for `RedirectConfig` ordered by `_metadata.lastModified` descending and use **only the first item**. Older items are ignored (the view warns about them).
2. Drop a rule when `enabled` is `false`, or when `fromPath` or `toPath` is empty.
3. Normalize `fromPath` and `toPath`:
   - trim surrounding whitespace;
   - drop any value that still contains a backslash, whitespace (including non-breaking spaces) or a control character (U+0000 to U+001F, U+007F): a browser can read `/\other.example` as another website;
   - keep a full `https://` address (any case) unchanged, and drop an `http://` one;
   - for a path, add a leading `/` when missing, collapse repeated slashes and remove the trailing slash (except for `/` itself).
4. Drop a rule whose `fromPath` or `toPath` came out empty.
5. Sort the rules by `fromPath` length, **longest first**, so an exact rule beats a shorter "everything under it" rule.

### Applying them

Run this before your pages render (in middleware or an edge function), for every request path:

1. Compare paths case-insensitively, after collapsing repeated slashes and removing the trailing slash.
2. Try the rules in order; the first match wins:
   - the path equals `fromPath`: the destination is `toPath`;
   - `matchSubpaths` is on and the path starts with `fromPath` + `/`: the destination is `toPath` (without its trailing slash; empty when `toPath` is `/`) followed by the rest of the path, in its original case. `/old/a/b` with `/old` → `/new` becomes `/new/a/b`.
3. Skip a rule (try the next one) when its destination is a relative path equal to the requested path, compared the same way: a self-loop.
4. Answer **308** when `permanent` is on, **307** otherwise.
5. An absolute destination is used as it is. A relative one is resolved against the site's own origin, and the redirect is **not sent** when the result is on another origin: a path such as `//other.example` would leave the site. The visitor then gets the page as if no rule matched.
6. Carry the request's query string over when the destination has none of its own.

Return a real **404** (or 410) status for pages that don't exist. The extension requests destinations on the site to find dead ends, and a "not found" page answered with 200 looks like a page that exists.

### Going live

Refresh the rules when content is published (the CMS publish webhook) and cache them for **at most an hour**. The extension tells editors a change goes live "within a minute, or within the hour at the latest".

### Optional: the live-rules endpoint

`GET https://<site>/api/redirects`, answering `200` with JSON within 8 seconds:

```json
{"rules": [{"fromPath": "/old-page", "toPath": "/new-page", "permanent": true, "matchSubpaths": false}]}
```

Return the rules the site applies right now, after the steps in [Reading the rules](#reading-the-rules) (enabled only, normalized, sorted). The view compares them with the saved rules to show **Not live yet**. Without the endpoint, the view says it couldn't ask the site which redirects are live, and everything else works.

## Limits

- One redirect list per CMS: the newest Redirect Config. Every site that reads it gets the same rules.
- One site per check: the Site URL, the open page's site, or the CMS's only site.
- Editors can add, enable and disable redirects here. Changing a rule's addresses, deleting a rule or editing the list is done in the CMS.
- A redirect matches the path only: a From address can't contain `?` or `#`.
- These From addresses are refused: `/` (the homepage), `/api/...`, `/_next/...`, `/favicon.ico`, `/robots.txt`, `/sitemap.xml`, and any path containing `__v_` (reserved for experiment variation routes).
- The sidebar treats `/en/about` and `/about` as the same page: a leading language segment is ignored.
- Graph indexes a publish within about a minute; until then the view can show **Not applied yet**. Checks cover up to 100 rules for **Not applied yet** and up to 2,000 published pages for **Hides a page**. A chain of 10 or more redirects is reported as a loop.
- New rules are created in the redirect list's primary language.
- The CMS history shows the API client as the author of every change, not the editor.

## Security

- **Confirmations.** Enabling or disabling asks first. Adding a risky redirect is refused until the editor confirms it with **Continue anyway**: one that sends visitors to another website, ends on a page that doesn't exist, hides a published page, or covers a whole section ("and everything under it" on a one-segment path such as `/en`).
- **Audit log.** The CMS gives the extension no editor identity, so every successful change is logged in the app's logs as `audit`, with the action, the rule's key, both addresses, the flags and whether it was published.
- **Off-site guard.** From must be a path; To must be a path or an `https://` address; addresses with a backslash, whitespace or control character are refused. Existing rules that the site would refuse to follow are marked **Ignored by the site**. The backend only requests pages on the resolved site: the page URL the editor's browser sends is used only when its host is one of the CMS's own application hosts, and never fetched directly.
- **Write safety.** Every input is checked on the server before anything runs. A rule is checked against the CMS's current rules (read through the REST API, since Graph lags behind a write) for duplicates and loops. Before writing, the extension refuses when the redirect list or the rule has unpublished changes, so a later publish of someone's draft can't undo the change. Each new version is written with the full set of properties from the published version, then published; after adding, the published list is read back to confirm it carries the new rule. On an instance with an approval workflow, changes wait as drafts for a reviewer.
- **Secrets.** The Graph key and the CMS client secret are stored as secret settings and never reach the browser.

## Develop

```bash
yarn install
yarn validate      # lint, typecheck, unit tests, build and ocp-app-sdk validate
```

The live suite reads a real CMS, Graph and site. It never adds or changes a rule. `REDIRECTS_SITE_URL` is optional.

```bash
REDIRECTS_LIVE=1 \
OPTIMIZELY_CMS_CLIENT_ID=<client-id> OPTIMIZELY_CMS_CLIENT_SECRET=<client-secret> \
OPTIMIZELY_GRAPH_SINGLE_KEY=<single-key> \
REDIRECTS_SITE_URL=https://www.example.com \
REDIRECTS_LIVE_KEY=<page-content-key> REDIRECTS_LIVE_PATH=/en/about \
REDIRECTS_LIVE_OUT=/tmp/redirects.json \
yarn vitest run tests/live
```

## Deploy

Run the OCP CLI with `npx -p @optimizely/ocp-cli-v2 ocp ...`, or install it and use `ocp`:

```bash
npx -p @optimizely/ocp-cli-v2 ocp app register    # once, with the app ID from meta.app_id in app.yml
ocp app prepare --bump-dev-version --publish
ocp directory install <app_id>@<version> --scope <cms-instance-uuid>
```

Publishing a new dev version moves existing installs onto it.

## Layout

| Path | What |
|---|---|
| `src/shared/redirects.ts` | The site's matching rules, plus trace, checks and new-rule validation; shared by the UI and backend |
| `src/backend/functions/CmsUiExtension.ts` | Action router (`overview`, `pageRedirects`, `testUrl`, `addRule`, `setEnabled`) and audit log |
| `src/backend/lib/validate.ts` | One parser per action: every field checked before a handler runs |
| `src/backend/lib/manager.ts` | The actions, and which site each one checks |
| `src/backend/lib/siteUrl.ts` | The site's address: the setting, or the CMS's application hosts |
| `src/backend/lib/risks.ts` | The risks an addition must confirm |
| `src/backend/lib/writes.ts` | Publishing a changed version without losing the other properties |
| `src/backend/lib/graph.ts`, `site.ts`, `cms.ts` | Graph queries, requests to the site, CMS REST API |
| `src/backend/lifecycle/Lifecycle.ts`, `forms/settings.yml` | The settings form and its checks |
| `src/cms-ui-extensions/redirects/` | The view, the sidebar, the add form and its confirmations |
