// The contract between the view/sidebar and the cms_extension function. The UI sends
// {action, params}; the function answers with an Envelope.

import type {AddConfirm, NewRule, RuleIssue} from './redirects';

export type Envelope<T> =
  | {ok: true; result: T}
  | {ok: false; error: string; message?: string};

/** One RedirectRule block, as Graph has it (published). */
export interface RuleRow {
  key: string;
  displayName: string;
  fromPath: string;
  toPath: string;
  permanent: boolean;
  matchSubpaths: boolean;
  enabled: boolean;
  note: string;
  issues: RuleIssue[];
}

export interface ConfigInfo {
  key: string;
  notes: string;
  lastModified: string | null;
}

export interface Overview {
  /** The Redirect Config the site reads: the newest one. Null when the instance has none. */
  config: ConfigInfo | null;
  /** Older Redirect Config items the site never reads. */
  ignoredConfigs: number;
  rules: RuleRow[];
  /** What the site serves right now (its /api/redirects); null when it couldn't be read. */
  live: {count: number; pendingChanges: number} | null;
  /** The site the checks ran on: the Site URL setting, else the CMS's only site. */
  siteUrl: string;
  checkedAt: string;
}

export interface PageRedirects {
  path: string;
  locale: string;
  /** False when the site has no redirect list (Redirect Config) yet: nothing can be added. */
  hasConfig: boolean;
  rules: RuleRow[];
  /** Rules that end on this page. */
  inbound: RuleRow[];
  /** A rule that sends visitors away from this page's own URL, so they can't reach it. */
  shadowedBy: {rule: RuleRow; via: string} | null;
  /** Earlier URLs of this page (an older URL segment), and the rule that covers each, if any. */
  urlChanges: Array<{oldPath: string; coveredBy: RuleRow | null}>;
}

export interface TestResult {
  path: string;
  hops: Array<{from: string; to: string; status: 307 | 308; ruleKey: string}>;
  final: string;
  loop: boolean;
  /** A destination the site refused to follow, because browsers would read it as another website. */
  ignored: string | null;
  /** How the final destination answers on the site; null for an external URL. */
  finalStatus: {status: number | null; text: string; ok: boolean} | null;
  /** The tested address on the site, to open in a new tab. */
  openUrl: string;
}

export interface WriteResult {
  /** False when the instance needs approval: the change is saved as a draft for a reviewer. */
  published: boolean;
  /** True when one of the two writes went through and the other didn't: `message` says which. */
  partial?: boolean;
  message: string;
  /** The rule as written, for the audit log. */
  rule: {key: string; fromPath: string; toPath: string; permanent: boolean; matchSubpaths: boolean; enabled: boolean};
}

export type AddRuleParams = NewRule & {
  /** Risks the editor has seen and accepted ("Continue anyway"). */
  confirm: AddConfirm[];
  /**
   * From the sidebar: the open page's URL as the CMS reports it, so the rule is checked on
   * that page's site. The backend uses it only when its host is one of the CMS's sites.
   */
  pageUrl?: string;
};

export type ActionParams = {
  overview: Record<string, never>;
  pageRedirects: {key: string; locale: string; path: string};
  testUrl: {url: string};
  addRule: AddRuleParams;
  setEnabled: {ruleKey: string; enabled: boolean};
};

export type ActionResults = {
  overview: Overview;
  pageRedirects: PageRedirects;
  testUrl: TestResult;
  addRule: WriteResult;
  setEnabled: WriteResult;
};

export type ActionName = keyof ActionParams;
