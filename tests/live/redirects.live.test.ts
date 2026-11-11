import {writeFileSync} from 'node:fs';

import {describe, expect, it} from 'vitest';

import {createManager} from '../../src/backend/lib/manager';

// Read-only: reads the rules from Graph and the site, opens destinations on the site.
// It never calls addRule or setEnabled - try those by hand, on a throwaway rule.
// REDIRECTS_SITE_URL is optional: without it the site comes from the CMS's applications.
// REDIRECTS_LIVE=1 OPTIMIZELY_CMS_CLIENT_ID=<id> OPTIMIZELY_CMS_CLIENT_SECRET=<secret> OPTIMIZELY_GRAPH_SINGLE_KEY=<key> \
// REDIRECTS_SITE_URL=https://www.example.com REDIRECTS_LIVE_KEY=<page key> \
// REDIRECTS_LIVE_PATH=/en/about REDIRECTS_LIVE_OUT=/tmp/redirects.json yarn vitest run tests/live
const live = process.env.REDIRECTS_LIVE === '1';

describe.skipIf(!live)('redirects against a real CMS and site', () => {
  const manager = createManager({
    siteUrl: process.env.REDIRECTS_SITE_URL ?? '',
    graph: {singleKey: process.env.OPTIMIZELY_GRAPH_SINGLE_KEY ?? ''},
    cms: {clientId: process.env.OPTIMIZELY_CMS_CLIENT_ID ?? '', clientSecret: process.env.OPTIMIZELY_CMS_CLIENT_SECRET ?? ''},
  });

  it('reads the overview, a page and a URL test', async () => {
    const overview = await manager.overview();
    const page = await manager.pageRedirects({
      key: process.env.REDIRECTS_LIVE_KEY ?? '',
      locale: 'en',
      path: process.env.REDIRECTS_LIVE_PATH ?? '/',
    });
    const test = await manager.testUrl({url: overview.rules[0]?.fromPath ?? '/'});
    if (process.env.REDIRECTS_LIVE_OUT) writeFileSync(process.env.REDIRECTS_LIVE_OUT, JSON.stringify({overview, page, test}, null, 2));
    expect(overview.config).not.toBeNull();
    expect(overview.rules.length).toBeGreaterThan(0);
  });
});
