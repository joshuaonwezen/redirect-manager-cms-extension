import {
  Alert,
  AxiomProvider,
  Box,
  Button,
  Disclosure,
  DisclosureContent,
  DisclosureTrigger,
  Group,
  Input,
  Spinner,
  Switch,
  Text,
} from '@optiaxiom/react';
import {register, type ExtensionContext} from '@optimizely/cms-extensibility-sdk';
import type {Overview, RuleRow, TestResult, WriteResult} from '@shared/types';
import {useCallback, useEffect, useState} from 'react';

import {call, errorMessage, isNotConfigured, isSiteUnknown} from '../common/api';
import {OpenLink} from '../common/OpenLink';
import {Code, count, Icon, STYLE, type ChipState, type IconName} from '../common/ui';
import {AddRedirect} from './AddRedirect';
import {Issues, worst} from './Issues';
import {destinationUrl, ErrorAlert, NoticeAlert, noticeOf, RuleText, useNotice} from './parts';

const TIME = new Intl.DateTimeFormat('en-GB', {hour: '2-digit', minute: '2-digit'});

const isWebUrl = (url: string) => /^https?:\/\//i.test(url);

function TestUrl({context}: {context: ExtensionContext}) {
  const [url, setUrl] = useState('');
  const [result, setResult] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function test() {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await call(context, 'testUrl', {url}));
    } catch (e) {
      setResult(null);
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Group flexDirection="column" gap="8" pb="8" pl="12" pr="8" pt="4">
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
      <ErrorAlert error={error} />
      {result && (
        <Group flexDirection="column" gap="4">
          {result.hops.length === 0 ? (
            <Text fontSize="sm">
              No redirect: <Code>{result.path}</Code> opens as it is.
            </Text>
          ) : (
            result.hops.map((hop, i) => (
              <Text fontSize="sm" key={`${hop.from}-${i}`}>
                <Code>{hop.from}</Code> → <Code>{hop.to}</Code>{' '}
                <span className="ui-faint">({hop.status === 308 ? 'permanent' : 'temporary'})</span>
              </Text>
            ))
          )}
          {result.ignored && (
            <Alert intent="warning">
              <Text fontSize="sm">
                The site ignores the redirect to <Code>{result.ignored}</Code>: browsers would read it as another website. Visitors
                stay on <Code>{result.final}</Code>.
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
              <Code>{result.final}</Code>: {result.finalStatus.text}
            </Text>
          )}
          {!result.finalStatus && !result.loop && result.hops.length > 0 && (
            <Text color="fg.secondary" fontSize="sm">
              Ends on another website: <Code>{result.final}</Code>
            </Text>
          )}
          {isWebUrl(result.openUrl) && (
            <div>
              <OpenLink size="sm" url={result.openUrl}>
                Open on the site
              </OpenLink>
            </div>
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

const TILES: Array<{key: 'all' | 'error' | 'warning' | 'disabled'; label: string; state: ChipState; icon: IconName}> = [
  {key: 'all', label: 'Redirects', state: 'good', icon: 'arrow'},
  {key: 'error', label: 'With a problem', state: 'bad', icon: 'cross'},
  {key: 'warning', label: 'Worth a look', state: 'warn', icon: 'alert'},
  {key: 'disabled', label: 'Disabled', state: 'neutral', icon: 'pause'},
];

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
  const tally = {
    all: rules.length,
    error: rules.filter((r) => worst(r.issues) === 'error').length,
    warning: rules.filter((r) => worst(r.issues) === 'warning').length,
    disabled: rules.filter((r) => !r.enabled).length,
  };

  return (
    <AxiomProvider>
      <style>{STYLE}</style>
      <Box className="ui" p="24">
        <Group flexDirection="column" gap="20">
          <Group alignItems="start" gap="16" justifyContent="space-between">
            <Group flexDirection="column" gap="4">
              <Text fontSize="lg" fontWeight="600">
                {overview?.config ? `${count(rules.length, 'redirect')} on the site` : 'Redirects'}
              </Text>
              <Text color="fg.secondary" fontSize="sm">
                Every redirect the site applies before a page loads
                {overview?.config ? `, on ${overview.siteUrl.replace(/^https:\/\//, '')}` : ''}. When two overlap, the one
                with the longer From address wins.
              </Text>
            </Group>
            <Group gap="8" style={{flex: 'none'}}>
              {overview?.config && !adding && (
                <Button appearance="primary" onClick={() => setAdding(true)} size="sm">
                  Add redirect
                </Button>
              )}
              <Button appearance="subtle" loading={loading} onClick={() => void load()} size="sm">
                Refresh
              </Button>
            </Group>
          </Group>

          {error ? (
            <Alert intent={isNotConfigured(error) || isSiteUnknown(error) ? 'warning' : 'danger'}>
              <Text fontSize="sm">
                {errorMessage(error)}
                {isNotConfigured(error)
                  ? " Ask a CMS admin to fill them in on this app's settings page."
                  : isSiteUnknown(error)
                    ? ''
                    : ' Refresh to try again.'}
              </Text>
            </Alert>
          ) : null}
          {!overview && !error && (
            <Group gap="8">
              <Spinner size="sm" />
              <Text color="fg.secondary" fontSize="sm">
                Checking every redirect on the site…
              </Text>
            </Group>
          )}
          <NoticeAlert notice={notice} />
          {overview && !overview.config && (
            <Alert intent="information">
              <Text fontSize="sm">
                This site has no redirect list yet, so redirects can&apos;t be added here. A developer sets it up once.
              </Text>
            </Alert>
          )}

          {overview?.config && rules.length > 0 && (
            <div className="ui-grid" style={{gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))'}}>
              {TILES.map((t) => (
                <div className="ui-tile" key={t.key}>
                  <div className="ui-tile-label">
                    <span className="ui-chip" data-state={t.state} style={{padding: 2}}>
                      <Icon name={t.icon} size={12} />
                    </span>
                    {t.label}
                  </div>
                  <div className="ui-tile-value">{tally[t.key].toLocaleString('en-GB')}</div>
                </div>
              ))}
            </div>
          )}
          {overview?.config && <SiteStatus overview={overview} />}

          {adding && overview?.config && (
            <div className="ui-card" style={{maxWidth: 560}}>
              <div className="ui-card-title">
                <span>Add a redirect</span>
              </div>
              <AddRedirect
                context={context}
                existing={rules}
                onCancel={() => setAdding(false)}
                onDone={(result) => {
                  setAdding(false);
                  changed(result);
                }}
              />
            </div>
          )}

          {overview?.config && (
            <div className="ui-card" data-folded="">
              <Disclosure>
                <DisclosureTrigger>
                  <Text fontSize="sm" fontWeight="600">
                    Test a URL
                  </Text>
                </DisclosureTrigger>
                <DisclosureContent>
                  <TestUrl context={context} />
                </DisclosureContent>
              </Disclosure>
            </div>
          )}

          {overview?.config && rules.length === 0 && (
            <Text color="fg.secondary" fontSize="sm">
              No redirects yet. Use Add redirect to send visitors from an old address to a new one.
            </Text>
          )}
          {overview && rules.length > 0 && (
            <Group flexDirection="column" gap="8">
              <div style={{overflowX: 'auto'}}>
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th>Redirect</th>
                      <th>Problems</th>
                      <th style={{width: 90}}>Enabled</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((rule) => {
                      const open = destinationUrl(overview.siteUrl, rule.toPath);
                      return (
                        <tr key={rule.key} style={rule.enabled ? undefined : {opacity: 0.7}}>
                          <td style={{minWidth: 300}}>
                            <RuleText
                              open={
                                open ? (
                                  <OpenLink appearance="subtle" iconOnly size="sm" url={open}>
                                    Open the destination
                                  </OpenLink>
                                ) : undefined
                              }
                              rule={rule}
                            />
                          </td>
                          <td style={{minWidth: 240}}>
                            {rule.issues.length > 0 ? <Issues issues={rule.issues} /> : <span className="ui-faint">–</span>}
                          </td>
                          <td>
                            <EnabledCell context={context} onChanged={changed} rule={rule} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <span className="ui-faint ui-small">Checked at {TIME.format(new Date(overview.checkedAt))}.</span>
            </Group>
          )}
        </Group>
      </Box>
    </AxiomProvider>
  );
}

register((context) => <RedirectManager context={context} />);
