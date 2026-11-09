import {
  Alert,
  AxiomProvider,
  Badge,
  Box,
  Button,
  Group,
  Heading,
  Input,
  Spinner,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
} from '@optiaxiom/react';
import {register, type ExtensionContext} from '@optimizely/cms-extensibility-sdk';
import type {Overview, RuleRow, TestResult} from '@shared/types';
import {useCallback, useEffect, useState} from 'react';

import {call, errorMessage, isNotConfigured} from '../common/api';
import {AddRedirect} from './AddRedirect';
import {Issues, worst} from './Issues';

const mono = {fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflowWrap: 'anywhere' as const};

function TestUrl({context}: {context: ExtensionContext}) {
  const [path, setPath] = useState('');
  const [result, setResult] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function test() {
    if (!path.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await call(context, 'testUrl', {path}));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Group flexDirection="column" gap="8">
      <Text fontSize="sm" fontWeight="600">
        Test a URL
      </Text>
      <Group gap="8">
        <div style={{flex: 1, maxWidth: 420}}>
          <Input
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void test()}
            placeholder="/savings-accounts"
            value={path}
          />
        </div>
        <Button loading={busy} onClick={() => void test()}>
          Test
        </Button>
      </Group>
      {error && (
        <Alert intent="danger">
          <Text fontSize="sm">{error}</Text>
        </Alert>
      )}
      {result && (
        <Group flexDirection="column" gap="4">
          {result.hops.length === 0 ? (
            <Text fontSize="sm">No redirect: {result.path} is served as it is.</Text>
          ) : (
            result.hops.map((hop, i) => (
              <Text fontSize="sm" key={`${hop.from}-${i}`}>
                <span style={mono}>{hop.from}</span> → <span style={mono}>{hop.to}</span> ({hop.status})
              </Text>
            ))
          )}
          {result.loop && (
            <Alert intent="danger">
              <Text fontSize="sm">The redirects never settle: visitors get a browser error.</Text>
            </Alert>
          )}
          {result.finalStatus && (
            <Text color={result.finalStatus.ok ? 'fg.secondary' : 'fg.error'} fontSize="sm">
              {result.final}: {result.finalStatus.text}
            </Text>
          )}
          {!result.finalStatus && !result.loop && result.hops.length > 0 && (
            <Text color="fg.secondary" fontSize="sm">
              Ends on another site: {result.final}
            </Text>
          )}
        </Group>
      )}
    </Group>
  );
}

