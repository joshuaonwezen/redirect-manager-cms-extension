import {describe, expect, it} from 'vitest';

import type {CmsClient, CmsVersion} from './cms';
import {ApiError} from './http';
import {createManager, type ManagerDeps} from './manager';

const LIST = 'c'.repeat(32);
const RULE = 'a'.repeat(32);

type Props = Record<string, {value?: unknown} | null>;

/** An in-memory CMS: items with versions, recording every write in order. */
class FakeCms {
  public readonly writes: string[] = [];
  public readonly versions = new Map<string, CmsVersion[]>();
  public failPatch = new Set<string>();
  /** Runs right after a version of `key` is published: another editor acting at that moment. */
  public afterPublish: (key: string) => void = () => undefined;

  public name(key: string) {
    return key === LIST ? 'list' : key === RULE ? 'rule' : 'new rule';
  }

  public add(key: string, version: Partial<CmsVersion> & {properties?: Props}) {
    const list = this.versions.get(key) ?? [];
    list.push({key, locale: 'en', version: String(list.length + 1), status: 'published', ...version});
    this.versions.set(key, list);
  }

  public newestPublished(key: string) {
    return [...(this.versions.get(key) ?? [])].reverse().find((v) => v.status === 'published');
  }

  public async getItem(key: string) {
    return this.versions.has(key) ? {key, container: 'folder', primaryLocale: 'en', locales: ['en']} : null;
  }

  public async listVersions(key: string) {
    return [...(this.versions.get(key) ?? [])].sort((a, b) => Number(b.version) - Number(a.version));
  }

  public async getVersion(key: string, version: string) {
    return this.versions.get(key)?.find((v) => v.version === version) ?? null;
  }

  public async createContent(body: {key: string; initialVersion: {displayName: string; properties: Props}}) {
    this.writes.push(`create ${body.initialVersion.displayName}`);
    this.add(body.key, {status: 'draft', properties: body.initialVersion.properties});
    return '1';
  }

  public async createBaseDraft(key: string) {
    this.writes.push(`draft ${this.name(key)}`);
    this.add(key, {status: 'draft', properties: {}});
    return String(this.versions.get(key)!.length);
  }

  public async patchVersion(key: string, version: string, body: {properties: Props}) {
    if (this.failPatch.has(key)) throw new ApiError(500, 'cms_unavailable', 'Update version: HTTP 500');
    this.writes.push(`patch ${this.name(key)}`);
    (await this.getVersion(key, version))!.properties = body.properties;
  }

  public async publishVersion(key: string, version: string) {
    this.writes.push(`publish ${this.name(key)}`);
    for (const v of this.versions.get(key) ?? []) if (v.status === 'published') v.status = 'previous';
    (await this.getVersion(key, version))!.status = 'published';
    this.afterPublish(key);
    return 'published' as const;
  }
}

const refs = (v: CmsVersion | undefined) => ((v?.properties?.rules?.value ?? []) as Array<{reference: string}>).map((r) => r.reference);

function setup({pages = [] as string[], missing = [] as string[]} = {}) {
  const cms = new FakeCms();
  cms.add(LIST, {displayName: 'Redirect Config', properties: {notes: {value: 'n'}, rules: {value: [{reference: `cms://content/${RULE}`}]}}});
  cms.add(RULE, {
    displayName: 'Redirect: /old',
    properties: {fromPath: {value: '/old'}, toPath: {value: '/new'}, permanent: {value: true}, enabled: {value: true}},
  });
  const deps: ManagerDeps = {
    cms: cms as unknown as CmsClient,
    redirectConfigs: async () => [{key: LIST, lastModified: null, notes: '', rules: []}],
    ruleBlocks: async () => new Map(),
    pageUrls: async () => pages,
    siteStatus: async (path) => ({status: missing.includes(path) ? 404 : 200, location: null}),
    liveRules: async () => [],
  };
  const manager = createManager({siteUrl: 'https://site.example', graph: {singleKey: 'k'}, cms: {clientId: 'i', clientSecret: 's'}}, deps);
  return {cms, manager};
}

const add = (fromPath: string, toPath: string, confirm: string[] = [], matchSubpaths = false) =>
  ({fromPath, toPath, permanent: true, matchSubpaths, confirm}) as Parameters<ReturnType<typeof createManager>['addRule']>[0];

