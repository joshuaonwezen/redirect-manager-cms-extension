# Redirects

Manage the site's redirects from the CMS editor, and see what visitors actually get.

- **Redirects** view (Extensions in the navigation rail):
  - every redirect in the site's redirect list, with loops, chains, duplicates, dead destinations, redirects the
    site ignores and changes that aren't live yet;
  - **Test a URL**: every redirect a visitor goes through, and how the final page answers;
  - add a redirect (risky ones ask for confirmation), and enable or disable one.
- **Redirects** panel on a page:
  - the redirects that lead to it, and a warning when one makes the page unreachable;
  - earlier addresses of the page (its URL changed) that nothing redirects yet, fixed with one confirmation.

Requires a site that reads its redirects from CMS content (a Redirect Config block listing Redirect Rule blocks)
and applies them before pages render. The setup guide describes the pattern.
