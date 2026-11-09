import {describe, expect, it} from 'vitest';

import type {CmsClient, CmsVersion} from './cms';
import {publishWithChanges} from './writes';

function fakeCms(initial: CmsVersion[], {approval = false} = {}) {
  let versions = [...initial];
  const calls: string[] = [];
  const patches: unknown[] = [];
  const cms = {
    async listVersions() {
      return [...versions].sort((a, b) => Number(b.version) - Number(a.version));
    },
    async createDraft(key: string, locale: string) {
      calls.push(`draft ${key} ${locale}`);
      const next = String(Math.max(...versions.map((v) => Number(v.version))) + 1);
      versions = [...versions, {key, version: next, locale, status: 'draft'}];
    },
    async patchVersion(key: string, version: string, body: unknown) {
      calls.push(`patch ${version}`);
      patches.push(body);
    },
    async publish(_key: string, version: string) {
      calls.push(`publish ${version}`);
      return !approval;
    },
  };
  return {cms: cms as unknown as CmsClient, calls, patches};
}

const published: CmsVersion = {
  key: 'k',
  version: '10',
  locale: 'en',
  status: 'published',
  displayName: 'Redirect Config',
  properties: {notes: {value: 'Keep me'}, rules: {value: [{reference: 'cms://content/a'}]}},
};

describe('publishWithChanges', () => {
  it('patches the FULL property set onto the new draft and publishes it', async () => {
    const {cms, calls, patches} = fakeCms([published, {...published, version: '9', status: 'previous'}]);
    const result = await publishWithChanges(cms, 'k', 'en', 'Redirect Config', (p) => ({
      ...p,
      rules: {value: [...(p.rules?.value as unknown[]), {reference: 'cms://content/b'}]},
    }));
    expect(result).toEqual({published: true, version: '11'});
    expect(calls).toEqual(['draft k en', 'patch 11', 'publish 11']);
    expect(patches[0]).toEqual({
      properties: {
        notes: {value: 'Keep me'},
        rules: {value: [{reference: 'cms://content/a'}, {reference: 'cms://content/b'}]},
      },
    });
  });

  it("refuses when someone else's unpublished version is newer", async () => {
    const {cms, calls} = fakeCms([published, {key: 'k', version: '12', locale: 'en', status: 'draft'}]);
    await expect(publishWithChanges(cms, 'k', 'en', 'Redirect Config', (p) => p)).rejects.toThrow(/unpublished changes/);
    expect(calls).toEqual([]);
  });

  it('reports a version left for approval', async () => {
    const {cms} = fakeCms([published], {approval: true});
    expect(await publishWithChanges(cms, 'k', 'en', 'Redirect Config', (p) => p)).toEqual({published: false, version: '11'});
  });
});
