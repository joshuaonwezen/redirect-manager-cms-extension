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

// A backslash, whitespace or a control character turns "/\evil.example" or "/<TAB>/evil.example"
// into another host once it goes through new URL(path, origin), so the site drops any path
// that has one.
export const UNSAFE_PATH_CHARS = /[\\\s\u0000-\u001f\u007f]/;

/**
 * Leading slash, collapse repeated slashes, drop the trailing slash (except root). Absolute
 * https destinations are left untouched. "" for anything the site drops: an http:// URL, or
 * a value with a backslash, whitespace or a control character.
 */
export function normalizeRedirectPath(input: string): string {
  let s = (input ?? '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) {
    if (!/^https:\/\//i.test(s) || UNSAFE_PATH_CHARS.test(s)) return '';
    return s;
  }
  if (UNSAFE_PATH_CHARS.test(s)) return '';
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

const PROBE_ORIGIN = 'https://site.invalid';

/**
 * Whether the site's middleware follows a destination matchRedirect() returned. It only
 * follows a relative one that resolves on the site itself: a subpath remainder can still
 * make "//other.example" out of a safe rule.
 */
export function followed(dest: string): boolean {
  try {
    return isAbsolute(dest) || new URL(dest, PROBE_ORIGIN).origin === PROBE_ORIGIN;
  } catch {
    return false;
  }
}

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
  /** A destination the site refused to follow (it would leave the site), so the visitor stays on `final`. */
  ignored: string | null;
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
    if (!followed(hit.toPath)) return {hops, final: current, loop: false, ignored: hit.toPath};
    hops.push({from: current, to: hit.toPath, status: hit.status, rule: hit.rule});
    current = hit.toPath;
    if (hops.length >= MAX_HOPS || (!isAbsolute(current) && seen.has(norm(current)))) {
      return {hops, final: current, loop: true, ignored: null};
    }
    seen.add(norm(current));
  }
  return {hops, final: current, loop: false, ignored: null};
}

export type Severity = 'error' | 'warning' | 'info';

export interface RuleIssue {
  code:
    | 'disabled'
    | 'invalid'
    | 'ignored'
    | 'duplicate'
    | 'self'
    | 'loop'
    | 'chain'
    | 'dead'
    | 'shadows_page'
    | 'not_live'
    | 'not_applied';
  severity: Severity;
  message: string;
}

export interface KeyedRule extends RawRule {
  key: string;
}

/** Why the site drops or never fires a rule, judged from its own paths. Null when it applies it. */
export function droppedReason(row: RawRule): RuleIssue | null {
  const from = (row.fromPath ?? '').trim();
  const to = (row.toPath ?? '').trim();
  if (!from || !to) return {code: 'invalid', severity: 'error', message: 'Missing a From or To address: the site ignores it.'};
  if (UNSAFE_PATH_CHARS.test(from) || isAbsolute(from)) {
    return {
      code: 'ignored',
      severity: 'error',
      message: isAbsolute(from)
        ? 'Ignored by the site: From must be a path on this site, like /old-page, not a full address.'
        : 'Ignored by the site: its From address has a space, backslash or hidden character in it.',
    };
  }
  if (/^http:\/\//i.test(to)) {
    return {
      code: 'ignored',
      severity: 'error',
      message: 'Ignored by the site: it only sends visitors to another website at a secure https:// address.',
    };
  }
  if (UNSAFE_PATH_CHARS.test(to)) {
    return {
      code: 'ignored',
      severity: 'error',
      message:
        'Ignored by the site: its To address has a space, backslash or hidden character in it, which browsers can read as another website.',
    };
  }
  return null;
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
    const dropped = droppedReason(row);
    if (dropped) {
      add(row.key, dropped);
      continue;
    }
    const from = normalizeRedirectPath(row.fromPath ?? '');
    const to = normalizeRedirectPath(row.toPath ?? '');
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

/** Risky additions the backend refuses until the editor confirms them by code. */
export const ADD_CONFIRMS = ['external_destination', 'destination_missing', 'hides_page', 'broad_subpaths'] as const;
export type AddConfirm = (typeof ADD_CONFIRMS)[number];

export const isAddConfirm = (code: string): code is AddConfirm => (ADD_CONFIRMS as readonly string[]).includes(code);

export interface Validation {
  errors: Partial<Record<'fromPath' | 'toPath', string>>;
  warnings: string[];
  rule: NewRule;
}

// Paths the site serves itself, or that only its own code should produce.
const RESERVED_FROM = /^\/(api|_next)(\/|$)/i;
const RESERVED_FILES = new Set(['/favicon.ico', '/robots.txt', '/sitemap.xml']);

function parses(url: string): boolean {
  try {
    return Boolean(new URL(url));
  } catch {
    return false;
  }
}

/** Why `raw` can't be the From of a new rule, or null. A missing leading slash is fine: it is added. */
export function fromPathProblem(raw: string): string | null {
  const s = (raw ?? '').trim();
  if (!s) return 'Which address should redirect? A path on this site, like /old-page.';
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return 'A path on this site, like /old-page, not a full address.';
  if (UNSAFE_PATH_CHARS.test(s)) return 'Remove the spaces, backslashes or hidden characters.';
  if (/[?#]/.test(s)) return 'Leave out everything from ? or #: a redirect matches the path only.';
  const p = normalizeRedirectPath(s).toLowerCase();
  if (p === '/') return 'Redirecting the homepage would send every visitor away.';
  if (RESERVED_FROM.test(p) || RESERVED_FILES.has(p)) return 'The site needs this address for itself, so it can\'t redirect.';
  if (p.includes('__v_')) return 'Addresses with __v_ in them belong to the site\'s experiments and can\'t redirect.';
  return null;
}

/** Why `raw` can't be the To of a new rule, or null. */
export function toPathProblem(raw: string): string | null {
  const s = (raw ?? '').trim();
  if (!s) return 'Where should it go? A path like /new-page, or a full https:// address.';
  if (/^http:\/\//i.test(s)) return 'Use a secure https:// address: the site doesn\'t send visitors to http:// ones.';
  if (UNSAFE_PATH_CHARS.test(s)) {
    return 'Remove the spaces, backslashes or hidden characters: browsers can read them as another website.';
  }
  if (/^https:\/\//i.test(s)) return parses(s) ? null : 'That isn\'t a valid web address.';
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return 'A path like /new-page, or a full https:// address.';
  return null;
}

/** Checks a rule before it is added, against the rules that exist (enabled or not). */
export function validateNewRule(input: NewRule, existing: RawRule[]): Validation {
  const fromPath = normalizeRedirectPath(input.fromPath);
  const toPath = normalizeRedirectPath(input.toPath);
  const rule: NewRule = {...input, fromPath, toPath, note: input.note?.trim() || undefined};
  const errors: Validation['errors'] = {};
  const warnings: string[] = [];

  const fromProblem = fromPathProblem(input.fromPath);
  const toProblem = toPathProblem(input.toPath);
  if (fromProblem) errors.fromPath = fromProblem;
  if (toProblem) errors.toPath = toProblem;
  if (Object.keys(errors).length > 0) return {errors, warnings, rule};

  if (!isAbsolute(toPath) && norm(toPath) === norm(fromPath)) {
    errors.toPath = 'From and To are the same page.';
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
