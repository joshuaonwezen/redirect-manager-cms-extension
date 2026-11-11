import type {CmsClient, CmsVersion} from './cms';
import {ActionError} from './errors';
import {ApiError} from './http';

type PropertyData = Record<string, {value?: unknown} | null>;

/** A 403 on a write becomes a readable refusal; anything else is rethrown as it is. */
export function writeDenied(error: unknown): never {
  if (error instanceof ApiError && error.status === 403) {
    throw new ActionError(
      'cms_write_denied',
      'The CMS API key in the app settings can read content but not change it. Ask a CMS admin for a key with content write access.',
    );
  }
  throw error;
}

/**
 * The published base version of `key`, checked BEFORE anything is written: someone's
 * unpublished edit, based on the old published version, would undo a change made on top of
 * it when they publish it.
 */
export async function publishedForChange(cms: CmsClient, key: string, locale: string, label: string): Promise<CmsVersion> {
  const versions = await cms.listVersions(key, locale, 20);
  const live = versions.find((v) => v.status === 'published' && !v.variation);
  if (!live) throw new ActionError('not_published', `${label} has no published version to change.`);

  const pending = versions.find((v) => !v.variation && Number(v.version) > Number(live.version) && v.status !== 'previous');
  if (pending) {
    throw new ActionError(
      'unpublished_changes',
      `${label} has unpublished changes (version ${pending.version}, ${pending.status}). Publish or discard them in the CMS first, or they would undo this change.`,
    );
  }
  return live;
}

/**
 * Publishes a new version of `key` with some properties changed and every other one kept.
 *
 * POST /versions makes a BLANK draft - it does not copy the properties of the published
 * version - so publishing a partial patch would wipe the rest. This is the site's
 * patchPublishedPageProperties() (scripts/_shared.ts): read the published properties, make
 * the draft, merge-patch the full set onto it, publish.
 */
export async function publishWithChanges(
  cms: CmsClient,
  key: string,
  locale: string,
  label: string,
  change: (current: PropertyData) => PropertyData,
): Promise<{published: boolean; version: string}> {
  const live = await publishedForChange(cms, key, locale, label);
  try {
    const version = await cms.createBaseDraft(key, locale, {displayName: live.displayName});
    await cms.patchVersion(key, version, {properties: change({...(live.properties ?? {})})});
    return {published: (await cms.publishVersion(key, version)) === 'published', version};
  } catch (error) {
    return writeDenied(error);
  }
}