describe('addRule', () => {
  it('adds the rule, then appends it to the list, and checks the list it published', async () => {
    const {cms, manager} = setup();
    const result = await manager.addRule(add('/promo', '/offers'));
    expect(cms.writes).toEqual(['create Redirect: /promo', 'publish new rule', 'draft list', 'patch list', 'publish list']);
    expect(result).toMatchObject({published: true, rule: {fromPath: '/promo', toPath: '/offers', enabled: true}});
    expect(refs(cms.newestPublished(LIST))).toEqual([`cms://content/${RULE}`, `cms://content/${result.rule.key}`]);
    // The full property set rides along, not just the rules.
    expect(cms.newestPublished(LIST)?.properties?.notes).toEqual({value: 'n'});
  });

  it('checks the list for unpublished changes BEFORE creating the rule', async () => {
    const {cms, manager} = setup();
    cms.add(LIST, {status: 'draft'});
    await expect(manager.addRule(add('/promo', '/offers'))).rejects.toMatchObject({code: 'unpublished_changes'});
    expect(cms.writes).toEqual([]);
  });

  it('asks before sending visitors to another website, and goes ahead once confirmed', async () => {
    const {cms, manager} = setup();
    await expect(manager.addRule(add('/status', 'https://status.example.com'))).rejects.toMatchObject({
      code: 'external_destination',
    });
    expect(cms.writes).toEqual([]);
    await expect(manager.addRule(add('/status', 'https://status.example.com', ['external_destination']))).resolves.toMatchObject({
      published: true,
    });
  });

  it('asks before hiding a published page and before a destination that is not there', async () => {
    const {manager} = setup({pages: ['/en/promo/'], missing: ['/offers']});
    await expect(manager.addRule(add('/promo', '/offers'))).rejects.toMatchObject({code: 'hides_page'});
    await expect(manager.addRule(add('/promo', '/offers', ['hides_page']))).rejects.toMatchObject({code: 'destination_missing'});
    await expect(manager.addRule(add('/promo', '/offers', ['hides_page', 'destination_missing']))).resolves.toMatchObject({
      published: true,
    });
  });

  it('asks before redirecting a whole section', async () => {
    const {manager} = setup();
    await expect(manager.addRule(add('/personal', '/new', [], true))).rejects.toMatchObject({code: 'broad_subpaths'});
  });

  it('says so when the list it published does not carry the rule', async () => {
    const {cms, manager} = setup();
    // Another editor publishes the old list right after ours.
    cms.afterPublish = (key) => {
      if (key !== LIST || cms.writes.filter((w) => w === 'publish list').length > 1) return;
      cms.writes.push('publish list');
      for (const v of cms.versions.get(LIST)!) if (v.status === 'published') v.status = 'previous';
      cms.add(LIST, {properties: {rules: {value: [{reference: `cms://content/${RULE}`}]}}});
    };
    await expect(manager.addRule(add('/promo', '/offers'))).rejects.toMatchObject({code: 'list_check_failed'});
  });
});

describe('setEnabled', () => {
  it('reports plainly when the rule changed but the list could not be republished', async () => {
    const {cms, manager} = setup();
    cms.failPatch.add(LIST);
    const result = await manager.setEnabled({ruleKey: RULE, enabled: false});
    expect(result).toMatchObject({published: true, partial: true, rule: {key: RULE, enabled: false}});
    expect(result.message).toMatch(/Disabled \/old, but refreshing the site's redirect list failed/);
    expect(cms.newestPublished(RULE)?.properties?.enabled).toEqual({value: false});
    expect(cms.newestPublished(RULE)?.properties?.fromPath).toEqual({value: '/old'});
  });

  it('refuses before changing the rule when the list has unpublished changes', async () => {
    const {cms, manager} = setup();
    cms.add(LIST, {status: 'draft'});
    await expect(manager.setEnabled({ruleKey: RULE, enabled: false})).rejects.toMatchObject({code: 'unpublished_changes'});
    expect(cms.writes).toEqual([]);
  });

  it('republishes the rule, then the list', async () => {
    const {cms, manager} = setup();
    expect(await manager.setEnabled({ruleKey: RULE, enabled: false})).toMatchObject({published: true});
    expect(cms.writes).toEqual(['draft rule', 'patch rule', 'publish rule', 'draft list', 'patch list', 'publish list']);
  });
});
