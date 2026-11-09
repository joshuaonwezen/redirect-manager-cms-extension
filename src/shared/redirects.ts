// The site's redirect rules, reproduced so the extension sees exactly what visitors get.
// Mirrors optimizely-nextjs-demo:
// - normalizeRedirectPath() and the filter/sort in getRedirectRules()
//   (src/lib/graphql/queries/GetRedirectRules.ts);
// - norm() and matchRedirect() (src/lib/redirects.ts).
// Keep them in step - redirects.test.ts pins the site's behavior.
// Shared by the browser and the backend: no Node built-ins, no browser globals.

export interface RedirectRule {
  fromPath: string;
  toPath: string;
  permanent: boolean;
  matchSubpaths: boolean;
}

export interface RawRule {
  fromPath?: string | null;
  toPath?: string | null;
  permanent?: boolean | null;
  matchSubpaths?: boolean | null;
  enabled?: boolean | null;
}

/** Leading slash, collapse repeated slashes, drop the trailing slash (except root). Absolute http(s) destinations are left untouched. */
export function normalizeRedirectPath(input: string): string {
  let s = (input ?? '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (!s.startsWith('/')) s = '/' + s;
  s = s.replace(/\/{2,}/g, '/');
  if (s.length > 1) s = s.replace(/\/+$/, '');
  return s;
}

/** The rules the site applies, in the order it tries them. */
export function effectiveRules<T extends RawRule>(raw: Array<T | null | undefined>): Array<RedirectRule & {source: T}> {
  return raw
    .filter((r): r is T => !!r && r.enabled !== false && !!r.fromPath && !!r.toPath)
    .map((r) => ({
      fromPath: normalizeRedirectPath(r.fromPath as string),
      toPath: normalizeRedirectPath(r.toPath as string),
      permanent: r.permanent === true,
      matchSubpaths: r.matchSubpaths === true,
      source: r,
    }))
    .filter((r) => r.fromPath && r.toPath)
    // Longest fromPath first so an exact rule beats a shorter prefix rule.
    .sort((a, b) => b.fromPath.length - a.fromPath.length);
}

export function norm(p: string): string {
  let s = (p || '/').replace(/\/{2,}/g, '/');
  if (s.length > 1) s = s.replace(/\/+$/, '');
  return s.toLowerCase();
}

export const isAbsolute = (s: string) => /^https?:\/\//i.test(s);

/** matchRedirect(), also returning the rule that fired. */
export function matchRule<R extends RedirectRule>(
  pathname: string,
  rules: R[],
): {toPath: string; status: 307 | 308; rule: R} | null {
  const inPath = norm(pathname);

  for (const rule of rules) {
    const from = norm(rule.fromPath);
    let dest: string | null = null;

    if (rule.matchSubpaths) {
      if (inPath === from) {
        dest = rule.toPath;
      } else if (inPath.startsWith(from + '/')) {
        // Append the extra path segments to the destination, keeping their casing.
        const fromLen = rule.fromPath.replace(/\/+$/, '').length;
        const remainder = pathname.slice(fromLen).replace(/\/+$/, '');
        const base = rule.toPath === '/' && !isAbsolute(rule.toPath) ? '' : rule.toPath.replace(/\/+$/, '');
        dest = base + remainder;
      }
    } else if (inPath === from) {
      dest = rule.toPath;
    }

    if (!dest) continue;
    // Self-loop guard: an internal destination equal to the incoming path.
    if (!isAbsolute(dest) && norm(dest) === inPath) continue;

    return {toPath: dest, status: rule.permanent ? 308 : 307, rule};
  }

  return null;
}

export function matchRedirect(pathname: string, rules: RedirectRule[]): {toPath: string; status: 307 | 308} | null {
  const hit = matchRule(pathname, rules);
  return hit ? {toPath: hit.toPath, status: hit.status} : null;
}

export interface Hop<R> {
  from: string;
  to: string;
  status: 307 | 308;
  rule: R;
}

export interface Trace<R> {
  hops: Array<Hop<R>>;
  /** Where a visitor ends up. */
  final: string;
  /** The redirects never settle: a cycle, or a path that keeps growing. */
  loop: boolean;
}

const MAX_HOPS = 10;

/** Every redirect a visitor to `path` goes through: the browser follows each one back through the middleware. */
export function trace<R extends RedirectRule>(path: string, rules: R[]): Trace<R> {
  const hops: Array<Hop<R>> = [];
  let current = path;
  const seen = new Set([norm(current)]);
  while (!isAbsolute(current)) {
    const hit = matchRule(current, rules);
    if (!hit) break;
    hops.push({from: current, to: hit.toPath, status: hit.status, rule: hit.rule});
    current = hit.toPath;
    if (hops.length >= MAX_HOPS || (!isAbsolute(current) && seen.has(norm(current)))) return {hops, final: current, loop: true};
    seen.add(norm(current));
  }
  return {hops, final: current, loop: false};
}

export type Severity = 'error' | 'warning' | 'info';

export interface RuleIssue {
  code: 'disabled' | 'invalid' | 'duplicate' | 'self' | 'loop' | 'chain' | 'dead' | 'shadows_page' | 'not_live' | 'not_applied';
  severity: Severity;
  message: string;
}

export interface KeyedRule extends RawRule {
  key: string;
}

const path = (hops: Array<{from: string}>, final: string) => [...hops.map((h) => h.from), final].join(' → ');

/** Problems visible from the rules alone, per rule key. Network checks (dead, not live) come on top. */
export function analyzeRules(rows: KeyedRule[]): Map<string, RuleIssue[]> {
  const issues = new Map<string, RuleIssue[]>(rows.map((r) => [r.key, []]));
  const add = (key: string, issue: RuleIssue) => issues.get(key)?.push(issue);
  const rules = effectiveRules(rows);

  const firstFrom = new Map<string, KeyedRule>();
  for (const row of rows) {
    if (row.enabled === false) {
      add(row.key, {code: 'disabled', severity: 'info', message: 'Disabled: the site ignores it.'});
      continue;
    }
    const from = normalizeRedirectPath(row.fromPath ?? '');
    const to = normalizeRedirectPath(row.toPath ?? '');
    if (!from || !to) {
      add(row.key, {code: 'invalid', severity: 'error', message: 'Missing a from or to path: the site ignores it.'});
      continue;
    }
    if (!isAbsolute(to) && norm(to) === norm(from)) {
      add(row.key, {code: 'self', severity: 'error', message: 'Points at itself: the site skips it.'});
      continue;
    }
    const earlier = firstFrom.get(norm(from));
    if (earlier) {
      add(row.key, {
        code: 'duplicate',
        severity: 'error',
        message: `Never fires: an earlier rule already redirects ${earlier.fromPath} to ${earlier.toPath}.`,
      });
      continue;
    }
    firstFrom.set(norm(from), row);

    const t = trace(from, rules);
    if (t.loop) {
      add(row.key, {code: 'loop', severity: 'error', message: `Redirect loop: ${path(t.hops, t.final)}.`});
    } else if (t.hops.length > 1) {
      add(row.key, {
        code: 'chain',
        severity: 'warning',
        message: `Chain of ${t.hops.length}: ${path(t.hops, t.final)}. Point it at ${t.final} directly.`,
      });
    }
  }
  return issues;
}

export interface NewRule {
  fromPath: string;
  toPath: string;
  permanent: boolean;
  matchSubpaths: boolean;
  note?: string;
}

export interface Validation {
  errors: Partial<Record<'fromPath' | 'toPath', string>>;
  warnings: string[];
  rule: NewRule;
}

/** Checks a rule before it is added, against the rules that exist (enabled or not). */
export function validateNewRule(input: NewRule, existing: RawRule[]): Validation {
  const fromPath = normalizeRedirectPath(input.fromPath);
  const toPath = normalizeRedirectPath(input.toPath);
  const rule: NewRule = {...input, fromPath, toPath, note: input.note?.trim() || undefined};
  const errors: Validation['errors'] = {};
  const warnings: string[] = [];

  if (!fromPath || isAbsolute(fromPath)) errors.fromPath = 'A path on this site, like /old-page.';
  else if (fromPath === '/') errors.fromPath = 'Redirecting the homepage would send every visitor away.';
  if (!toPath) errors.toPath = 'Where should it go? A path like /new-page, or a full URL.';
  if (Object.keys(errors).length > 0) return {errors, warnings, rule};

  if (!isAbsolute(toPath) && norm(toPath) === norm(fromPath)) {
    errors.toPath = 'From and to are the same page.';
    return {errors, warnings, rule};
  }
  const rules = effectiveRules(existing);
  const duplicate = rules.find((r) => norm(r.fromPath) === norm(fromPath));
  if (duplicate) {
    errors.fromPath = `${duplicate.fromPath} already redirects to ${duplicate.toPath}.`;
    return {errors, warnings, rule};
  }
  const withNew = effectiveRules([...existing, {...rule, enabled: true}]);
  const t = trace(fromPath, withNew);
  if (t.loop) {
    errors.toPath = `This would make a redirect loop: ${path(t.hops, t.final)}.`;
    return {errors, warnings, rule};
  }
  const onward = trace(toPath, rules);
  if (onward.hops.length > 0) warnings.push(`${toPath} itself redirects to ${onward.final}. Point at ${onward.final} directly?`);
  return {errors, warnings, rule};
}

/** The path without a leading /{locale} segment, e.g. /en/personal -> /personal. Null when it has none. */
export function withoutLocale(pathname: string, locale: string): string | null {
  const prefix = `/${locale.toLowerCase()}`;
  const p = norm(pathname);
  if (p === prefix) return '/';
  return p.startsWith(`${prefix}/`) ? p.slice(prefix.length) : null;
}

/**
 * Whether two paths serve the same page. The site's catch-all tries /{locale}{path} before
 * {path}, so /personal/savings and /en/personal/savings are one page.
 */
export function samePage(a: string, b: string, locale: string): boolean {
  if (isAbsolute(a) || isAbsolute(b)) return a === b;
  const strip = (p: string) => withoutLocale(p, locale) ?? norm(p);
  return strip(a) === strip(b);
}
