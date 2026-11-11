// Where the site lives, for the open page. The CMS's own application settings
// (Settings > Applications) list each site's host, and the page URL the editor reports is
// built from it, so a site URL rarely needs configuring. The editor's URL is used only
// when its host is one of those application hosts: it arrives from the browser, and an
// unchecked URL would let a request point the backend at any address.

export interface CmsApplication {
  key?: string;
  hosts?: Array<{authority?: string | null; type?: string | null; preferredUrlScheme?: string | null}> | null;
}

export interface SiteOrigins {
  /** Every https host of every application, as an origin. */
  all: string[];
  /** The hosts marked primary (preview hosts left out). */
  primary: string[];
}

const AUTHORITY = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/;
const CACHE_MS = 5 * 60_000;

// Module scope survives warm invocations of the function.
let cache: {at: number; scope: string; origins: SiteOrigins} | null = null;

/** The https origins the CMS's applications are served on. */
export function originsOf(apps: CmsApplication[]): SiteOrigins {
  const all = new Set<string>();
  const primary = new Set<string>();
  for (const app of apps) {
    for (const host of app.hosts ?? []) {
      const authority = host.authority?.trim().toLowerCase() ?? '';
      // https only, like a site URL typed into the settings.
      if (!AUTHORITY.test(authority) || (host.preferredUrlScheme ?? 'https').toLowerCase() !== 'https') continue;
      const origin = new URL(`https://${authority}`).origin;
      all.add(origin);
      if (host.type === 'primary') primary.add(origin);
    }
  }
  return {all: [...all], primary: [...primary]};
}

/** The application origins for this install, read through `list` and cached for five minutes. */
export async function siteOrigins(scope: string, list: () => Promise<CmsApplication[]>): Promise<SiteOrigins> {
  if (cache && cache.scope === scope && Date.now() - cache.at < CACHE_MS) return cache.origins;
  const origins = originsOf(await list());
  cache = {at: Date.now(), scope, origins};
  return origins;
}

/**
 * The site origin for a request: the admin's override when one is saved; otherwise the
 * open page's origin when it is one of the CMS's application hosts; otherwise the only
 * primary application host. Null when none applies (several sites and no page to tell
 * them apart): the caller then asks for the setting.
 */
export function pickSiteUrl(configured: string, pageUrl: string | null | undefined, origins: SiteOrigins): string | null {
  if (configured) return configured;
  if (pageUrl) {
    try {
      const origin = new URL(pageUrl).origin;
      if (origins.all.includes(origin)) return origin;
    } catch {
      // Not a URL: fall through to the single-site default.
    }
  }
  return origins.primary.length === 1 ? origins.primary[0] : null;
}
