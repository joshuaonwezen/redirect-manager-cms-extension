export type Service = 'cms' | 'graph';

/** A non-2xx answer from the CMS or Graph, carried back to the UI as `{error: code}`. */
export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;

  public constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function codeFor(service: Service, status: number): string {
  if (status === 401 || status === 403) return `${service}_unauthorized`;
  if (status === 404) return `${service}_not_found`;
  if (status === 409) return `${service}_conflict`;
  if (status === 429) return `${service}_rate_limited`;
  if (status >= 400 && status < 500) return `${service}_rejected`;
  return `${service}_unavailable`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The upstream APIs answer bursts with 429 + Retry-After. A function invocation has a time
// budget, so the wait is capped low.
const MAX_ATTEMPTS = 4;
const MAX_RETRY_WAIT_S = 8;

/**
 * fetch + JSON with 429 backoff. Throws ApiError on any non-2xx, with the start of the
 * response body in the message - the APIs put the useful validation detail there.
 * Returns null for an empty body (204, or a 2xx with nothing in it).
 */
export async function requestJson<T>(
  service: Service,
  label: string,
  url: string,
  init: RequestInit = {},
): Promise<T | null> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);
    if (res.status === 429 && attempt < MAX_ATTEMPTS - 1) {
      const retryAfter = Number(res.headers.get('retry-after')) || 2 ** attempt;
      await sleep(Math.min(retryAfter, MAX_RETRY_WAIT_S) * 1000);
      continue;
    }
    const text = await res.text();
    if (!res.ok) {
      throw new ApiError(res.status, codeFor(service, res.status), `${label}: HTTP ${res.status} ${text.slice(0, 300)}`);
    }
    return text.trim() ? (JSON.parse(text) as T) : null;
  }
}
