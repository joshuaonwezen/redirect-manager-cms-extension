import {afterEach, describe, expect, it, vi} from 'vitest';

import {CmsClient} from './cms';

const KEY = '0123456789abcdef0123456789abcdef';

/** Answers the CMS API from a table of `METHOD path` -> [status, body]; records every call. */
function stubCms(routes: Record<string, Array<[number, unknown]>>) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      const route = `${init.method ?? 'GET'} ${path}`;
      if (path === '/oauth/token') return new Response(JSON.stringify({access_token: 't', expires_in: 3600}));
      calls.push(route);
      const answer = routes[route]?.shift();
      if (!answer) return new Response('not stubbed', {status: 500});
      return new Response(answer[1] === null ? '' : JSON.stringify(answer[1]), {status: answer[0]});
    }),
  );
  return calls;
}

const client = () => new CmsClient({clientId: 'id', clientSecret: 'secret'});

describe('CmsClient writes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the version POST /versions returns, without listing drafts', async () => {
    const calls = stubCms({[`POST /v1/content/${KEY}/versions`]: [[201, {version: '42', status: 'draft'}]]});
    expect(await client().createBaseDraft(KEY, 'en', {displayName: 'Redirect Config'})).toBe('42');
    expect(calls).toEqual([`POST /v1/content/${KEY}/versions`]);
  });

  it('re-reads the status after publishing', async () => {
    stubCms({
      [`POST /v1/content/${KEY}/versions/7:publish`]: [[200, null]],
      [`GET /v1/content/${KEY}/versions/7`]: [[200, {key: KEY, version: '7', locale: 'en', status: 'inReview'}]],
    });
    expect(await client().publishVersion(KEY, '7')).toBe('awaiting_approval');
  });

  it('waits out a read that still shows the draft right after publishing', async () => {
    stubCms({
      [`POST /v1/content/${KEY}/versions/7:publish`]: [[200, null]],
      [`GET /v1/content/${KEY}/versions/7`]: [
        [200, {key: KEY, version: '7', locale: 'en', status: 'draft'}],
        [200, {key: KEY, version: '7', locale: 'en', status: 'published'}],
      ],
    });
    expect(await client().publishVersion(KEY, '7', [0, 0, 0])).toBe('published');
  });

  it('still says waiting when the draft never shows as published', async () => {
    stubCms({
      [`POST /v1/content/${KEY}/versions/7:publish`]: [[200, null]],
      [`GET /v1/content/${KEY}/versions/7`]: [
        [200, {key: KEY, version: '7', locale: 'en', status: 'draft'}],
        [200, {key: KEY, version: '7', locale: 'en', status: 'draft'}],
      ],
    });
    expect(await client().publishVersion(KEY, '7', [0, 0])).toBe('awaiting_approval');
  });

  it('treats "requires approval" as waiting for a reviewer', async () => {
    stubCms({[`POST /v1/content/${KEY}/versions/7:publish`]: [[400, {detail: 'Publishing requires approval.'}]]});
    expect(await client().publishVersion(KEY, '7')).toBe('awaiting_approval');
  });
});

describe('CmsClient.listApplications', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the applications from a page or a bare list', async () => {
    const app = {key: 'site', hosts: [{authority: 'www.example.com', type: 'primary'}]};
    stubCms({'GET /v1/applications': [[200, {items: [app]}], [200, [app]], [200, null]]});
    expect(await client().listApplications()).toEqual([app]);
    expect(await client().listApplications()).toEqual([app]);
    expect(await client().listApplications()).toEqual([]);
  });
});
