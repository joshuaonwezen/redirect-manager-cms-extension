import {ApiError, requestJson} from './http';

const GRAPH = 'https://cg.optimizely.com/content/v2';
const PAGE_LIMIT = 100;
const MAX_PAGES = 20;

export interface GraphConfig {
  singleKey: string;
}

export async function graphQuery<T>(cfg: GraphConfig, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const body = await requestJson<{data?: T; errors?: Array<{message?: string}>}>(
    'graph',
    'Graph query',
    `${GRAPH}?auth=${encodeURIComponent(cfg.singleKey)}`,
    {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({query, variables})},
  );
  if (body?.errors?.length) {
    throw new ApiError(400, 'graph_rejected', `Graph query: ${body.errors.map((e) => e.message).join('; ').slice(0, 300)}`);
  }
  if (!body?.data) throw new ApiError(502, 'graph_unavailable', 'Graph query: no data in the response');
  return body.data;
}

// Newest first, like the site's GetRedirectRules: the site reads items[0] only. No `where` on
// `enabled` - a field Graph hasn't synced as queryable errors the whole query.
const REDIRECT_CONFIGS = /* GraphQL */ `
  query RedirectConfigs {
    RedirectConfig(orderBy: {_metadata: {lastModified: DESC}}, limit: 10) {
      items {
        _metadata {
          key
          lastModified
        }
        notes
        rules {
          ... on RedirectRule {
            _metadata {
              key
              displayName
            }
            fromPath
            toPath
            permanent
            matchSubpaths
            enabled
            note
          }
        }
      }
    }
  }
`;

export interface GraphRule {
  key: string;
  displayName: string;
  fromPath: string;
  toPath: string;
  permanent: boolean;
  matchSubpaths: boolean;
  enabled: boolean;
  note: string;
}

export interface GraphConfigItem {
  key: string;
  lastModified: string | null;
  notes: string;
  rules: GraphRule[];
}

interface RawRule {
  _metadata?: {key?: string; displayName?: string};
  fromPath?: string | null;
  toPath?: string | null;
  permanent?: boolean | null;
  matchSubpaths?: boolean | null;
  enabled?: boolean | null;
  note?: string | null;
}

export async function redirectConfigs(cfg: GraphConfig): Promise<GraphConfigItem[]> {
  const data = await graphQuery<{
    RedirectConfig?: {
      items?: Array<{_metadata?: {key?: string; lastModified?: string}; notes?: string | null; rules?: Array<RawRule | null> | null}>;
    };
  }>(cfg, REDIRECT_CONFIGS);
  return (data.RedirectConfig?.items ?? []).map((item) => ({
    key: item._metadata?.key ?? '',
    lastModified: item._metadata?.lastModified ?? null,
    notes: item.notes ?? '',
    rules: (item.rules ?? [])
      .filter((r): r is RawRule => !!r?._metadata?.key)
      .map((r) => ({
        key: r._metadata!.key!,
        displayName: r._metadata?.displayName ?? '',
        fromPath: r.fromPath ?? '',
        toPath: r.toPath ?? '',
        permanent: r.permanent === true,
        // The site treats a missing value as enabled (`enabled !== false`).
        enabled: r.enabled !== false,
        matchSubpaths: r.matchSubpaths === true,
        note: r.note ?? '',
      })),
  }));
}

const RULE_BLOCKS = /* GraphQL */ `
  query RuleBlocks($keys: [String]) {
    RedirectRule(where: {_metadata: {key: {in: $keys}}}, limit: 100) {
      items {
        _metadata {
          key
        }
        fromPath
        toPath
        permanent
        matchSubpaths
        enabled
      }
    }
  }
`;

/**
 * The rule blocks themselves. Graph copies each rule into Redirect Config when it indexes the
 * config, and keeps that copy when only the rule is published again - so the two can differ.
 */
export async function ruleBlocks(cfg: GraphConfig, keys: string[]): Promise<Map<string, GraphRule>> {
  if (keys.length === 0) return new Map();
  const data = await graphQuery<{RedirectRule?: {items?: RawRule[]}}>(cfg, RULE_BLOCKS, {keys});
  return new Map(
    (data.RedirectRule?.items ?? [])
      .filter((r) => r._metadata?.key)
      .map((r) => [
        r._metadata!.key!,
        {
          key: r._metadata!.key!,
          displayName: '',
          fromPath: r.fromPath ?? '',
          toPath: r.toPath ?? '',
          permanent: r.permanent === true,
          enabled: r.enabled !== false,
          matchSubpaths: r.matchSubpaths === true,
          note: '',
        },
      ]),
  );
}

const PAGE_URLS = /* GraphQL */ `
  query PageUrls($cursor: String) {
    _Content(locale: [ALL], where: {_metadata: {types: {in: ["_Page", "_Experience"]}}}, limit: ${PAGE_LIMIT}, cursor: $cursor) {
      cursor
      items {
        _metadata {
          url {
            default
          }
        }
      }
    }
  }
`;

/** Every published page URL on the instance, as Graph indexes them (e.g. /en/about/). */
export async function pageUrls(cfg: GraphConfig): Promise<string[]> {
  const urls: string[] = [];
  let cursor: string | null = '';
  for (let page = 0; page < MAX_PAGES && cursor !== null; page++) {
    const data: {_Content?: {cursor?: string | null; items?: Array<{_metadata?: {url?: {default?: string | null}}}>}} =
      await graphQuery(cfg, PAGE_URLS, {cursor: cursor || null});
    const items = data._Content?.items ?? [];
    for (const item of items) if (item._metadata?.url?.default) urls.push(item._metadata.url.default);
    cursor = items.length === PAGE_LIMIT ? data._Content?.cursor ?? null : null;
  }
  return urls;
}

/** Throws ApiError when the key is rejected. */
export async function checkKey(cfg: GraphConfig): Promise<void> {
  await graphQuery(cfg, '{ _Content(limit: 1) { total } }');
}
