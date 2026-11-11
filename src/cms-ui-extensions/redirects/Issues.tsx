import {Badge, Group, Text} from '@optiaxiom/react';
import type {RuleIssue, Severity} from '@shared/redirects';

const INTENT: Record<Severity, 'danger' | 'warning' | 'information'> = {
  error: 'danger',
  warning: 'warning',
  info: 'information',
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

/** One badge per problem, with its explanation under it. Nothing at all for a rule without one. */
export function Issues({issues}: {issues: RuleIssue[]}) {
  if (issues.length === 0) return null;
  return (
    <Group flexDirection="column" gap="4">
      {issues.map((issue) => (
        <Group flexDirection="column" gap="2" key={issue.code}>
          <Badge intent={INTENT[issue.severity]} variant="subtle">
            {LABEL[issue.code]}
          </Badge>
          <Text color="fg.secondary" fontSize="xs">
            {issue.message}
          </Text>
        </Group>
      ))}
    </Group>
  );
}

export const worst = (issues: RuleIssue[]): Severity | null =>
  issues.some((i) => i.severity === 'error') ? 'error' : issues.some((i) => i.severity === 'warning') ? 'warning' : null;
