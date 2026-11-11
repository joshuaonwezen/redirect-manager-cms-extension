# Redirects

Manage the site's redirects from inside the CMS, and see what visitors actually get.

Documentation: [walkthrough](https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#redirects) - [install on another CMS instance](https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#reuse) - [troubleshooting](https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#troubleshooting)

## Before you install

The site must read its redirects from CMS content, as two block types indexed by Optimizely Graph:

- **`RedirectConfig`**, the redirect list: `rules` (a content area allowing `RedirectRule`) and `notes` (string). Only the most recently modified item counts. New redirects are created in the same folder as this item.
- **`RedirectRule`**, one redirect: `fromPath` (string), `toPath` (string), `permanent` (boolean, 308 when on, 307 when off), `matchSubpaths` (boolean, also redirect everything under From), `enabled` (boolean, empty counts as on) and `note` (string).

The site applies them before a page renders:

- paths are normalized: leading slash added, repeated slashes collapsed, trailing slash removed, and matched without regard to case;
- a path with a backslash, whitespace or control character is ignored, and so is an `http://` destination (full addresses must be `https://`);
- the longest From is tried first; with "everything under it", the rest of the path is added to the destination;
- a rule whose destination is the requested path is skipped;
- the query string is carried over when the destination has none;
- a relative destination that resolves to another website is never followed.

Pages that don't exist must answer with a real 404 (or 410): the extension requests destinations on the site to find dead ends. Optionally, `GET /api/redirects` on the site returns the rules it applies right now as `{"rules": [{"fromPath", "toPath", "permanent", "matchSubpaths"}]}`, which lets the extension show changes that aren't live yet.

The walkthrough has the full pattern.

## Settings

| Setting | Required | Where to find it | Used for |
|---|---|---|---|
| **Site URL** | No | The site's public `https://` address | Which site the checks run on. Leave blank to use the site address in CMS **Settings > Applications**. Needed only when the CMS serves several sites. |
| **Graph single key** | Yes | CMS **Settings > API Keys** | Reading the published redirects and page addresses |
| **CMS client ID and secret** | Yes | CMS **Settings > API Keys** (the secret is shown once) | Adding, enabling and disabling redirects, and reading **Settings > Applications** |

The CMS API client needs **write access to content**: every change publishes content. The CMS history shows this client as the author, not the editor; the app's logs record each change.

## Using it

Open **Extensions > Redirects** for every redirect, with its problems, a URL tester and **Add redirect**. Open the **Redirects** panel on a page for the redirects that lead to it, its earlier addresses that nothing redirects yet, and **Add a redirect to this page**.

Enabling or disabling a redirect asks first. Adding one asks again when it is risky: it sends visitors to another website, ends on a page that doesn't exist, hides a published page, or covers a whole section of the site.

A change publishes the redirect and the redirect list. It goes live on the site within a minute, or within the hour at the latest. On an instance with approvals, both wait as drafts for a reviewer.

## Troubleshooting

- **"Missing in the app settings"**: fill in the settings it names.
- **"This CMS has more than one site"** or **"This page's address isn't one of this CMS's sites"**: set the **Site URL**.
- **"This CMS has no site address in Settings > Applications"**: add the site's host there, or set the **Site URL**.
- **"Can read content but not change it"**: the CMS API client needs content write access.
- **"Has unpublished changes"**: publish or discard the draft of the redirect list (or the rule) in the CMS, then try again.
- **"Couldn't ask the site which redirects are live"**: the site has no `/api/redirects`, or it didn't answer. Everything else still works.
