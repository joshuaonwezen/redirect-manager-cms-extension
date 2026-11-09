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
  type KeyedRule,
  type NewRule,
  type RedirectRule,
  type RuleIssue,
} from '../../shared/redirects';
import type {Overview, PageRedirects, RuleRow, TestResult, WriteResult} from '../../shared/types';
import {CmsClient, type CmsItem} from './cms';
import {ActionError} from './errors';
import {pageUrls, redirectConfigs, ruleBlocks, type GraphConfigItem} from './graph';
import type {LoadedSettings} from './settings';
import {liveRules, siteStatus} from './site';
import {publishWithChanges} from './writes';

const CONCURRENCY = 6;
const KEY = /^[0-9a-f]{32}$/i;
const REF = /^cms:\/\/content\/([0-9a-f]{32})/i;

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

// When the site picks a change up: right away if the CMS publish webhook reaches it, else when
// its cached /api/redirects expires (the site's 1-hour ceiling).
const LIVE_HINT = 'The site serves it once its redirect cache refreshes: within a minute with the publish webhook set up, up to an hour without.';

function wrap(values: Record<string, unknown>): Record<string, {value: unknown}> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined).map(([k, v]) => [k, {value: v}]));
}

function refsOf(rules: unknown): Array<{reference: string}> {
  return Array.isArray(rules) ? rules.filter((r): r is {reference: string} => typeof r?.reference === 'string') : [];
}

function statusText(result: {status: number | null; location: string | null}): {status: number | null; text: string; ok: boolean} {
  const {status, location} = result;
  if (status === null) return {status, text: 'The site did not answer.', ok: false};
  if (status >= 200 && status < 300) return {status, text: `Opens (${status}).`, ok: true};
  if (status === 404 || status === 410) return {status, text: `Not found (${status}).`, ok: false};
  if (location) return {status, text: `The site redirects it to ${location} (${status}) - not one of these rules.`, ok: true};
  return {status, text: `The site answers ${status}.`, ok: status < 400};
}

