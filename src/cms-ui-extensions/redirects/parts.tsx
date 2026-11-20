import {Alert, Group, Text} from '@optiaxiom/react';
import {isAbsolute, normalizeRedirectPath} from '@shared/redirects';
import type {RuleRow, WriteResult} from '@shared/types';
import {useEffect, useState, type ReactNode} from 'react';

import {errorMessage, isNotConfigured, isSiteUnknown} from '../common/api';
import {Code} from '../common/ui';

const NOTICE_MS = 10_000;

export interface Notice {
  text: string;
  /** One of two writes failed: shown as a warning, not a success. */
  partial: boolean;
}

export const noticeOf = (result: WriteResult): Notice => ({text: result.message, partial: Boolean(result.partial)});

/** The outcome of the last change. It clears itself after a few seconds. */
export function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  return [notice, setNotice] as const;
}

export function NoticeAlert({notice}: {notice: Notice | null}) {
  if (!notice) return null;
  return (
    <Alert intent={notice.partial ? 'warning' : 'success'}>
      <Text fontSize="sm">{notice.text}</Text>
    </Alert>
  );
}

/** A failed call: a gap in the app settings as a plain warning, anything else as an error. */
export function ErrorAlert({error}: {error: unknown}) {
  if (!error) return null;
  return (
    <Alert intent={isNotConfigured(error) || isSiteUnknown(error) ? 'warning' : 'danger'}>
      <Text fontSize="sm">{errorMessage(error)}</Text>
    </Alert>
  );
}

/** One rule in words: where from, where to, and what kind. `open` sits after the destination. */
export function RuleText({
  rule,
  open,
}: {
  rule: Pick<RuleRow, 'fromPath' | 'toPath' | 'permanent' | 'matchSubpaths' | 'note'>;
  open?: ReactNode;
}) {
  return (
    <Group flexDirection="column" gap="4">
      <span style={{display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px 6px', fontSize: 13}}>
        <Code wrap>{rule.fromPath || '-'}</Code>
        {rule.matchSubpaths && <span className="ui-muted ui-small">and everything under it</span>}
        <span aria-label="to" className="ui-faint" style={{lineHeight: '16px'}}>
          →
        </span>
        <Code wrap>{rule.toPath || '-'}</Code>
        {open}
      </span>
      <span className="ui-faint ui-small">
        {rule.permanent ? 'Permanent' : 'Temporary'}
        {rule.note ? ` · ${rule.note}` : ''}
      </span>
    </Group>
  );
}

/** Where a destination opens: an https address as it is, a path on the site. Null for one the site ignores. */
export function destinationUrl(siteUrl: string, toPath: string): string | null {
  const to = normalizeRedirectPath(toPath);
  if (!to || !/^https:\/\//i.test(siteUrl)) return null;
  return isAbsolute(to) ? to : `${siteUrl}${to}`;
}
