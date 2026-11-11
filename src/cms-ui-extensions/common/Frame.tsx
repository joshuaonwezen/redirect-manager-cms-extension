import {Alert, AxiomProvider, Box, Button, Group, Heading, Spinner, Text} from '@optiaxiom/react';
import type {ReactNode} from 'react';

import {errorMessage, isNotConfigured, needsAdmin} from './api';

/**
 * The sidebar chrome: the open page's name and one context line (never the extension's
 * name - the CMS already shows that above the panel), a busy spinner and one place for
 * load errors, with Retry.
 */
export function Frame({
  heading,
  subtitle,
  busy,
  error,
  onRetry,
  children,
}: {
  heading?: string;
  subtitle?: ReactNode;
  busy?: boolean;
  error?: unknown;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  return (
    <AxiomProvider>
      <Box p="12">
        <Group flexDirection="column" gap="12">
          {(heading || subtitle || busy) && (
            <Group alignItems="start" gap="8" justifyContent="space-between">
              <Group flexDirection="column" gap="4" style={{flex: 1, minWidth: 0}}>
                {heading && <Heading level="4">{heading}</Heading>}
                {subtitle && (
                  <Text color="fg.secondary" fontSize="sm">
                    {subtitle}
                  </Text>
                )}
              </Group>
              {busy && <Spinner size="sm" />}
            </Group>
          )}
          {error ? (
            <Alert intent={needsAdmin(error) ? 'warning' : 'danger'}>
              <Group flexDirection="column" gap="8">
                <Text fontSize="sm">{errorMessage(error)}</Text>
                {isNotConfigured(error) && (
                  <Text fontSize="sm">Ask a CMS admin to fill them in on this app&apos;s settings page.</Text>
                )}
                {!needsAdmin(error) && onRetry && (
                  <Button onClick={onRetry} size="sm">
                    Retry
                  </Button>
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
