import {Alert, AxiomProvider, Box, Button, Group, Heading, Spinner, Text} from '@optiaxiom/react';
import type {ReactNode} from 'react';

import {errorMessage, isNotConfigured, needsAdmin} from './api';
import {STYLE} from './ui';

/**
 * The sidebar chrome: the open page's name and one context line (never the extension's
 * name - the CMS already shows that above the panel), a busy spinner and one place for
 * load errors, with Retry. It also carries the shared look (ui.tsx) for everything inside.
 */
export function Frame({
  heading,
  subtitle,
  actions,
  busy,
  error,
  onRetry,
  children,
}: {
  heading?: string;
  subtitle?: ReactNode;
  /** Buttons for the header's right-hand side, such as Refresh. */
  actions?: ReactNode;
  busy?: boolean;
  error?: unknown;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  return (
    <AxiomProvider>
      <style>{STYLE}</style>
      <Box className="ui" p="12">
        <Group flexDirection="column" gap="12">
          {(heading || subtitle || busy || actions) && (
            <Group alignItems="start" gap="8" justifyContent="space-between">
              <Group flexDirection="column" gap="4" style={{flex: 1, minWidth: 0}}>
                {heading && <Heading level="4">{heading}</Heading>}
                {subtitle && (
                  <Text color="fg.secondary" fontSize="sm">
                    {subtitle}
                  </Text>
                )}
              </Group>
              <Group alignItems="center" gap="8" style={{flex: 'none'}}>
                {busy && <Spinner size="sm" />}
                {actions}
              </Group>
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
