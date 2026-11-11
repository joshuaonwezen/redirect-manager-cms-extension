import {describe, expect, it} from 'vitest';

import {
  analyzeRules,
  effectiveRules,
  followed,
  matchRedirect,
  normalizeRedirectPath,
  samePage,
  trace,
  validateNewRule,
  withoutLocale,
  type KeyedRule,
} from './redirects';

// The behavior a site applies (README: What your site needs).
// If one of these fails after a change on the site, update redirects.ts to match it.

// normalizeRedirectPath() input -> output, as a site that follows the pattern answers it
// (including dropping paths a browser would read as another website). "" means
// the site drops the rule. Change this table and the site's function together.
const NORMALIZE_TABLE: Array<[string, string]> = [
  [' savings//accounts/ ', '/savings/accounts'],
  ['offers', '/offers'],
  ['/', '/'],
  ['///', '/'],
  ['', ''],
  ['   ', ''],
  ['//evil.example', '/evil.example'],
  ['https://x.example/a/', 'https://x.example/a/'],
  ['HTTPS://x.example', 'HTTPS://x.example'],
  ['http://x.example/a', ''],
  ['HTTP://x.example', ''],
  ['/\\evil.example', ''],
  ['\\evil.example', ''],
  ['/\t/evil.example', ''],
  ['/\n/evil.example', ''],
  ['/\r/evil.example', ''],
  ['/a b', ''],
  ['/a\u0000b', ''],
  ['/a\u001fb', ''],
  ['/a\u007fb', ''],
  ['/a\u00a0b', ''],
  ['https://x.example/a b', ''],
  ['https://x.example\\@evil.example', ''],
  [' /trimmed\t', '/trimmed'],
];

describe('normalizeRedirectPath mirrors the site', () => {
  it.each(NORMALIZE_TABLE)('%j -> %j', (input, output) => {
    expect(normalizeRedirectPath(input)).toBe(output);
  });
});

describe('mirrors the site', () => {
  const rules = effectiveRules([
    {fromPath: 'savings-accounts/', toPath: '/personal/savings', permanent: true},
    {fromPath: '/promo', toPath: '/offers', matchSubpaths: true},
    {fromPath: '/promo/summer', toPath: '/summer'},
    {fromPath: '/status', toPath: 'https://status.example.com'},
    {fromPath: '/off', toPath: '/x', enabled: false},
    {fromPath: '/root-sub', toPath: '/', matchSubpaths: true},
    {fromPath: '/same', toPath: '/SAME'},
    {fromPath: '', toPath: '/nowhere'},
  ]);

  it('normalizes paths but leaves absolute URLs alone', () => {
    expect(normalizeRedirectPath(' savings//accounts/ ')).toBe('/savings/accounts');
    expect(normalizeRedirectPath('/')).toBe('/');
    expect(normalizeRedirectPath('https://x.example/a/')).toBe('https://x.example/a/');
  });

  it('drops disabled and incomplete rules and sorts the longest from first', () => {
    expect(rules.map((r) => r.fromPath)).toEqual(['/savings-accounts', '/promo/summer', '/root-sub', '/status', '/promo', '/same']);
  });

  it('matches exactly, case-insensitively, with 308 for permanent', () => {
    expect(matchRedirect('/Savings-Accounts/', rules)).toEqual({toPath: '/personal/savings', status: 308});
    expect(matchRedirect('/savings-accounts/x', rules)).toBeNull();
  });

  it('appends the remainder for subpath rules, keeping its casing, and lets a longer rule win', () => {
    expect(matchRedirect('/promo/Winter/Deal', rules)).toEqual({toPath: '/offers/Winter/Deal', status: 307});
    expect(matchRedirect('/promo/summer', rules)).toEqual({toPath: '/summer', status: 307});
    expect(matchRedirect('/root-sub/a', rules)).toEqual({toPath: '/a', status: 307});
  });

  it('skips a rule that points at the incoming path', () => {
    expect(matchRedirect('/same', rules)).toBeNull();
  });

  it('drops rules whose paths a browser could read as another website, and http destinations', () => {
    const kept = effectiveRules([
      {fromPath: '/ok', toPath: '/fine'},
      {fromPath: '/bs', toPath: '/\\evil.example'},
      {fromPath: '/tab', toPath: '/\t/evil.example'},
      {fromPath: '/insecure', toPath: 'http://x.example'},
      {fromPath: '/a b', toPath: '/x'},
    ]);
    expect(kept.map((r) => r.fromPath)).toEqual(['/ok']);
  });

  it("follows only a relative destination that stays on the site, like the site's middleware", () => {
    expect(followed('/offers/a')).toBe(true);
    expect(followed('https://status.example.com')).toBe(true);
    expect(followed('//evil.example')).toBe(false);
    const sub = effectiveRules([{fromPath: '/promo', toPath: '/', matchSubpaths: true}]);
    expect(matchRedirect('/promo//evil.example', sub)).toEqual({toPath: '//evil.example', status: 307});
    expect(trace('/promo//evil.example', sub)).toMatchObject({hops: [], final: '/promo//evil.example', ignored: '//evil.example'});
  });
});

