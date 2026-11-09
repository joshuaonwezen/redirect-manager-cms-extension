import type {RedirectRule} from '../../shared/redirects';

const TIMEOUT_MS = 8_000;
const MAX_COSMETIC_HOPS = 3;
const USER_AGENT = 'Mozilla/5.0 (compatible; OptimizelyCmsRedirects/1.0)';

const stripSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/**
 * How `path` answers on the site, with redirects off. Slash and case redirects
 * (/en/about/ -> /en/about) are followed, since what counts is where they land. A real
 * redirect is reported as it is: the caller's own trace explains those.
 */
export async function siteStatus(siteUrl: string, path: string): Promise<{status: number | null; location: string | null}> {
  let current = path;
  for (let hop = 0; ; hop++) {
    let res: Response;
    try {
      res = await fetch(`${siteUrl}${current}`, {
        redirect: 'manual',
        headers: {'User-Agent': USER_AGENT},
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      void res.body?.cancel();
    } catch {
      return {status: null, location: null};
    }
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) return {status: res.status, location: null};
    const next = new URL(location, siteUrl);
    const cosmetic = stripSlash(next.pathname).toLowerCase() === stripSlash(current.split(/[?#]/)[0]).toLowerCase();
    if (!cosmetic || hop === MAX_COSMETIC_HOPS) return {status: res.status, location: next.pathname};
    current = `${next.pathname}${next.search}`;
  }
}

/** The rules the site serves right now: its middleware reads the same /api/redirects. Null when unreadable. */
export async function liveRules(siteUrl: string): Promise<RedirectRule[] | null> {
  try {
    const res = await fetch(`${siteUrl}/api/redirects`, {signal: AbortSignal.timeout(TIMEOUT_MS)});
    if (!res.ok) return null;
    const body = (await res.json()) as {rules?: RedirectRule[]};
    return Array.isArray(body.rules) ? body.rules : null;
  } catch {
    return null;
  }
}
