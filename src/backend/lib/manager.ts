import {randomUUID} from 'node:crypto';

import {
  analyzeRules,
  effectiveRules,
  isAbsolute,
  matchRule,
  norm,
  normalizeRedirectPath,
  samePage,
  trace,
  validateNewRule,
  withoutLocale,
  type AddConfirm,
  type KeyedRule,
  type NewRule,
  type RedirectRule,
  type RuleIssue,
} from '../../shared/redirects';
import type {AddRuleParams, Overview, PageRedirects, RuleRow, TestResult, WriteResult} from '../../shared/types';
import {CmsClient, type CmsItem} from './cms';
import {ActionError} from './errors';
import {pageUrls, redirectConfigs, ruleBlocks, type GraphConfigItem, type GraphRule} from './graph';
import {addRisks, hiddenPage, unconfirmed, type AddRisk} from './risks';
import type {LoadedSettings} from './settings';
import {liveRules, siteStatus} from './site';
import {pickSiteUrl, siteOrigins, type SiteOrigins} from './siteUrl';
import {publishedForChange, publishWithChanges, writeDenied} from './writes';

const CONCURRENCY = 6;
const REF = /^cms:\/\/content\/([0-9a-f]{32})/i;

/** The Redirect Config in editor words: the one list of rules the site reads. */
const LIST = "The site's redirect list";

// When the site picks a change up: right away if the CMS publish webhook reaches it, else when
// its cached /api/redirects expires (the site's 1-hour ceiling).
const LIVE_HINT = 'It goes live on the site within a minute, or within the hour at the latest.';

// Why the site for a request is unknown: no saved Site URL, and the CMS's applications don't
// single one out. From the sidebar, the open page's host wasn't one of them.
const SITE_UNKNOWN_PAGE =
  "This page's address isn't one of this CMS's sites. Ask a CMS admin to set the Site URL in the app settings.";
const SITE_UNKNOWN_SEVERAL =
  "This CMS has more than one site. Ask a CMS admin to set the Site URL in the app settings to choose which site's redirects to check.";
const SITE_UNKNOWN_NONE =
  'This CMS has no site address in Settings > Applications. Ask a CMS admin to add one there, or to set the Site URL in the app settings.';

const NO_ORIGINS: SiteOrigins = {all: [], primary: []};

/** Everything the manager reads or writes through: the real clients, or fakes in tests. */
export interface ManagerDeps {
  cms: CmsClient;
  redirectConfigs: () => Promise<GraphConfigItem[]>;
  ruleBlocks: (keys: string[]) => Promise<Map<string, GraphRule>>;
  pageUrls: () => Promise<string[]>;
  siteStatus: (siteUrl: string, path: string) => Promise<{status: number | null; location: string | null}>;
  liveRules: (siteUrl: string) => Promise<RedirectRule[] | null>;
}

export function defaultDeps(cfg: LoadedSettings): ManagerDeps {
  return {
    cms: new CmsClient(cfg.cms),
    redirectConfigs: () => redirectConfigs(cfg.graph),
    ruleBlocks: (keys) => ruleBlocks(cfg.graph, keys),
    pageUrls: () => pageUrls(cfg.graph),
    siteStatus,
    liveRules,
  };
}

type FreshRule = KeyedRule & RedirectRule & {enabled: boolean};

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker));
  return results;
}

/** A rule's identity as the site applies it, to compare saved rules with the served ones. */
const signature = (r: RedirectRule) => `${norm(r.fromPath)}|${r.toPath}|${r.permanent}|${r.matchSubpaths}`;
const sameRule = (a: RedirectRule & {enabled: boolean}, b: RedirectRule & {enabled: boolean}) =>
  signature(a) === signature(b) && a.enabled === b.enabled;

function wrap(values: Record<string, unknown>): Record<string, {value: unknown}> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined).map(([k, v]) => [k, {value: v}]));
}

function refsOf(rules: unknown): Array<{reference: string}> {
  return Array.isArray(rules) ? rules.filter((r): r is {reference: string} => typeof r?.reference === 'string') : [];
}

const refKeys = (rules: unknown) =>
  refsOf(rules)
    .map((r) => REF.exec(r.reference)?.[1]?.toLowerCase())
    .filter((k): k is string => Boolean(k));

