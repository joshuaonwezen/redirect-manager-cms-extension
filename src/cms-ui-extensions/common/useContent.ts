import type {ContentState, ExtensionContext} from '@optimizely/cms-extensibility-sdk';
import {pathFromPublicUrl} from '@shared/path';
import {useEffect, useState} from 'react';

export interface OpenContent {
  /** 32 hex characters: the editor reports keys with or without dashes. */
  key: string;
  version: string | null;
  locale: string;
  /** Site path of the item; null for content with no URL (a block). */
  path: string | null;
}

function toOpen(state: ContentState): OpenContent | null {
  if (!state?.key) return null;
  return {
    key: state.key.replace(/-/g, '').toLowerCase(),
    version: state.version ?? null,
    locale: state.locale || 'en',
    path: pathFromPublicUrl(state.publicUrl),
  };
}

function same(a: OpenContent | null, b: OpenContent | null): boolean {
  return a?.key === b?.key && a?.version === b?.version && a?.locale === b?.locale && a?.path === b?.path;
}

/**
 * The item open in the editor, kept current as the editor switches item, locale or
 * version (a variation is a version). `ready` turns true once the editor has answered,
 * so a panel can tell "still loading" from "nothing is open". Also signals readiness to
 * the CMS host.
 */
export function useContent(context: ExtensionContext): {content: OpenContent | null; ready: boolean} {
  const [content, setContent] = useState<OpenContent | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void context.extension.setReady();
    const apply = (state: ContentState) => {
      const next = toOpen(state);
      setContent((prev) => (same(prev, next) ? prev : next));
      setReady(true);
    };
    void context.content.get().then(apply);
    return context.content.subscribe(apply);
  }, [context]);

  return {content, ready};
}
