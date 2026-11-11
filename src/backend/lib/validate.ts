import {ADD_CONFIRMS, fromPathProblem, isAddConfirm, toPathProblem, UNSAFE_PATH_CHARS, type AddConfirm} from '../../shared/redirects';
import type {ActionName, ActionParams} from '../../shared/types';
import {ActionError} from './errors';

// Every value below ends up in a CMS URL path, a Graph query, a fetch to the site or a
// published rule, so each is checked here, before any handler runs.

const CONTENT_KEY = /^[0-9a-f]{32}$/;
const LOCALE = /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/;
const MAX_URL = 2048;
const MAX_NOTE = 500;

function invalid(field: string, why: string): never {
  throw new ActionError('invalid_input', `${field}: ${why}`);
}

function str(raw: unknown, field: string, {optional = false, max = MAX_URL} = {}): string {
  if (raw === undefined || raw === null || raw === '') {
    if (optional) return '';
    invalid(field, 'required.');
  }
  if (typeof raw !== 'string') invalid(field, 'expected text.');
  if (raw.length > max) invalid(field, `at most ${max} characters.`);
  return raw.trim();
}

/** A CMS content key: the editor reports keys with or without dashes. */
export function contentKey(raw: unknown, field: string): string {
  const key = str(raw, field, {max: 64}).replace(/-/g, '').toLowerCase();
  if (!CONTENT_KEY.test(key)) invalid(field, 'not a CMS content key.');
  return key;
}

function locale(raw: unknown): string {
  const value = str(raw, 'Language', {optional: true, max: 35});
  if (value && !LOCALE.test(value)) invalid('Language', 'not a language code.');
  return value || 'en';
}

function fromPath(raw: unknown): string {
  const value = str(raw, 'From');
  if (!value.startsWith('/')) invalid('From', 'a path on this site, starting with /.');
  const problem = fromPathProblem(value);
  if (problem) invalid('From', problem);
  return value;
}

function toPath(raw: unknown): string {
  const value = str(raw, 'To');
  if (!value.startsWith('/') && !/^https:\/\//i.test(value)) invalid('To', 'a path starting with /, or a full https:// address.');
  const problem = toPathProblem(value);
  if (problem) invalid('To', problem);
  return value;
}

function confirms(raw: unknown): AddConfirm[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > ADD_CONFIRMS.length) invalid('confirm', 'expected a short list.');
  return raw.map((code) => {
    if (typeof code !== 'string' || !isAddConfirm(code)) invalid('confirm', 'unknown confirmation.');
    return code;
  });
}

type Parsers = {[A in ActionName]: (raw: Record<string, unknown>) => ActionParams[A]};

/** One parser per action: unknown fields are dropped, every kept field is checked. */
export const PARSERS: Parsers = {
  overview: () => ({}) as Record<string, never>,
  pageRedirects: (p) => {
    const path = str(p.path, 'Page path');
    if (!path.startsWith('/') || UNSAFE_PATH_CHARS.test(path)) invalid('Page path', 'expected a path like /en/about.');
    return {key: contentKey(p.key, 'Page key'), locale: locale(p.locale), path};
  },
  testUrl: (p) => {
    const url = str(p.url, 'Address');
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      try {
        if (!/^https?:$/.test(new URL(url).protocol)) throw new Error('not http(s)');
      } catch {
        throw new ActionError('invalid_url', 'That address isn\'t valid. Type a path like /savings, or a full address on the site.');
      }
    }
    return {url};
  },
  addRule: (p) => ({
    fromPath: fromPath(p.fromPath),
    toPath: toPath(p.toPath),
    permanent: p.permanent === true,
    matchSubpaths: p.matchSubpaths === true,
    note: str(p.note, 'Note', {optional: true, max: MAX_NOTE}) || undefined,
    confirm: confirms(p.confirm),
  }),
  setEnabled: (p) => ({ruleKey: contentKey(p.ruleKey, 'Rule key'), enabled: p.enabled === true}),
};

export function isAction(action: string): action is ActionName {
  return Object.prototype.hasOwnProperty.call(PARSERS, action);
}
