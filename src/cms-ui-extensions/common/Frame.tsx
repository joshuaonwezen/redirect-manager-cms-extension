import {Alert, AxiomProvider, Box, Group, Heading, Spinner, Text} from '@optiaxiom/react';
import type {ReactNode} from 'react';

import {errorMessage, isNotConfigured} from './api';

/** The sidebar chrome: title, a busy spinner and one place for load errors. */
export function Frame({
  title,
  subtitle,
  busy,
  error,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  busy?: boolean;
  error?: unknown;
  children?: ReactNode;
}) {
  return (
    <AxiomProvider>
      <Box p="12">
        <Group flexDirection="column" gap="12">
          <Group alignItems="center" justifyContent="space-between">
            <Heading level="4">{title}</Heading>
            {busy && <Spinner size="sm" />}
          </Group>
          {subtitle && (
            <Text color="fg.secondary" fontSize="sm">
              {subtitle}
            </Text>
          )}
          {error ? (
            <Alert intent={isNotConfigured(error) ? 'warning' : 'danger'}>
              <Group flexDirection="column" gap="8">
                <Text fontSize="sm">{errorMessage(error)}</Text>
                {isNotConfigured(error) && (
                  <Text fontSize="sm">Fill them in on the Redirects app&apos;s settings page.</Text>
                )}
              </Group>
            </Alert>
          ) : null}
          {children}
        </Group>
      </Box>
    </AxiomProvider>
  );
}
