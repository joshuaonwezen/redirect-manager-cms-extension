# Redirects

## Setup
1. **Site**: the website these redirects run on, as an `https://` address.
2. **Optimizely Graph**: the instance's single key.
3. **CMS API client**: with content write access, to add and switch redirects. The CMS history shows this
   client as the author.

## Using it
Open **Extensions > Redirects** for every redirect, or the **Redirects** tab on a page for the ones that lead
to that page. Enabling or disabling a redirect asks first; adding one asks again when it is risky: it sends
visitors to another website, ends on a page that doesn't exist, hides a published page, or covers a whole
section of the site.

A change publishes the redirect and the site's redirect list. It goes live on the site within a minute, or
within the hour at the latest. On an instance with approvals, both wait as drafts for a reviewer.

A redirect whose address has a space, backslash or hidden character, or that points at an `http://` address,
is ignored by the site; the extension marks it "Ignored by the site".

Re-running the site's `seed-redirects.ts` rebuilds the redirect list from the seed's own list, so redirects
added here drop out of it (their blocks stay in the Redirects folder).