export function createManager(cfg: LoadedSettings) {
  const cms = new CmsClient(cfg.cms);

  async function current(): Promise<{config: GraphConfigItem | null; ignored: number}> {
    const configs = await redirectConfigs(cfg.graph);
    return {config: configs[0] ?? null, ignored: Math.max(0, configs.length - 1)};
  }

  function toRows(config: GraphConfigItem, extra = new Map<string, RuleIssue[]>()): RuleRow[] {
    const found = analyzeRules(config.rules);
    return config.rules.map((r) => ({...r, issues: [...(found.get(r.key) ?? []), ...(extra.get(r.key) ?? [])]}));
  }

  /** The config the site reads, and its rules, straight from the CMS: Graph lags behind a write by up to a minute. */
  async function fresh(): Promise<{configKey: string; item: CmsItem; locale: string; rules: KeyedRule[]}> {
    const {config} = await current();
    if (!config) {
      throw new ActionError('no_config', "This instance has no Redirect Config. Create one (the site's seed-redirects.ts does) first.");
    }
    const item = await cms.getItem(config.key);
    if (!item?.container) throw new ActionError('no_config', 'The CMS has no Redirect Config at the key Graph names. Wait a minute and retry.');
    const locale = item.primaryLocale || item.locales?.find(Boolean) || 'en';
    const live = (await cms.listVersions(config.key, locale, 10)).find((v) => v.status === 'published' && !v.variation);
    const keys = refsOf(live?.properties?.rules?.value)
      .map((r) => REF.exec(r.reference)?.[1])
      .filter((k): k is string => Boolean(k));
    const rules = (
      await mapLimit(keys, CONCURRENCY, async (key) => {
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
    ).filter((r): r is NonNullable<typeof r> => r !== null);
    return {configKey: config.key, item, locale, rules};
  }

  return {
    async overview(): Promise<Overview> {
      const [{config, ignored}, live, urls] = await Promise.all([
        current(),
        liveRules(cfg.siteUrl),
        pageUrls(cfg.graph).catch(() => [] as string[]),
      ]);
      const checkedAt = new Date().toISOString();
      if (!config) return {config: null, ignoredConfigs: 0, rules: [], live: null, siteUrl: cfg.siteUrl, checkedAt};

      const extra = new Map<string, RuleIssue[]>();
      const add = (key: string, issue: RuleIssue) => extra.set(key, [...(extra.get(key) ?? []), issue]);

      const blocks = await ruleBlocks(cfg.graph, config.rules.map((r) => r.key)).catch(() => new Map());
      for (const r of config.rules) {
        const block = blocks.get(r.key);
        if (block && !sameRule(block, r)) {
          add(r.key, {
            code: 'not_applied',
            severity: 'warning',
            message:
              "The rule was changed, but Graph hasn't carried the change into Redirect Config yet, so the site still uses the old one. It catches up within minutes; publishing Redirect Config again refreshes it.",
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
          add(r.source.key, {code: 'not_live', severity: 'info', message: `Saved, but the site doesn't serve it yet. ${LIVE_HINT}`});
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
            message: `A published page lives at ${r.fromPath}. Visitors are redirected before it renders - fine for a vanity URL.`,
          });
        }
      }

      const finals = new Map<string, string[]>();
      for (const r of effective) {
        const {final, loop} = trace(r.fromPath, effective);
        if (loop || isAbsolute(final)) continue;
        finals.set(final, [...(finals.get(final) ?? []), r.source.key]);
      }
      await mapLimit([...finals.keys()], CONCURRENCY, async (final) => {
        const {status} = await siteStatus(cfg.siteUrl, final);
        if (status !== 404 && status !== 410) return;
        for (const key of finals.get(final) ?? []) {
          add(key, {code: 'dead', severity: 'error', message: `Ends on ${final}, which doesn't exist on the site (${status}).`});
        }
      });

      return {
        config: {key: config.key, notes: config.notes, lastModified: config.lastModified},
        ignoredConfigs: ignored,
        rules: toRows(config, extra),
        live: live ? {count: live.length, pendingChanges: pending} : null,
        siteUrl: cfg.siteUrl,
        checkedAt,
      };
    },

    async pageRedirects({key, locale, path: rawPath}: {key: string; locale: string; path: string}): Promise<PageRedirects> {
      const path = normalizeRedirectPath(rawPath) || '/';
      const {config} = await current();
      if (!config) return {path, locale, rules: [], inbound: [], shadowedBy: null, urlChanges: []};
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
      if (KEY.test(key) && !isRoot) {
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
          const oldPath = `${parent}/${segment}`;
          const hit = [oldPath, withoutLocale(oldPath, locale)]
            .map((p) => (p ? matchRule(p, effective) : null))
            .find(Boolean);
          urlChanges.push({oldPath, coveredBy: hit ? byKey.get(hit.rule.source.key) ?? null : null});
        }
      }
      return {path, locale, rules: rows, inbound, shadowedBy, urlChanges};
    },

    async testUrl({path: raw}: {path: string}): Promise<TestResult> {
      let input = raw.trim();
      if (/^https?:\/\//i.test(input)) {
        const url = new URL(input);
        if (url.origin !== new URL(cfg.siteUrl).origin) throw new ActionError('other_site', `Test a path on ${cfg.siteUrl}.`);
        input = url.pathname;
      }
      const path = normalizeRedirectPath(input);
      if (!path) throw new ActionError('invalid_path', 'Type a path, like /savings.');
      const {config} = await current();
      const effective = effectiveRules(config?.rules ?? []);
      const t = trace(path, effective);
      const finalStatus = isAbsolute(t.final) || t.loop ? null : statusText(await siteStatus(cfg.siteUrl, t.final));
      return {
        path,
        hops: t.hops.map((h) => ({from: h.from, to: h.to, status: h.status, ruleKey: h.rule.source.key})),
        final: t.final,
        loop: t.loop,
        finalStatus,
      };
    },

    async addRule(input: NewRule): Promise<WriteResult> {
      const {configKey, item, locale, rules} = await fresh();
      const {errors, rule} = validateNewRule(input, rules);
      const problems = Object.values(errors);
      if (problems.length > 0) throw new ActionError('invalid_rule', problems.join(' '));

      const ruleKey = randomUUID().replace(/-/g, '');
      const created = await cms.createContent({
        key: ruleKey,
        contentType: 'RedirectRule',
        container: item.container!,
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
      if (!version) throw new ActionError('create_failed', 'The CMS created the rule but returned no version to publish. Publish it in the CMS.');
      const rulePublished = await cms.publish(ruleKey, version);

      let configPublished: boolean;
      try {
        ({published: configPublished} = await publishWithChanges(cms, configKey, locale, 'Redirect Config', (props) => ({
          ...props,
          rules: {value: [...refsOf(props.rules?.value), {reference: `cms://content/${ruleKey}`}]},
        })));
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'unknown error';
        throw new ActionError(
          'config_update_failed',
          `The rule was created (Redirect: ${rule.fromPath}) but adding it to Redirect Config failed: ${reason} Add it under Redirect Config > Redirect rules in the CMS.`,
        );
      }

      const published = rulePublished && configPublished;
      return {
        ruleKey,
        published,
        message: published
          ? `Added ${rule.fromPath} → ${rule.toPath}. ${LIVE_HINT}`
          : `Saved ${rule.fromPath} → ${rule.toPath} as drafts awaiting approval. It goes live once a reviewer approves the rule and Redirect Config.`,
      };
    },

    async setEnabled({ruleKey, enabled}: {ruleKey: string; enabled: boolean}): Promise<WriteResult> {
      if (!KEY.test(ruleKey)) throw new ActionError('invalid_key', 'That is not a rule key.');
      const {configKey, locale, rules} = await fresh();
      const target = rules.find((r) => r.key === ruleKey);
      if (!target) throw new ActionError('not_a_rule', "That rule isn't in the Redirect Config the site reads.");
      if (enabled) {
        const issues = analyzeRules(rules.map((r) => (r.key === ruleKey ? {...r, enabled: true} : r))).get(ruleKey) ?? [];
        const blocking = issues.filter((i) => i.severity === 'error');
        if (blocking.length > 0) throw new ActionError('invalid_rule', blocking.map((i) => i.message).join(' '));
      }
      const {published: rulePublished} = await publishWithChanges(cms, ruleKey, locale, `Redirect ${target.fromPath}`, (props) => ({
        ...props,
        enabled: {value: enabled},
      }));
      // The site reads the rules through Redirect Config, and Graph refreshes its copy of a rule
      // there minutes after the rule itself (seen on joshCMS). Indexing the config refreshes it.
      const configPublished = rulePublished
        ? (await publishWithChanges(cms, configKey, locale, 'Redirect Config', (props) => props)).published
        : false;
      const published = rulePublished && configPublished;
      const what = `${enabled ? 'Enabled' : 'Disabled'} ${target.fromPath}`;
      return {
        published,
        message: published ? `${what}. ${LIVE_HINT}` : `${what} as a draft awaiting approval.`,
      };
    },
  };
}
