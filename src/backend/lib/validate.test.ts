import {describe, expect, it} from 'vitest';

import {isAction, PARSERS} from './validate';

const KEY = '3525e1552b6f46158be2850ff6e6fb74';
const rule = (fromPath: unknown, toPath: unknown, extra: Record<string, unknown> = {}) => ({fromPath, toPath, ...extra});

describe('pageRedirects', () => {
  it('normalizes the key, defaults the locale and drops unknown fields', () => {
    expect(PARSERS.pageRedirects({key: '3525E155-2b6f-4615-8be2-850ff6e6fb74', path: '/en/about', extra: 1})).toEqual({
      key: KEY,
      locale: 'en',
      path: '/en/about',
    });
  });

  it('rejects values that would reach a CMS URL', () => {
    expect(() => PARSERS.pageRedirects({key: '../../v1/contenttypes', path: '/x'})).toThrow(/content key/);
    expect(() => PARSERS.pageRedirects({key: KEY, locale: 'en/../x', path: '/x'})).toThrow(/language code/);
    expect(() => PARSERS.pageRedirects({key: KEY, path: `/${'a'.repeat(2048)}`})).toThrow(/2048/);
    expect(() => PARSERS.pageRedirects({key: KEY, path: '/\\evil.example'})).toThrow(/path/);
  });
});

describe('testUrl', () => {
  it('turns an address that does not parse into a plain refusal', () => {
    expect(() => PARSERS.testUrl({url: 'https://exa mple.com/x'})).toThrow(expect.objectContaining({code: 'invalid_url'}));
    expect(() => PARSERS.testUrl({url: 'javascript:alert(1)'})).toThrow(expect.objectContaining({code: 'invalid_url'}));
    expect(() => PARSERS.testUrl({url: 'x'.repeat(2049)})).toThrow(/2048/);
    expect(PARSERS.testUrl({url: ' /savings '})).toEqual({url: '/savings'});
  });
});

describe('addRule', () => {
  it('accepts a plain rule and keeps only known fields', () => {
    expect(PARSERS.addRule(rule('/old', '/new', {permanent: true, note: ' why ', extra: 1}))).toEqual({
      fromPath: '/old',
      toPath: '/new',
      permanent: true,
      matchSubpaths: false,
      note: 'why',
      confirm: [],
    });
    expect(PARSERS.addRule(rule('/status', 'https://status.example.com/', {confirm: ['external_destination']}))).toMatchObject({
      toPath: 'https://status.example.com/',
      confirm: ['external_destination'],
    });
  });

  it.each([
    ['old', /starting with \//],
    ['/', /homepage/],
    ['/a b', /spaces/],
    ['/a\\b', /backslashes/],
    ['/a\u0007b', /hidden/],
    ['/old?x=1', /\?/],
    ['/old#top', /#/],
    ['/api/redirects', /needs this address/],
    ['/_next/static/x.js', /needs this address/],
    ['/robots.txt', /needs this address/],
    ['/favicon.ico', /needs this address/],
    ['/sitemap.xml', /needs this address/],
    ['/x/__v_homepage--business', /experiments/],
  ])('refuses %j as From', (fromPath, why) => {
    expect(() => PARSERS.addRule(rule(fromPath, '/new'))).toThrow(why);
  });

  it.each([
    ['new', /starting with \//],
    ['http://x.example', /https:\/\//],
    ['/\\evil.example', /backslashes/],
    ['/\t/evil.example', /hidden|spaces/],
    ['https://exa mple.com', /spaces/],
    ['https://', /valid web address/],
    ['javascript:alert(1)', /starting with \//],
  ])('refuses %j as To', (toPath, why) => {
    expect(() => PARSERS.addRule(rule('/old', toPath))).toThrow(why);
  });

  it("accepts the sidebar's page URL only as an https address", () => {
    expect(PARSERS.addRule(rule('/old', '/new', {pageUrl: 'https://www.example.com/en/new/'}))).toMatchObject({
      pageUrl: 'https://www.example.com/en/new/',
    });
    expect(PARSERS.addRule(rule('/old', '/new', {pageUrl: ''})).pageUrl).toBeUndefined();
    expect(() => PARSERS.addRule(rule('/old', '/new', {pageUrl: 'http://www.example.com/x'}))).toThrow(/https/);
    expect(() => PARSERS.addRule(rule('/old', '/new', {pageUrl: 'not a url'}))).toThrow(/web address/);
    expect(() => PARSERS.addRule(rule('/old', '/new', {pageUrl: `https://x.example/${'a'.repeat(2048)}`}))).toThrow(/2048/);
    expect(() => PARSERS.addRule(rule('/old', '/new', {pageUrl: 42}))).toThrow(/text/);
  });

  it('caps the note and accepts only known confirmations', () => {
    expect(() => PARSERS.addRule(rule('/old', '/new', {note: 'x'.repeat(501)}))).toThrow(/500/);
    expect(() => PARSERS.addRule(rule('/old', '/new', {confirm: ['everything']}))).toThrow(/confirmation/);
    expect(() => PARSERS.addRule(rule('/old', '/new', {confirm: 'hides_page'}))).toThrow(/list/);
  });
});

describe('setEnabled', () => {
  it('checks the rule key and reads enabled strictly', () => {
    expect(PARSERS.setEnabled({ruleKey: KEY.toUpperCase(), enabled: 'true'})).toEqual({ruleKey: KEY, enabled: false});
    expect(() => PARSERS.setEnabled({ruleKey: 'x/../y', enabled: true})).toThrow(/content key/);
  });
});

describe('isAction', () => {
  it('knows the five actions and nothing inherited', () => {
    expect(isAction('addRule')).toBe(true);
    expect(isAction('toString')).toBe(false);
  });
});