function statusText(result: {status: number | null; location: string | null}): {status: number | null; text: string; ok: boolean} {
  const {status, location} = result;
  if (status === null) return {status, text: 'The site did not answer.', ok: false};
  if (status >= 200 && status < 300) return {status, text: 'Opens.', ok: true};
  if (status === 404 || status === 410) return {status, text: 'Not found: visitors get a "page not found".', ok: false};
  if (location) return {status, text: `The site sends it on to ${location} by itself, not through these redirects.`, ok: true};
  return {status, text: status < 400 ? 'Opens.' : 'The site answers with an error.', ok: status < 400};
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : 'unknown error');

export function createManager(cfg: LoadedSettings, deps: ManagerDeps = defaultDeps(cfg)) {
  const {cms} = deps;

  /**
   * The site this request checks: the saved Site URL, else the open page's own site (from the
   * sidebar), else the CMS's only site. Resolved only by the actions that reach the site, so
   * reading a page's redirects or switching one never depends on it.
   */
  async function siteFor(pageUrl?: string): Promise<string> {
    const origins = cfg.siteUrl ? NO_ORIGINS : await siteOrigins(cfg.cms.clientId, () => cms.listApplications());
    const site = pickSiteUrl(cfg.siteUrl, pageUrl, origins);
    if (site) return site;
    throw new ActionError(
      'site_unknown',
      pageUrl ? SITE_UNKNOWN_PAGE : origins.primary.length === 0 ? SITE_UNKNOWN_NONE : SITE_UNKNOWN_SEVERAL,
    );
  }

  async function current(): Promise<{config: GraphConfigItem | null; ignored: number}> {
    const configs = await deps.redirectConfigs();
    return {config: configs[0] ?? null, ignored: Math.max(0, configs.length - 1)};
  }

  function toRows(config: GraphConfigItem, extra = new Map<string, RuleIssue[]>()): RuleRow[] {
    const found = analyzeRules(config.rules);
    return config.rules.map((r) => ({...r, issues: [...(found.get(r.key) ?? []), ...(extra.get(r.key) ?? [])]}));
  }

  /** The config the site reads, and its rules, straight from the CMS: Graph lags behind a write by up to a minute. */
  async function fresh(): Promise<{configKey: string; item: CmsItem; locale: string; rules: FreshRule[]}> {
    const {config} = await current();
    if (!config) {
      throw new ActionError('no_config', "This site has no redirect list yet, so redirects can't be added here. A developer sets it up once.");
    }
    const item = await cms.getItem(config.key);
    if (!item?.container) throw new ActionError('no_config', "The CMS doesn't have the site's redirect list yet. Wait a minute and try again.");
    const locale = item.primaryLocale || item.locales?.find(Boolean) || 'en';
    const live = (await cms.listVersions(config.key, locale, 10)).find((v) => v.status === 'published' && !v.variation);
    const rules = (
      await mapLimit(refKeys(live?.properties?.rules?.value), CONCURRENCY, async (key) => {
        const rule = (await cms.listVersions(key, locale, 10)).find((v) => v.status === 'published' && !v.variation);
        const p = rule?.properties ?? {};
        const value = (name: string) => p[name]?.value;
        return rule
          ? {
              key,
              fromPath: String(value('fromPath') ?? ''),
              toPath: String(value('toPath') ?? ''),
              permanent: value('permanent') === true,
              matchSubpaths: value('matchSubpaths') === true,
              enabled: value('enabled') !== false,
            }
          : null;
      })
    ).filter((r): r is FreshRule => r !== null);
    return {configKey: config.key, item, locale, rules};
  }

  /** The destination's final stop, when it is a page on the site that doesn't exist. */
  async function missingDestination(rule: NewRule, rules: FreshRule[], pageUrl: string | undefined): Promise<string | null> {
    const t = trace(rule.toPath, effectiveRules(rules));
    if (t.loop || t.ignored || isAbsolute(t.final)) return null;
    const {status} = await deps.siteStatus(await siteFor(pageUrl), t.final);
    return status === 404 || status === 410 ? t.final : null;
  }

  /** The first risk of adding `rule` the editor hasn't confirmed. The network checks run only when needed. */
  async function firstRisk(
    rule: NewRule,
    rules: FreshRule[],
    locale: string,
    confirm: AddConfirm[],
    pageUrl: string | undefined,
  ): Promise<AddRisk | null> {
    const early = unconfirmed(addRisks(rule, {hiddenPage: null, missingDestination: null}), confirm);
    if (early) return early;
    const [pages, missing] = await Promise.all([
      confirm.includes('hides_page') ? [] : deps.pageUrls().catch(() => [] as string[]),
      confirm.includes('destination_missing') ? null : missingDestination(rule, rules, pageUrl),
    ]);
    return unconfirmed(addRisks(rule, {hiddenPage: hiddenPage(rule, pages, locale), missingDestination: missing}), confirm);
  }

  /** Creates and publishes the rule block; true when published, false when it waits for approval. */
  async function createRule(ruleKey: string, rule: NewRule, container: string, locale: string): Promise<boolean> {
    try {
      const created = await cms.createContent({
        key: ruleKey,
        contentType: 'RedirectRule',
        container,
        initialVersion: {
          locale,
          displayName: `Redirect: ${rule.fromPath}`,
          properties: wrap({
            fromPath: rule.fromPath,
            toPath: rule.toPath,
            permanent: rule.permanent,
            matchSubpaths: rule.matchSubpaths,
            enabled: true,
            note: rule.note || `Added from the Redirects extension, ${new Date().toISOString().slice(0, 10)}.`,
          }),
        },
      });
      const version = created ?? (await cms.listVersions(ruleKey, locale, 1))[0]?.version;
      if (!version) {
        throw new ActionError(
          'create_failed',
          `The CMS saved "Redirect: ${rule.fromPath}" but gave no version to publish. Publish it in the CMS and add it to the site's redirect list.`,
        );
      }
      return (await cms.publishVersion(ruleKey, version)) === 'published';
    } catch (error) {
      return writeDenied(error);
    }
  }

  return {
    async overview(): Promise<Overview> {
      const siteUrl = await siteFor();
      const [{config, ignored}, live, urls] = await Promise.all([
        current(),
        deps.liveRules(siteUrl),
        deps.pageUrls().catch(() => [] as string[]),
      ]);
      const checkedAt = new Date().toISOString();
      if (!config) return {config: null, ignoredConfigs: 0, rules: [], live: null, siteUrl, checkedAt};

      const extra = new Map<string, RuleIssue[]>();
      const add = (key: string, issue: RuleIssue) => extra.set(key, [...(extra.get(key) ?? []), issue]);

      const blocks = await deps.ruleBlocks(config.rules.map((r) => r.key)).catch(() => new Map<string, GraphRule>());
      for (const r of config.rules) {
        const block = blocks.get(r.key);
        if (block && !sameRule(block, r)) {
          add(r.key, {
            code: 'not_applied',
            severity: 'warning',
            message: 'Changed, but the site still uses the previous version of this rule. It catches up within minutes.',
          });
        }
      }
      const effective = effectiveRules(config.rules);

      let pending = 0;
      if (live) {
        const served = new Set(live.map(signature));
        const saved = new Set(effective.map(signature));
        for (const r of effective) {
          if (served.has(signature(r))) continue;
          pending++;
          add(r.source.key, {code: 'not_live', severity: 'info', message: `Saved, but not live on the site yet. ${LIVE_HINT}`});
        }
        // Rules the site still serves that were since changed, disabled or removed.
        pending += live.filter((r) => !saved.has(signature(r))).length;
      }

      const pages = new Set(urls.map(norm));
      for (const r of effective) {
        if (pages.has(norm(r.fromPath))) {
          add(r.source.key, {
            code: 'shadows_page',
            severity: 'info',
            message: `A published page lives at ${r.fromPath}. Visitors are sent away before it shows - fine for a short vanity address.`,
          });
        }
      }

      const finals = new Map<string, string[]>();
      for (const r of effective) {
        const {final, loop, ignored: refused} = trace(r.fromPath, effective);
        if (loop || refused || isAbsolute(final)) continue;
        finals.set(final, [...(finals.get(final) ?? []), r.source.key]);
      }
      await mapLimit([...finals.keys()], CONCURRENCY, async (final) => {
        const {status} = await deps.siteStatus(siteUrl, final);
        if (status !== 404 && status !== 410) return;
        for (const key of finals.get(final) ?? []) {
          add(key, {code: 'dead', severity: 'error', message: `Ends on ${final}, which doesn't exist on the site.`});
        }
      });

      return {
        config: {key: config.key, notes: config.notes, lastModified: config.lastModified},
        ignoredConfigs: ignored,
        rules: toRows(config, extra),
        live: live ? {count: live.length, pendingChanges: pending} : null,
        siteUrl,
        checkedAt,
      };
    },

    async pageRedirects({key, locale, path: rawPath}: {key: string; locale: string; path: string}): Promise<PageRedirects> {
      const path = normalizeRedirectPath(rawPath) || '/';
      const {config} = await current();
      if (!config) return {path, locale, hasConfig: false, rules: [], inbound: [], shadowedBy: null, urlChanges: []};
      const rows = toRows(config);
      const byKey = new Map(rows.map((r) => [r.key, r]));
      const effective = effectiveRules(config.rules);

      const inbound = effective
        .filter((r) => samePage(trace(r.fromPath, effective).final, path, locale))
        .map((r) => byKey.get(r.source.key)!)
        .filter(Boolean);

      let shadowedBy: PageRedirects['shadowedBy'] = null;
      for (const via of [path, withoutLocale(path, locale)]) {
        const hit = via ? matchRule(via, effective) : null;
        if (hit && via) {
          shadowedBy = {rule: byKey.get(hit.rule.source.key)!, via};
          break;
        }
      }

      // A page's URL ends in its route segment; an older version with another one had another URL.
      const urlChanges: PageRedirects['urlChanges'] = [];
      const segments = path.split('/').filter(Boolean);
      const isRoot = segments.length === 0 || (segments.length === 1 && segments[0].toLowerCase() === locale.toLowerCase());
      if (!isRoot) {
        const versions = await cms.listVersions(key, locale, 50).catch(() => []);
        const currentSegment = segments[segments.length - 1].toLowerCase();
        const parent = `/${segments.slice(0, -1).join('/')}`.replace(/^\/$/, '');
        const older = [
          ...new Set(
            versions
              .filter((v) => !v.variation && (v.status === 'published' || v.status === 'previous') && v.routeSegment)
              .map((v) => v.routeSegment!.toLowerCase()),
          ),
        ].filter((s) => s !== currentSegment);
        for (const segment of older) {
          const oldPath = normalizeRedirectPath(`${parent}/${segment}`);
          if (!oldPath) continue;
          const hit = [oldPath, withoutLocale(oldPath, locale)]
            .map((p) => (p ? matchRule(p, effective) : null))
            .find(Boolean);
          urlChanges.push({oldPath, coveredBy: hit ? byKey.get(hit.rule.source.key) ?? null : null});
        }
      }
      return {path, locale, hasConfig: true, rules: rows, inbound, shadowedBy, urlChanges};
    },

    async testUrl({url}: {url: string}): Promise<TestResult> {
      const siteUrl = await siteFor();
      let input = url.trim();
      if (/^[a-z][a-z0-9+.-]*:/i.test(input)) {
        let parsed: URL;
        try {
          parsed = new URL(input);
        } catch {
          throw new ActionError('invalid_url', "That address isn't valid. Type a path like /savings, or a full address on the site.");
        }
        if (parsed.origin !== new URL(siteUrl).origin) {
          throw new ActionError('other_site', `Test an address on ${siteUrl}, or just its path, like /savings.`);
        }
        input = parsed.pathname;
      }
      const path = normalizeRedirectPath(input.split(/[?#]/)[0]);
      if (!path) throw new ActionError('invalid_path', 'Type a path, like /savings. Spaces, backslashes and hidden characters are not allowed.');
      const {config} = await current();
      const effective = effectiveRules(config?.rules ?? []);
      const t = trace(path, effective);
      const finalStatus = isAbsolute(t.final) || t.loop ? null : statusText(await deps.siteStatus(siteUrl, t.final));
      return {
        path,
        hops: t.hops.map((h) => ({from: h.from, to: h.to, status: h.status, ruleKey: h.rule.source.key})),
        final: t.final,
        loop: t.loop,
        ignored: t.ignored,
        finalStatus,
        openUrl: `${siteUrl}${path}`,
      };
    },

    async addRule(input: AddRuleParams): Promise<WriteResult> {
      const {configKey, item, locale, rules} = await fresh();
      const {errors, rule} = validateNewRule(input, rules);
      const problems = Object.values(errors);
      if (problems.length > 0) throw new ActionError('invalid_rule', problems.join(' '));

      const risk = await firstRisk(rule, rules, locale, input.confirm, input.pageUrl);
      if (risk) throw new ActionError(risk.code, risk.message);

      // Before the rule exists: a refusal after it would leave a published rule the site never reads.
      await publishedForChange(cms, configKey, locale, LIST);

      const ruleKey = randomUUID().replace(/-/g, '');
      const rulePublished = await createRule(ruleKey, rule, item.container!, locale);

      let list: {published: boolean; version: string};
      try {
        list = await publishWithChanges(cms, configKey, locale, LIST, (props) => ({
          ...props,
          rules: {value: [...refsOf(props.rules?.value), {reference: `cms://content/${ruleKey}`}]},
        }));
      } catch (error) {
        throw new ActionError(
          'list_update_failed',
          `"Redirect: ${rule.fromPath}" was saved, but adding it to the site's redirect list failed, so it does nothing yet. ${reasonOf(error)} Add it to the list's rules in the CMS.`,
        );
      }

      // Read back what was written: the version the site will read must carry the new rule.
      const written = list.published
        ? (await cms.listVersions(configKey, locale, 5)).find((v) => v.status === 'published' && !v.variation)
        : await cms.getVersion(configKey, list.version);
      if (!refKeys(written?.properties?.rules?.value).includes(ruleKey)) {
        throw new ActionError(
          'list_check_failed',
          `The site's redirect list was saved without "Redirect: ${rule.fromPath}" - someone may have changed it at the same moment. Check the list's rules in the CMS.`,
        );
      }

      const published = rulePublished && list.published;
      return {
        published,
        message: published
          ? `Added ${rule.fromPath} → ${rule.toPath}. ${LIVE_HINT}`
          : `Saved ${rule.fromPath} → ${rule.toPath} for approval. It goes live once a reviewer approves the redirect and the site's redirect list.`,
        rule: {
          key: ruleKey,
          fromPath: rule.fromPath,
          toPath: rule.toPath,
          permanent: rule.permanent,
          matchSubpaths: rule.matchSubpaths,
          enabled: true,
        },
      };
    },

    async setEnabled({ruleKey, enabled}: {ruleKey: string; enabled: boolean}): Promise<WriteResult> {
      const {configKey, locale, rules} = await fresh();
      const target = rules.find((r) => r.key === ruleKey);
      if (!target) throw new ActionError('not_a_rule', "That redirect isn't in the site's redirect list.");
      if (enabled) {
        const issues = analyzeRules(rules.map((r) => (r.key === ruleKey ? {...r, enabled: true} : r))).get(ruleKey) ?? [];
        const blocking = issues.filter((i) => i.severity === 'error');
        if (blocking.length > 0) throw new ActionError('invalid_rule', blocking.map((i) => i.message).join(' '));
      }
      // Both items are checked before either changes, so a refusal leaves nothing half done.
      await publishedForChange(cms, configKey, locale, LIST);

      const {published: rulePublished} = await publishWithChanges(cms, ruleKey, locale, `The redirect ${target.fromPath}`, (props) => ({
        ...props,
        enabled: {value: enabled},
      }));
      const what = `${enabled ? 'Enabled' : 'Disabled'} ${target.fromPath}`;
      const rule = {
        key: ruleKey,
        fromPath: target.fromPath,
        toPath: target.toPath,
        permanent: target.permanent,
        matchSubpaths: target.matchSubpaths,
        enabled,
      };
      if (!rulePublished) return {published: false, message: `${what} for approval. It goes live once a reviewer approves it.`, rule};

      // The site reads the rules through the list, and Graph refreshes its copy of a rule there
      // minutes after the rule itself (seen on SaaS CMS). Publishing the list refreshes it.
      try {
        const {published} = await publishWithChanges(cms, configKey, locale, LIST, (props) => props);
        return {
          published,
          message: published ? `${what}. ${LIVE_HINT}` : `${what}. The site sees it once a reviewer approves its redirect list.`,
          rule,
        };
      } catch (error) {
        return {
          published: true,
          partial: true,
          message: `${what}, but refreshing the site's redirect list failed: ${reasonOf(error)} The site may keep the old setting for a few minutes; publishing the redirect list in the CMS applies it now.`,
          rule,
        };
      }
    },
  };
}

export type Manager = ReturnType<typeof createManager>;
