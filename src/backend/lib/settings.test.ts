import {logger, resetLocalSettingsStore, storage} from '@zaiusinc/app-sdk';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {loadConfig, normalizeSiteUrl} from './settings';

describe('settings', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetLocalSettingsStore();
  });

  it('treats an unreadable store as empty', async () => {
    // What the production store throws on an install that has never saved its settings.
    vi.spyOn(storage.settings, 'get').mockRejectedValue(new Error('Failed to get value at app-data/1/settings'));
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    expect(await loadConfig()).toEqual({
      ok: false,
      missing: ['Graph single key', 'CMS client ID', 'CMS client secret'],
    });
  });

  it('does not require the Site URL', async () => {
    await storage.settings.put('graph', {singleKey: 'k'});
    await storage.settings.put('cms', {clientId: 'i', clientSecret: 's'});
    expect(await loadConfig()).toEqual({
      ok: true,
      config: {siteUrl: '', graph: {singleKey: 'k'}, cms: {clientId: 'i', clientSecret: 's'}},
    });
    await storage.settings.put('site', {siteUrl: 'https://www.example.com/'});
    expect(await loadConfig()).toMatchObject({ok: true, config: {siteUrl: 'https://www.example.com'}});
  });

  it('normalizes the site URL', () => {
    expect(normalizeSiteUrl(' https://site.example/ ')).toBe('https://site.example');
    expect(normalizeSiteUrl('https://site.example/sub/')).toBe('https://site.example/sub');
    expect(normalizeSiteUrl('site.example')).toBeNull();
    expect(normalizeSiteUrl('http://site.example')).toBeNull();
    expect(normalizeSiteUrl('https://site.example/a b')).toBeNull();
  });
});
