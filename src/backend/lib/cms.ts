import {ApiError, requestJson} from './http';
import type {CmsApplication} from './siteUrl';

const CMS_API = 'https://api.cms.optimizely.com';
const EXPIRY_BUFFER_MS = 30_000;

// Reads straight after a publish can still show the old status for a second or two (seen on
// joshCMS 2026-11-12), so the status is read back a few times before anything is concluded.
const CONFIRM_DELAYS_MS = [0, 500, 1000, 1500, 2000];
const PENDING = new Set(['draft', 'ready']);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface CmsConfig {
  clientId: string;
  clientSecret: string;
}

export interface CmsVersion {
  key: string;
  version: string;
  locale: string;
  status: string;
  contentType?: string;
  displayName?: string;
  /** Absent on base versions. */
  variation?: string | null;
  routeSegment?: string | null;
  lastModified?: string;
  /** In PropertyData form: {name: {value}}. */
  properties?: Record<string, {value?: unknown} | null> | null;
}

export type PublishOutcome = 'published' | 'awaiting_approval';

export interface CmsItem {
  key: string;
  container?: string;
  contentType?: string;
  primaryLocale?: string | null;
  /** [''] for items without language versions (media, folders). */
  locales?: string[];
}

// Module scope survives warm invocations of the function.
let tokenCache: {clientId: string; token: string; expiresAt: number} | null = null;

export class CmsClient {
  private readonly cfg: CmsConfig;

  public constructor(cfg: CmsConfig) {
    this.cfg = cfg;
  }

  public async token(): Promise<string> {
    if (tokenCache && tokenCache.clientId === this.cfg.clientId && tokenCache.expiresAt > Date.now() + EXPIRY_BUFFER_MS) {
      return tokenCache.token;
    }
    const body = await requestJson<{access_token: string; expires_in: number}>('cms', 'CMS token', `${CMS_API}/oauth/token`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
      }),
    });
    if (!body?.access_token) throw new ApiError(502, 'cms_unavailable', 'CMS token: no access_token in response');
    tokenCache = {clientId: this.cfg.clientId, token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000};
    return body.access_token;
  }

  private async get<T>(label: string, path: string): Promise<T | null> {
    return requestJson<T>('cms', label, `${CMS_API}${path}`, {
      headers: {Authorization: `Bearer ${await this.token()}`},
    });
  }

  private async send<T>(label: string, method: string, path: string, body?: unknown, contentType = 'application/json') {
    return requestJson<T>('cms', label, `${CMS_API}${path}`, {
      method,
      headers: {Authorization: `Bearer ${await this.token()}`, ...(body === undefined ? {} : {'Content-Type': contentType})},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  /** POST /v1/content. The answer can be a 201 with an empty body, so callers pass their own key. */
  public async createContent(body: {
    key: string;
    contentType: string;
    container: string;
    initialVersion: {locale: string; displayName: string; properties: Record<string, {value: unknown}>};
  }): Promise<string | null> {
    const created = await this.send<{initialVersion?: {version?: string}}>('Create content', 'POST', '/v1/content', body);
    return created?.initialVersion?.version ?? null;
  }

  /**
   * Creates a draft of the item's base (no variation) in `locale` and returns ITS version, so
   * two editors writing at once each publish their own draft. The CMS does NOT copy the
   * properties into the new draft: the caller patches every property it should keep.
   */
  public async createBaseDraft(key: string, locale: string, carry: {displayName?: string}): Promise<string> {
    const created = await this.send<Partial<CmsVersion>>('Create draft', 'POST', `/v1/content/${key}/versions`, {
      locale,
      ...(carry.displayName ? {displayName: carry.displayName} : {}),
    });
    if (created?.version && !created.variation) return String(created.version);
    // Some responses omit the version: take the newest base draft in this locale. Never
    // the global /versions list (it mixes languages) and never a variation's draft.
    const draft = (await this.listVersions(key, locale, 10))
      .filter((v) => v.status === 'draft' && !v.variation)
      .sort((a, b) => Number(b.version) - Number(a.version))[0];
    if (!draft) throw new ApiError(502, 'cms_unavailable', `Create draft: no base draft of ${key} in ${locale} afterwards.`);
    return String(draft.version);
  }

  public async patchVersion(key: string, version: string, body: unknown): Promise<void> {
    await this.send('Update version', 'PATCH', `/v1/content/${key}/versions/${encodeURIComponent(version)}`, body, 'application/merge-patch+json');
  }

  /** Publishes the version, or reports that an approval workflow holds it for review. */
  public async publishVersion(key: string, version: string, confirmDelaysMs = CONFIRM_DELAYS_MS): Promise<PublishOutcome> {
    try {
      await this.send('Publish', 'POST', `/v1/content/${key}/versions/${encodeURIComponent(version)}:publish`);
    } catch (error) {
      // Instances with an approval workflow answer 400 "requires approval" and keep the draft.
      if (error instanceof ApiError && error.status === 400 && /requires approval/i.test(error.message)) {
        return 'awaiting_approval';
      }
      throw error;
    }
    for (const ms of confirmDelaysMs) {
      if (ms) await sleep(ms);
      const status = (await this.getVersion(key, version))?.status;
      // previous: published, and already replaced by a newer publish.
      if (status === 'published' || status === 'previous') return 'published';
      // Anything but a draft (inReview, say) means a workflow holds it.
      if (status && !PENDING.has(status)) return 'awaiting_approval';
    }
    // Still a draft after all the re-reads: say it waits, as before, rather than claim it is live.
    return 'awaiting_approval';
  }

  /** The CMS's applications (Settings > Applications), each with the hosts its site is served on. */
  public async listApplications(): Promise<CmsApplication[]> {
    const body = await this.get<{items?: CmsApplication[] | null} | CmsApplication[]>('List applications', '/v1/applications');
    if (Array.isArray(body)) return body;
    return body?.items ?? [];
  }

  /** Null when the content doesn't exist (deleted, or never did). */
  public async getItem(key: string): Promise<CmsItem | null> {
    try {
      return await this.get<CmsItem>('Get content', `/v1/content/${key}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  /** The newest versions of the item in `locale`, newest first, with their content. */
  public async listVersions(key: string, locale: string, pageSize = 10): Promise<CmsVersion[]> {
    try {
      const page = await this.get<{items?: CmsVersion[]}>(
        'List versions',
        `/v1/content/${key}/locales/${encodeURIComponent(locale)}?pageSize=${pageSize}`,
      );
      return page?.items ?? [];
    } catch (error) {
      // An item with no version in this locale (or no locales at all: media, folders).
      if (error instanceof ApiError && error.status === 404) return [];
      throw error;
    }
  }

  public async getVersion(key: string, version: string): Promise<CmsVersion | null> {
    try {
      return await this.get<CmsVersion>('Get version', `/v1/content/${key}/versions/${encodeURIComponent(version)}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }
}
