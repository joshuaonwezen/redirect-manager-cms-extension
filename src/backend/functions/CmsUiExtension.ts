import * as App from '@zaiusinc/app-sdk';
import {logger} from '@zaiusinc/app-sdk';

import type {ActionName, Envelope} from '../../shared/types';
import {ActionError} from '../lib/errors';
import {ApiError} from '../lib/http';
import {createManager} from '../lib/manager';
import {loadConfig} from '../lib/settings';

interface RequestBody {
  action?: unknown;
  params?: Record<string, unknown>;
}

function ok<T>(result: T): Envelope<T> {
  return {ok: true, result};
}

function fail(error: string, message?: string): Envelope<never> {
  return message ? {ok: false, error, message} : {ok: false, error};
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const ACTIONS: ActionName[] = ['overview', 'pageRedirects', 'testUrl', 'addRule', 'setEnabled'];

export class CmsUiExtension extends App.Function {
  public async perform(): Promise<App.Response> {
    const body = (this.request.bodyJSON ?? {}) as RequestBody;
    const action = (typeof body.action === 'string' ? body.action : '') as ActionName;
    if (!ACTIONS.includes(action)) return new App.Response(400, fail('unknown_action', action));
    const p = body.params ?? {};

    // Everything inside the try: a throw that escapes perform() reaches the editor as an
    // empty "[ExtensionService] Failed to invoke function:".
    try {
      const loaded = await loadConfig();
      if (!loaded.ok) {
        return new App.Response(412, fail('not_configured', `Missing in the app settings: ${loaded.missing.join(', ')}.`));
      }
      const manager = createManager(loaded.config);
      logger.info('action', action);
      switch (action) {
        case 'overview':
          return new App.Response(200, ok(await manager.overview()));
        case 'pageRedirects':
          return new App.Response(
            200,
            ok(await manager.pageRedirects({key: text(p.key), locale: text(p.locale) || 'en', path: text(p.path)})),
          );
        case 'testUrl':
          return new App.Response(200, ok(await manager.testUrl({path: text(p.path)})));
        case 'addRule':
          return new App.Response(
            200,
            ok(
              await manager.addRule({
                fromPath: text(p.fromPath),
                toPath: text(p.toPath),
                permanent: p.permanent === true,
                matchSubpaths: p.matchSubpaths === true,
                note: text(p.note) || undefined,
              }),
            ),
          );
        case 'setEnabled':
          return new App.Response(200, ok(await manager.setEnabled({ruleKey: text(p.ruleKey), enabled: p.enabled === true})));
      }
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
