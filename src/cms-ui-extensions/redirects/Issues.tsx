import {Group} from '@optiaxiom/react';
import type {RuleIssue, Severity} from '@shared/redirects';

import {Chip, type ChipState} from '../common/ui';

const STATE: Record<Severity, ChipState> = {
  error: 'bad',
  warning: 'warn',
  info: 'neutral',
};

const LABEL: Record<RuleIssue['code'], string> = {
  disabled: 'Disabled',
  invalid: 'Incomplete',
  ignored: 'Ignored by the site',
  duplicate: 'Duplicate',
  self: 'Points at itself',
  loop: 'Loop',
  chain: 'Chain',
  dead: 'Dead end',
  shadows_page: 'Hides a page',
  not_live: 'Not live yet',
  not_applied: 'Not applied yet',
};

/** The explanation without a lead-in that repeats the chip: "Dead end: /x answers ..." -> "/x answers ...". */
function detail(label: string, message: string): string {
  if (!message.toLowerCase().startsWith(`${label.toLowerCase()}: `)) return message;
  const rest = message.slice(label.length + 2);
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** One chip per problem, with its explanation under it. Nothing at all for a rule without one. */
export function Issues({issues}: {issues: RuleIssue[]}) {
  if (issues.length === 0) return null;
  return (
    <Group flexDirection="column" gap="8">
      {issues.map((issue) => (
        <Group alignItems="start" flexDirection="column" gap="2" key={issue.code}>
          <Chip icon={issue.code === 'disabled' ? 'pause' : undefined} label={LABEL[issue.code]} state={STATE[issue.severity]} />
          <span className="ui-muted ui-small">{detail(LABEL[issue.code], issue.message)}</span>
        </Group>
      ))}
    </Group>
  );
}

export const worst = (issues: RuleIssue[]): Severity | null =>
  issues.some((i) => i.severity === 'error') ? 'error' : issues.some((i) => i.severity === 'warning') ? 'warning' : null;
