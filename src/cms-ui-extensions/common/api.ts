import type {ExtensionContext} from '@optimizely/cms-extensibility-sdk';
import {CMS_EXTENSION_FUNCTION_ID} from '@shared/constants';
import type {ActionName, ActionParams, ActionResults, Envelope} from '@shared/types';

export class CallError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = 'CallError';
    this.code = code;
  }
}

const FALLBACK_MESSAGES: Record<string, string> = {
  not_configured: 'The app is missing settings.',
  cms_unauthorized: 'The CMS rejected the API client. Check it in the app settings.',
  cms_rate_limited: 'The CMS is rate limiting requests. Try again in a moment.',
  graph_unauthorized: 'Graph rejected the single key. Check it in the app settings.',
  internal_error: 'Something went wrong in the extension backend.',
  backend_unreachable: 'The extension backend failed before answering. The app logs (ocp app logs) have the details.',
};

/** Calls one backend action; resolves with its result or throws CallError. */
export async function call<A extends ActionName>(
  context: ExtensionContext,
  action: A,
  params: ActionParams[A],
): Promise<ActionResults[A]> {
  // The CMS rejects with an empty "[ExtensionService] Failed to invoke function:" when the
  // backend throws instead of answering.
  const response = await context.extension.invokeFunction(CMS_EXTENSION_FUNCTION_ID, {action, params}).catch(() => {
    throw new CallError('backend_unreachable', FALLBACK_MESSAGES.backend_unreachable);
  });
  const envelope = response.data as Envelope<ActionResults[A]> | undefined;
  if (envelope && typeof envelope === 'object' && 'ok' in envelope) {
    if (envelope.ok) return envelope.result;
    throw new CallError(envelope.error, envelope.message || FALLBACK_MESSAGES[envelope.error] || envelope.error);
  }
  throw new CallError('request_failed', `The extension backend answered HTTP ${response.statusCode}.`);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed.';
}

export function isNotConfigured(error: unknown): boolean {
  return error instanceof CallError && error.code === 'not_configured';
}
