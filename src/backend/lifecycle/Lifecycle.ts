import {
  AuthorizationGrantResult,
  CanUninstallResult,
  Lifecycle as AppLifecycle,
  LifecycleResult,
  LifecycleSettingsResult,
  logger,
  storage,
  SubmittedFormData,
  Request as AppRequest,
} from '@zaiusinc/app-sdk';

import {CmsClient} from '../lib/cms';
import {checkKey} from '../lib/graph';
import {ApiError} from '../lib/http';
import {CmsSettings, GraphSettings, normalizeSiteUrl, readSection} from '../lib/settings';

function text(formData: SubmittedFormData, key: string): string {
  const value = formData[key];
  return typeof value === 'string' ? value.trim() : '';
}

export class Lifecycle extends AppLifecycle {
  public async onInstall(): Promise<LifecycleResult> {
    return {success: true};
  }

  public async onUpgrade(_fromVersion: string): Promise<LifecycleResult> {
    return {success: true};
  }

  public async onFinalizeUpgrade(_fromVersion: string): Promise<LifecycleResult> {
    return {success: true};
  }

  public async onAfterUpgrade(): Promise<LifecycleResult> {
    return {success: true};
  }

  public async canUninstall(): Promise<CanUninstallResult> {
    return {uninstallable: true};
  }

  public async onUninstall(): Promise<LifecycleResult> {
    return {success: true};
  }

  public async onSettingsForm(
    section: string,
    action: string,
    formData: SubmittedFormData,
  ): Promise<LifecycleSettingsResult> {
    const result = new LifecycleSettingsResult();
    try {
      if (section === 'site' && action === 'saveSite') return await this.saveSite(formData, result);
      if (section === 'graph' && action === 'saveGraph') return await this.saveGraph(formData, result);
      if (section === 'cms' && action === 'saveCms') return await this.saveCms(formData, result);
    } catch (error) {
      logger.error('Settings save failed', error);
      return result.addToast('danger', 'Could not save settings. Try again.');
    }
    logger.warn('Unsupported section-action combination:', section, action);
    return result;
  }

  private async saveSite(formData: SubmittedFormData, result: LifecycleSettingsResult) {
    const siteUrl = normalizeSiteUrl(text(formData, 'siteUrl'));
    if (!siteUrl) return result.addError('siteUrl', 'A full https:// address, e.g. https://www.example.com.');
    try {
      const res = await fetch(siteUrl, {redirect: 'follow', signal: AbortSignal.timeout(10_000)});
      void res.body?.cancel();
      if (res.status >= 500) return result.addError('siteUrl', `The site answered ${res.status}.`);
    } catch {
      return result.addError('siteUrl', 'The site could not be reached.');
    }
    await storage.settings.put('site', {siteUrl});
    return result.addToast('success', 'Site saved.');
  }

  private async saveGraph(formData: SubmittedFormData, result: LifecycleSettingsResult) {
    const previous = await readSection<GraphSettings>('graph');
    // A secret field comes back blank when the editor didn't retype it - keep the stored one.
    const singleKey = text(formData, 'singleKey') || previous.singleKey || '';
    if (!singleKey) return result.addError('singleKey', 'Required.');
    try {
      await checkKey({singleKey});
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) {
        return result.addError('singleKey', 'Graph rejected this key.').addToast('danger', 'Graph rejected the single key.');
      }
      throw error;
    }
    await storage.settings.put('graph', {singleKey});
    return result.addToast('success', 'Graph key saved.');
  }

  private async saveCms(formData: SubmittedFormData, result: LifecycleSettingsResult) {
    const previous = await readSection<CmsSettings>('cms');
    const next: CmsSettings = {
      clientId: text(formData, 'clientId'),
      clientSecret: text(formData, 'clientSecret') || previous.clientSecret || '',
    };
    if (!next.clientId) return result.addError('clientId', 'Required.');
    if (!next.clientSecret) return result.addError('clientSecret', 'Required.');

    try {
      await new CmsClient({clientId: next.clientId, clientSecret: next.clientSecret}).token();
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) {
        return result
          .addError('clientSecret', 'The CMS rejected this client ID / secret.')
          .addToast('danger', 'The CMS rejected the API client credentials.');
      }
      throw error;
    }

    await storage.settings.put('cms', {...next});
    return result.addToast('success', 'CMS API client saved.');
  }

  public async onAuthorizationRequest(
    _section: string,
    _formData: SubmittedFormData,
  ): Promise<LifecycleSettingsResult> {
    return new LifecycleSettingsResult().addToast('danger', 'OAuth is not supported.');
  }

  public async onAuthorizationGrant(_request: AppRequest): Promise<AuthorizationGrantResult> {
    return new AuthorizationGrantResult('').addToast('danger', 'OAuth is not supported.');
  }
}
