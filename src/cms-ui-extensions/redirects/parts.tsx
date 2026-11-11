import {Alert, Group, Text} from '@optiaxiom/react';
import {isAbsolute, normalizeRedirectPath} from '@shared/redirects';
import type {RuleRow, WriteResult} from '@shared/types';
import {useEffect, useState} from 'react';

export const mono = {fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflowWrap: 'anywhere' as const};

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

/** One rule in words: where from, where to, and what kind. */
export function RuleText({rule}: {rule: Pick<RuleRow, 'fromPath' | 'toPath' | 'permanent' | 'matchSubpaths' | 'note'>}) {
  return (
    <Group flexDirection="column" gap="2">
      <Text fontSize="sm">
        <span style={mono}>{rule.fromPath || '-'}</span>
        {rule.matchSubpaths ? ' and everything under it' : ''} → <span style={mono}>{rule.toPath || '-'}</span>
      </Text>
      <Text color="fg.secondary" fontSize="xs">
        {rule.permanent ? 'Permanent' : 'Temporary'}
        {rule.note ? ` · ${rule.note}` : ''}
      </Text>
    </Group>
  );
}

/** Where a destination opens: an https address as it is, a path on the site. Null for one the site ignores. */
export function destinationUrl(siteUrl: string, toPath: string): string | null {
  const to = normalizeRedirectPath(toPath);
  if (!to || !/^https:\/\//i.test(siteUrl)) return null;
  return isAbsolute(to) ? to : `${siteUrl}${to}`;
}