describe('trace', () => {
  it('follows chains and spots loops, including a path that keeps growing', () => {
    const r = effectiveRules([
      {fromPath: '/a', toPath: '/b'},
      {fromPath: '/b', toPath: '/c'},
      {fromPath: '/x', toPath: '/y'},
      {fromPath: '/y', toPath: '/x'},
      {fromPath: '/grow', toPath: '/grow/more', matchSubpaths: true},
    ]);
    expect(trace('/a', r)).toMatchObject({final: '/c', loop: false});
    expect(trace('/a', r).hops).toHaveLength(2);
    expect(trace('/x', r).loop).toBe(true);
    expect(trace('/grow', r).loop).toBe(true);
  });
});

describe('analyzeRules', () => {
  const rows: KeyedRule[] = [
    {key: 'a', fromPath: '/a', toPath: '/b'},
    {key: 'b', fromPath: '/b', toPath: '/c'},
    {key: 'dup', fromPath: '/A/', toPath: '/z'},
    {key: 'loop1', fromPath: '/x', toPath: '/y'},
    {key: 'loop2', fromPath: '/y', toPath: '/x'},
    {key: 'off', fromPath: '/off', toPath: '/z', enabled: false},
    {key: 'self', fromPath: '/s', toPath: '/s/'},
    {key: 'empty', fromPath: '/e', toPath: ''},
    {key: 'offsite', fromPath: '/o', toPath: '/\\evil.example'},
    {key: 'insecure', fromPath: '/i', toPath: 'http://x.example'},
    {key: 'spaced', fromPath: '/s p', toPath: '/x'},
  ];
  const issues = analyzeRules(rows);
  const codes = (key: string) => issues.get(key)?.map((i) => i.code);

  it('names each problem on the rule it belongs to', () => {
    expect(codes('a')).toEqual(['chain']);
    expect(codes('b')).toEqual([]);
    expect(codes('dup')).toEqual(['duplicate']);
    expect(codes('loop1')).toEqual(['loop']);
    expect(codes('off')).toEqual(['disabled']);
    expect(codes('self')).toEqual(['self']);
    expect(codes('empty')).toEqual(['invalid']);
  });

  it('shows a rule the site drops as ignored, never as fine', () => {
    expect(codes('offsite')).toEqual(['ignored']);
    expect(issues.get('offsite')?.[0].message).toMatch(/Ignored by the site: .* browsers can read as another website/);
    expect(codes('insecure')).toEqual(['ignored']);
    expect(issues.get('insecure')?.[0].message).toMatch(/https:\/\//);
    expect(codes('spaced')).toEqual(['ignored']);
  });
});

describe('validateNewRule', () => {
  const existing = [
    {fromPath: '/old', toPath: '/new'},
    {fromPath: '/b', toPath: '/a'},
    {fromPath: '/gone', toPath: '/x', enabled: false},
  ];
  const rule = (fromPath: string, toPath: string) => ({fromPath, toPath, permanent: true, matchSubpaths: false});

  it('normalizes and accepts a plain rule', () => {
    const v = validateNewRule(rule('promo-2026/', 'offers'), existing);
    expect(v.errors).toEqual({});
    expect(v.rule).toMatchObject({fromPath: '/promo-2026', toPath: '/offers'});
  });

  it('refuses the homepage, a duplicate, the same page and a loop', () => {
    expect(validateNewRule(rule('/', '/x'), existing).errors.fromPath).toMatch(/homepage/);
    expect(validateNewRule(rule('/OLD', '/x'), existing).errors.fromPath).toMatch(/already redirects/);
    expect(validateNewRule(rule('/p', '/p/'), existing).errors.toPath).toMatch(/same page/);
    expect(validateNewRule(rule('/a', '/b'), existing).errors.toPath).toMatch(/loop/);
  });

  it('refuses addresses the site needs or would drop', () => {
    expect(validateNewRule(rule('/api/redirects', '/x'), existing).errors.fromPath).toMatch(/needs this address/);
    expect(validateNewRule(rule('/robots.txt', '/x'), existing).errors.fromPath).toMatch(/needs this address/);
    expect(validateNewRule(rule('/x/__v_wx--a', '/y'), existing).errors.fromPath).toMatch(/experiments/);
    expect(validateNewRule(rule('/x?a=1', '/y'), existing).errors.fromPath).toMatch(/\?/);
    expect(validateNewRule(rule('/x', '/\\evil.example'), existing).errors.toPath).toMatch(/another website/);
    expect(validateNewRule(rule('/x', 'http://x.example'), existing).errors.toPath).toMatch(/https:\/\//);
    expect(validateNewRule(rule('/x', 'https://x.example'), existing).errors).toEqual({});
  });

  it('allows a path whose rule is disabled, and warns about a destination that redirects on', () => {
    expect(validateNewRule(rule('/gone', '/y'), existing).errors).toEqual({});
    expect(validateNewRule(rule('/legacy', '/old'), existing).warnings[0]).toMatch(/redirects to \/new/);
  });
});

describe('locale paths', () => {
  it('treats /en/x and /x as the same page', () => {
    expect(withoutLocale('/en/personal/', 'en')).toBe('/personal');
    expect(withoutLocale('/en', 'en')).toBe('/');
    expect(withoutLocale('/english', 'en')).toBeNull();
    expect(samePage('/personal/savings', '/en/personal/savings/', 'en')).toBe(true);
    expect(samePage('/a', '/b', 'en')).toBe(false);
  });
});
