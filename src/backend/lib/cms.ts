import {ApiError, requestJson} from './http';

const CMS_API = 'https://api.cms.optimizely.com';
const EXPIRY_BUFFER_MS = 30_000;

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

  /** A new, blank draft: it does NOT copy the properties of the version before it. */
  public async createDraft(key: string, locale: string, displayName?: string): Promise<void> {
    await this.send('Create version', 'POST', `/v1/content/${key}/versions`, displayName ? {locale, displayName} : {locale});
  }

  public async patchVersion(key: string, version: string, body: unknown): Promise<void> {
    await this.send('Update version', 'PATCH', `/v1/content/${key}/versions/${encodeURIComponent(version)}`, body, 'application/merge-patch+json');
  }

  /** True when published; false when the instance needs approval and the version waits for a reviewer. */
  public async publish(key: string, version: string): Promise<boolean> {
    try {
      await this.send('Publish', 'POST', `/v1/content/${key}/versions/${encodeURIComponent(version)}:publish`);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 400 && /requires approval/i.test(error.message)) return false;
      throw error;
    }
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
