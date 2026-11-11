import {
  Alert,
  AxiomProvider,
  Badge,
  Box,
  Button,
  Disclosure,
  DisclosureContent,
  DisclosureTrigger,
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
import type {Overview, RuleRow, TestResult, WriteResult} from '@shared/types';
import {useCallback, useEffect, useState} from 'react';

import {call, errorMessage, isNotConfigured} from '../common/api';
import {OpenLink} from '../common/OpenLink';
import {AddRedirect} from './AddRedirect';
import {Issues, worst} from './Issues';
import {destinationUrl, mono, NoticeAlert, noticeOf, RuleText, useNotice} from './parts';

const isWebUrl = (url: string) => /^https?:\/\//i.test(url);

function TestUrl({context}: {context: ExtensionContext}) {
  const [url, setUrl] = useState('');
  const [result, setResult] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function test() {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await call(context, 'testUrl', {url}));
    } catch (e) {
      setResult(null);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Group flexDirection="column" gap="8" pt="8">
      <Text color="fg.secondary" fontSize="sm">
        Every redirect a visitor to this address goes through, and where they end up.
      </Text>
      <Group gap="8">
        <div style={{flex: 1, maxWidth: 420}}>
          <Input
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void test()}
            placeholder="/savings-accounts"
            value={url}
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
            <Text fontSize="sm">
              No redirect: <span style={mono}>{result.path}</span> opens as it is.
            </Text>
          ) : (
            result.hops.map((hop, i) => (
              <Text fontSize="sm" key={`${hop.from}-${i}`}>
                <span style={mono}>{hop.from}</span> → <span style={mono}>{hop.to}</span> ({hop.status === 308 ? 'permanent' : 'temporary'})
              </Text>
            ))
          )}
          {result.ignored && (
            <Alert intent="warning">
              <Text fontSize="sm">
                The site ignores the redirect to <span style={mono}>{result.ignored}</span>: browsers would read it as another website.
                Visitors stay on <span style={mono}>{result.final}</span>.
              </Text>
            </Alert>
          )}
          {result.loop && (
            <Alert intent="danger">
              <Text fontSize="sm">The redirects never settle: visitors get a browser error.</Text>
            </Alert>
          )}
          {result.finalStatus && (
            <Text color={result.finalStatus.ok ? 'fg.secondary' : 'fg.error'} fontSize="sm">
              <span style={mono}>{result.final}</span>: {result.finalStatus.text}
            </Text>
          )}
          {!result.finalStatus && !result.loop && result.hops.length > 0 && (
            <Text color="fg.secondary" fontSize="sm">
              Ends on another website: <span style={mono}>{result.final}</span>
            </Text>
          )}
          {isWebUrl(result.openUrl) && (
            <Box>
              <OpenLink size="sm" url={result.openUrl}>
                Open on the site
              </OpenLink>
            </Box>
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
  onChanged: (result: WriteResult) => void;
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
      onChanged(result);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Group flexDirection="column" gap="4">
      <Switch aria-label="Enabled" checked={rule.enabled} disabled={busy} onCheckedChange={() => setConfirming(true)} />
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

/** One line on what the site serves right now. */
function SiteStatus({overview}: {overview: Overview}) {
  const parts: string[] = [];
  let intent: 'information' | 'warning' = 'information';
  if (overview.live === null) {
    parts.push("Couldn't ask the site which redirects are live.");
    intent = 'warning';
  } else if (overview.live.pendingChanges > 0) {
    const n = overview.live.pendingChanges;
    parts.push(`${n} change${n > 1 ? "s aren't" : " isn't"} live on the site yet: within a minute, or the hour at the latest.`);
  }
  if (overview.ignoredConfigs > 0) {
    const n = overview.ignoredConfigs;
    parts.push(`The site reads only the newest redirect list, shown here; ${n} older one${n > 1 ? 's do' : ' does'} nothing.`);
    intent = 'warning';
  }
  if (parts.length === 0) {
    return (
      <Text color="fg.secondary" fontSize="sm">
        Everything here is live on the site.
      </Text>
    );
  }
  return (
    <Alert intent={intent}>
      <Text fontSize="sm">{parts.join(' ')}</Text>
    </Alert>
  );
}

function RedirectManager({context}: {context: ExtensionContext}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useNotice();

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

  const changed = (result: WriteResult) => {
    setNotice(noticeOf(result));
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
                Every redirect the site applies before a page loads
                {overview?.config ? ` · ${rules.length} on ${overview.siteUrl}` : ''}.
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
                {isNotConfigured(error) ? " Ask a CMS admin to fill them in on this app's settings page." : ' Refresh to try again.'}
              </Text>
            </Alert>
          ) : null}
          {!overview && !error && <Spinner />}
          <NoticeAlert notice={notice} />
          {overview && !overview.config && (
            <Alert intent="information">
              <Text fontSize="sm">
                This site has no redirect list yet, so redirects can&apos;t be added here. A developer sets it up once.
              </Text>
            </Alert>
          )}
          {overview?.config && <SiteStatus overview={overview} />}

          {adding && overview?.config && (
            <Box style={{maxWidth: 520}}>
              <AddRedirect
                context={context}
                existing={rules}
                onCancel={() => setAdding(false)}
                onDone={(result) => {
                  setAdding(false);
                  changed(result);
                }}
              />
            </Box>
          )}

          {overview?.config && (
            <Disclosure>
              <DisclosureTrigger>Test a URL</DisclosureTrigger>
              <DisclosureContent>
                <TestUrl context={context} />
              </DisclosureContent>
            </Disclosure>
          )}

          {overview?.config && rules.length === 0 && (
            <Text color="fg.secondary" fontSize="sm">
              No redirects yet. Use Add redirect to send visitors from an old address to a new one.
            </Text>
          )}
          {overview && rules.length > 0 && (
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
                    <TableHeaderCell>Redirect</TableHeaderCell>
                    <TableHeaderCell>Problems</TableHeaderCell>
                    <TableHeaderCell>Enabled</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((rule) => {
                    const open = destinationUrl(overview.siteUrl, rule.toPath);
                    return (
                      <TableRow key={rule.key}>
                        <TableCell>
                          <Group flexDirection="column" gap="4">
                            <RuleText rule={rule} />
                            {open && (
                              <Box>
                                <OpenLink appearance="subtle" size="sm" url={open}>
                                  Open destination
                                </OpenLink>
                              </Box>
                            )}
                          </Group>
                        </TableCell>
                        <TableCell>
                          <Issues issues={rule.issues} />
                        </TableCell>
                        <TableCell>
                          <EnabledCell context={context} onChanged={changed} rule={rule} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <Text color="fg.tertiary" fontSize="xs">
                Checked {new Date(overview.checkedAt).toLocaleTimeString()}. When two redirects overlap, the one with the longer From
                address wins.
              </Text>
            </>
          )}
        </Group>
      </Box>
    </AxiomProvider>
  );
}

register((context) => <RedirectManager context={context} />);
