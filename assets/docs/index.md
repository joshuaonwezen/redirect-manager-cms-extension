# Redirects

## Setup
1. **Site**: the front end that applies these redirects (its middleware reads `/api/redirects`).
2. **Optimizely Graph**: the instance's single key.
3. **CMS API client**: with content write access, to add and switch rules. The CMS history shows this
   client as the author.

## Using it
Open **Extensions > Redirects** for every rule, or the **Redirects** tab on a page for the rules about that
page. A change publishes a Redirect Rule block and a new version of Redirect Config. The site serves it once its
redirect cache refreshes: within a minute when the CMS publish webhook reaches the site, within an hour without.
On an instance with approvals, both wait as drafts for a reviewer.

Re-running the site's `seed-redirects.ts` rebuilds Redirect Config from the seed's own list, so rules added
here drop out of it (their blocks stay in the Redirects folder).
