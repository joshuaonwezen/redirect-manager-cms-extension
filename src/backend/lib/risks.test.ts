import {describe, expect, it} from 'vitest';

import {addRisks, hiddenPage, isBroad, unconfirmed} from './risks';

const rule = (fromPath: string, toPath: string, matchSubpaths = false) => ({fromPath, toPath, permanent: true, matchSubpaths});
const none = {hiddenPage: null, missingDestination: null};

describe('isBroad', () => {
  it('flags "and everything under it" on a top-level path only', () => {
    expect(isBroad(rule('/en', '/x', true))).toBe(true);
    expect(isBroad(rule('/personal', '/x', true))).toBe(true);
    expect(isBroad(rule('/en/promo', '/x', true))).toBe(false);
    expect(isBroad(rule('/en', '/x'))).toBe(false);
  });
});

describe('hiddenPage', () => {
  const pages = ['/en/about/', '/en/personal/savings/', '/mortgage/'];

  it('counts /x and /en/x as the same page', () => {
    expect(hiddenPage(rule('/about', '/x'), pages, 'en')).toBe('/en/about');
    expect(hiddenPage(rule('/en/mortgage', '/x'), pages, 'en')).toBe('/mortgage');
    expect(hiddenPage(rule('/old', '/x'), pages, 'en')).toBeNull();
  });

  it('includes the pages under a rule that matches subpaths', () => {
    expect(hiddenPage(rule('/personal', '/x', true), pages, 'en')).toBe('/en/personal/savings');
    expect(hiddenPage(rule('/personal', '/x'), pages, 'en')).toBeNull();
  });
});

describe('addRisks', () => {
  it('lists each risk once, in the order the editor is asked', () => {
    const risks = addRisks(rule('/en', 'https://other.example/x', true), {hiddenPage: '/en', missingDestination: null});
    expect(risks.map((r) => r.code)).toEqual(['external_destination', 'broad_subpaths', 'hides_page']);
    expect(risks[0].message).toMatch(/another website, other\.example/);
  });

  it('names a destination that is not on the site', () => {
    expect(addRisks(rule('/old', '/gone'), {...none, missingDestination: '/gone'})).toEqual([
      {code: 'destination_missing', message: expect.stringMatching(/\/gone doesn't exist on the site/)},
    ]);
    expect(addRisks(rule('/old', '/new'), none)).toEqual([]);
  });

  it('asks about each risk until it is confirmed', () => {
    const risks = addRisks(rule('/en', 'https://other.example', true), none);
    expect(unconfirmed(risks, [])?.code).toBe('external_destination');
    expect(unconfirmed(risks, ['external_destination'])?.code).toBe('broad_subpaths');
    expect(unconfirmed(risks, ['broad_subpaths', 'external_destination'])).toBeNull();
  });
});