function EnabledCell({
  context,
  rule,
  onChanged,
}: {
  context: ExtensionContext;
  rule: RuleRow;
  onChanged: (message: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const result = await call(context, 'setEnabled', {ruleKey: rule.key, enabled: !rule.enabled});
      setConfirming(false);
      onChanged(result.message);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Group flexDirection="column" gap="4">
      <Switch checked={rule.enabled} disabled={busy} onCheckedChange={() => setConfirming(true)} />
      {confirming && (
        <Group flexDirection="column" gap="4">
          <Text fontSize="xs">{rule.enabled ? 'Disable' : 'Enable'} this redirect?</Text>
          <Group gap="4">
            <Button appearance="primary" loading={busy} onClick={() => void apply()} size="sm">
              {rule.enabled ? 'Disable' : 'Enable'}
            </Button>
            <Button appearance="subtle" disabled={busy} onClick={() => setConfirming(false)} size="sm">
              Cancel
            </Button>
          </Group>
        </Group>
      )}
      {error && (
        <Text color="fg.error" fontSize="xs">
          {error}
        </Text>
      )}
    </Group>
  );
}

function RedirectManager({context}: {context: ExtensionContext}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await call(context, 'overview', {}));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [context]);

  useEffect(() => {
    void context.extension.setReady();
    void load();
  }, [context, load]);

  const changed = (message: string) => {
    setNotice(message);
    void load();
  };

  const rules = overview?.rules ?? [];
  const errors = rules.filter((r) => worst(r.issues) === 'error').length;
  const warnings = rules.filter((r) => worst(r.issues) === 'warning').length;

  return (
    <AxiomProvider>
      <Box p="24">
        <Group flexDirection="column" gap="16">
          <Group alignItems="center" justifyContent="space-between">
            <Group flexDirection="column" gap="4">
              <Heading level="2">Redirects</Heading>
              <Text color="fg.secondary">
                The rules the site applies before any page renders
                {overview?.config ? ` · ${rules.length} in Redirect Config, served by ${overview.siteUrl}` : ''}.
              </Text>
            </Group>
            <Group gap="8">
              {overview?.config && !adding && (
                <Button appearance="primary" onClick={() => setAdding(true)}>
                  Add redirect
                </Button>
              )}
              <Button loading={loading} onClick={() => void load()}>
                Refresh
              </Button>
            </Group>
          </Group>

          {error ? (
            <Alert intent={isNotConfigured(error) ? 'warning' : 'danger'}>
              <Text fontSize="sm">
                {errorMessage(error)}
                {isNotConfigured(error) ? " Fill them in on the Redirects app's settings page." : ''}
              </Text>
            </Alert>
          ) : null}
          {!overview && !error && <Spinner />}
          {notice && (
            <Alert intent="success">
              <Text fontSize="sm">{notice}</Text>
            </Alert>
          )}
          {overview && !overview.config && (
            <Alert intent="information">
              <Text fontSize="sm">
                This instance has no Redirect Config yet. The site&apos;s seed-redirects.ts creates one with example rules.
              </Text>
            </Alert>
          )}
          {overview && overview.ignoredConfigs > 0 && (
            <Alert intent="warning">
              <Text fontSize="sm">
                {overview.ignoredConfigs} older Redirect Config item{overview.ignoredConfigs > 1 ? 's exist' : ' exists'}. The site
                only reads the newest one, shown here - the rules in the others do nothing.
              </Text>
            </Alert>
          )}
          {overview?.config && overview.live === null && (
            <Alert intent="warning">
              <Text fontSize="sm">
                Couldn&apos;t read {overview.siteUrl}/api/redirects, so this can&apos;t tell what the site serves right now.
              </Text>
            </Alert>
          )}
          {overview?.live && overview.live.pendingChanges > 0 && (
            <Alert intent="information">
              <Text fontSize="sm">
                {overview.live.pendingChanges} change{overview.live.pendingChanges > 1 ? 's are' : ' is'} saved but not served by the
                site yet. It catches up within a minute when the CMS publish webhook reaches the site, and within an hour without.
              </Text>
            </Alert>
          )}

          {adding && overview?.config && (
            <Box style={{maxWidth: 520}}>
              <AddRedirect
                context={context}
                existing={rules}
                onCancel={() => setAdding(false)}
                onDone={(result) => {
                  setAdding(false);
                  changed(result.message);
                }}
              />
            </Box>
          )}

          {overview?.config && <TestUrl context={context} />}

          {rules.length > 0 && (
            <>
              <Group gap="8">
                {errors > 0 && (
                  <Badge intent="danger" variant="subtle">
                    {errors} with a problem
                  </Badge>
                )}
                {warnings > 0 && (
                  <Badge intent="warning" variant="subtle">
                    {warnings} worth a look
                  </Badge>
                )}
                {errors === 0 && warnings === 0 && (
                  <Badge intent="success" variant="subtle">
                    No problems found
                  </Badge>
                )}
              </Group>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell>From</TableHeaderCell>
                    <TableHeaderCell>To</TableHeaderCell>
                    <TableHeaderCell>Type</TableHeaderCell>
                    <TableHeaderCell>Checks</TableHeaderCell>
                    <TableHeaderCell>Enabled</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((rule) => (
                    <TableRow key={rule.key}>
                      <TableCell>
                        <Text fontSize="sm" style={mono}>
                          {rule.fromPath || '-'}
                          {rule.matchSubpaths ? '/*' : ''}
                        </Text>
                        {rule.note && (
                          <Text color="fg.tertiary" fontSize="xs">
                            {rule.note}
                          </Text>
                        )}
                      </TableCell>
                      <TableCell>
                        <Text fontSize="sm" style={mono}>
                          {rule.toPath || '-'}
                        </Text>
                      </TableCell>
                      <TableCell>
                        <Text fontSize="sm">{rule.permanent ? 'Permanent (308)' : 'Temporary (307)'}</Text>
                      </TableCell>
                      <TableCell>
                        <Issues issues={rule.issues} />
                      </TableCell>
                      <TableCell>
                        <EnabledCell context={context} onChanged={changed} rule={rule} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Text color="fg.tertiary" fontSize="xs">
                Checked {overview ? new Date(overview.checkedAt).toLocaleTimeString() : ''}. Rules apply longest From first; a rule
                with /* also redirects everything under its path.
              </Text>
            </>
          )}
        </Group>
      </Box>
    </AxiomProvider>
  );
}

register((context) => <RedirectManager context={context} />);
