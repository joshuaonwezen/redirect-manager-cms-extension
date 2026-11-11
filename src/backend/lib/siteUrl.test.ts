import {describe, expect, it} from 'vitest';

import {originsOf, pickSiteUrl} from './siteUrl';

// Shape of GET /v1/applications on an instance with three applications (2026-11-11).
const APPS = [
  {key: 'site_a', hosts: [{authority: 'www.example.com', type: 'primary', preferredUrlScheme: 'https'}]},
  {key: 'app_preview', hosts: [{authority: 'preview.example.com', type: 'preview', preferredUrlScheme: 'https'}]},
  {key: 'site_b', hosts: [{authority: 'shop.example.org', type: 'primary'}]},
  {key: 'local', hosts: [{authority: 'localhost:3000', type: 'primary', preferredUrlScheme: 'http'}]},
  {key: 'junk', hosts: [{authority: 'bad host/x', type: 'primary'}, {authority: null}]},
];

describe('originsOf', () => {
  it('keeps https application hosts, primaries separately', () => {
    expect(originsOf(APPS)).toEqual({
      all: ['https://www.example.com', 'https://preview.example.com', 'https://shop.example.org'],
      primary: ['https://www.example.com', 'https://shop.example.org'],
    });
  });
});

describe('pickSiteUrl', () => {
  const origins = originsOf(APPS);

  it('prefers the admin override', () => {
    expect(pickSiteUrl('https://override.example', 'https://www.example.com/x', origins)).toBe('https://override.example');
  });

  it("uses the open page's own site when the CMS knows that host", () => {
    expect(pickSiteUrl('', 'https://shop.example.org/en/cart/', origins)).toBe('https://shop.example.org');
    expect(pickSiteUrl('', 'https://preview.example.com/p', origins)).toBe('https://preview.example.com');
  });

  it('never trusts a page URL on a host the CMS does not list', () => {
    expect(pickSiteUrl('', 'https://169.254.169.254/latest', origins)).toBeNull();
    expect(pickSiteUrl('', 'https://evil.example/x', originsOf([APPS[0]]))).toBe('https://www.example.com');
  });

  it('falls back to the only primary site, else asks for the setting', () => {
    expect(pickSiteUrl('', undefined, originsOf([APPS[0], APPS[1]]))).toBe('https://www.example.com');
    expect(pickSiteUrl('', undefined, origins)).toBeNull();
    expect(pickSiteUrl('', 'not a url', originsOf([]))).toBeNull();
  });
});
