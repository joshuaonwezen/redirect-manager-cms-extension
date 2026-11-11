import * as App from '@zaiusinc/app-sdk';
import {logger} from '@zaiusinc/app-sdk';

import type {ActionName, ActionParams, ActionResults, Envelope, WriteResult} from '../../shared/types';
import {ActionError} from '../lib/errors';
import {ApiError} from '../lib/http';
import {createManager, type Manager} from '../lib/manager';
import {loadConfig} from '../lib/settings';
import {isAction, PARSERS} from '../lib/validate';

interface RequestBody {
  action?: unknown;
  params?: unknown;
}

function ok<T>(result: T): Envelope<T> {
  return {ok: true, result};
}

function fail(error: string, message?: string): Envelope<never> {
  return message ? {ok: false, error, message} : {ok: false, error};
}

type Handlers = {[A in ActionName]: (manager: Manager, params: ActionParams[A]) => Promise<ActionResults[A]>};

const HANDLERS: Handlers = {
  overview: (m) => m.overview(),
  pageRedirects: (m, p) => m.pageRedirects(p),
  testUrl: (m, p) => m.testUrl(p),
  addRule: (m, p) => m.addRule(p),
  setEnabled: (m, p) => m.setEnabled(p),
};

// Actions that change the CMS. Each success is logged: the extension context carries no
// editor identity and the CMS history shows the API client, so the log records what changed.
const READ_ONLY = new Set<ActionName>(['overview', 'pageRedirects', 'testUrl']);

function auditFields({rule, published}: WriteResult) {
  return {
    ruleKey: rule.key,
    fromPath: rule.fromPath,
    toPath: rule.toPath,
    permanent: rule.permanent,
    matchSubpaths: rule.matchSubpaths,
    enabled: rule.enabled,
    published,
  };
}

export class CmsUiExtension extends App.Function {
  public async perform(): Promise<App.Response> {
    const body = (this.request.bodyJSON ?? {}) as RequestBody;
    const action = typeof body.action === 'string' ? body.action : '';
    if (!isAction(action)) return new App.Response(400, fail('unknown_action', action.slice(0, 64)));

    // Everything inside the try: a throw that escapes perform() reaches the editor as an
    // empty "[ExtensionService] Failed to invoke function:".
    try {
      const raw = body.params && typeof body.params === 'object' && !Array.isArray(body.params) ? body.params : {};
      const params = PARSERS[action](raw as Record<string, unknown>);

      const loaded = await loadConfig();
      if (!loaded.ok) {
        return new App.Response(412, fail('not_configured', `Missing in the app settings: ${loaded.missing.join(', ')}.`));
      }
      const handler = HANDLERS[action] as (manager: Manager, params: unknown) => Promise<unknown>;
      const result = await handler(createManager(loaded.config), params);
      if (!READ_ONLY.has(action)) logger.info('audit', action, auditFields(result as WriteResult));
      return new App.Response(200, ok(result));
    } catch (error) {
      if (error instanceof ActionError) return new App.Response(400, fail(error.code, error.message));
      if (error instanceof ApiError) {
        logger.warn('Upstream API error', action, error.code, error.message);
        return new App.Response(502, fail(error.code, error.message));
      }
      logger.error('CmsUiExtension failure', action, error);
      return new App.Response(500, fail('internal_error'));
    }
  }
}
