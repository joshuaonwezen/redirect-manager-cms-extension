import {ActionError} from './errors';
import type {CmsClient, CmsVersion} from './cms';

type PropertyData = Record<string, {value?: unknown} | null>;

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
  const versions = await cms.listVersions(key, locale, 20);
  const live = versions.find((v) => v.status === 'published' && !v.variation);
  if (!live) throw new ActionError('not_published', `${label} has no published version to change.`);

  // Someone's unpublished edit, based on the old published version, would undo this change
  // when they publish it.
  const pending = versions.find((v) => !v.variation && Number(v.version) > Number(live.version) && v.status !== 'previous');
  if (pending) {
    throw new ActionError(
      'unpublished_changes',
      `${label} has unpublished changes (version ${pending.version}, ${pending.status}). Publish or discard them in the CMS first, or they would undo this change.`,
    );
  }

  await cms.createDraft(key, locale, live.displayName);
  const draft = newestDraftAfter(await cms.listVersions(key, locale, 5), live);
  if (!draft) throw new ActionError('no_draft', `The CMS didn't create a draft of ${label}. Try again.`);

  await cms.patchVersion(key, draft.version, {properties: change({...(live.properties ?? {})})});
  return {published: await cms.publish(key, draft.version), version: draft.version};
}

function newestDraftAfter(versions: CmsVersion[], live: CmsVersion): CmsVersion | undefined {
  return versions
    .filter((v) => v.status === 'draft' && !v.variation && Number(v.version) > Number(live.version))
    .sort((a, b) => Number(b.version) - Number(a.version))[0];
}
