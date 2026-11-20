import {Alert, Button, Group, Text} from '@optiaxiom/react';
import {register, type ExtensionContext} from '@optimizely/cms-extensibility-sdk';
import type {PageRedirects as PageResult, RuleRow, WriteResult} from '@shared/types';
import {useCallback, useEffect, useRef, useState} from 'react';

import {call} from '../common/api';
import {Frame} from '../common/Frame';
import {Code, count} from '../common/ui';
import {useContent} from '../common/useContent';
import {AddRedirect, RiskConfirm, useAddRule} from './AddRedirect';
import {Issues} from './Issues';
import {ErrorAlert, NoticeAlert, noticeOf, RuleText, useNotice} from './parts';

/**
 * The page's URL for the backend to pick its site by, or undefined. Only an https URL the
 * backend's check accepts: anything else would fail the request instead of falling back.
 */
function sitePageUrl(publicUrl: string | null): string | undefined {
  return publicUrl && /^https:\/\//i.test(publicUrl) && publicUrl.length <= 2048 ? publicUrl : undefined;
}

/** The page moved: one confirmation sends its old address here. */
function RenameFix({
  context,
  oldPath,
  pagePath,
  pageUrl,
  onDone,
}: {
  context: ExtensionContext;
  oldPath: string;
  pagePath: string;
  pageUrl?: string;
  onDone: (result: WriteResult) => void;
}) {
  const adder = useAddRule(context, onDone, pageUrl);
  return (
    <Group flexDirection="column" gap="8">
      <Alert intent="warning">
        <Group flexDirection="column" gap="8">
          <Text fontSize="sm">
            This page used to be at <Code>{oldPath}</Code>. Links and bookmarks to that address now get a &quot;page not
            found&quot;.
          </Text>
          <Text fontSize="sm">
            Send visitors from <Code>{oldPath}</Code> to this page?
          </Text>
          {!adder.pending && (
            <Button
              appearance="primary"
              loading={adder.busy}
              onClick={() =>
                void adder.submit({fromPath: oldPath, toPath: pagePath, permanent: true, matchSubpaths: false, note: 'The page was renamed.'})
              }
              size="sm"
            >
              Add redirect
            </Button>
          )}
        </Group>
      </Alert>
      <RiskConfirm adder={adder} />
      <ErrorAlert error={adder.error} />
    </Group>
  );
}

function InboundRule({rule}: {rule: RuleRow}) {
  return (
    <div className="ui-item" style={{gap: 8}}>
      <RuleText rule={rule} />
      <Issues issues={rule.issues} />
    </div>
  );
}

function PageRedirects({context}: {context: ExtensionContext}) {
  const {content, ready} = useContent(context);
  // The result remembers the page it was loaded for: right after the editor switches page,
  // until the new one arrives, nothing (no Add or rename button) may act on the old one.
  const [loaded, setLoaded] = useState<{page: string; data: PageResult} | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useNotice();
  const requestId = useRef(0);

  const load = useCallback(
    async (key: string, locale: string, path: string) => {
      const id = ++requestId.current;
      setBusy(true);
      setError(null);
      try {
        const data = await call(context, 'pageRedirects', {key, locale, path});
        if (id === requestId.current) setLoaded({page: `${key}|${locale}|${path}`, data});
      } catch (e) {
        if (id === requestId.current) setError(e);
      } finally {
        if (id === requestId.current) setBusy(false);
      }
    },
    [context],
  );

  useEffect(() => {
    setAdding(false);
    setNotice(null);
    setLoaded(null);
    setError(null);
    if (content?.path) {
      void load(content.key, content.locale, content.path);
    } else {
      requestId.current++;
      setBusy(false);
    }
  }, [content?.key, content?.locale, content?.path, load, setNotice]);

  if (!ready) return <Frame busy />;
  if (!content) {
    return (
      <Frame>
        <Text color="fg.secondary" fontSize="sm">
          Open a page to see the redirects that lead to it.
        </Text>
      </Frame>
    );
  }
  if (!content.path) {
    return (
      <Frame>
        <Alert intent="information">
          <Text fontSize="sm">This item has no address of its own, so no redirect leads to it. Open a page to see its redirects.</Text>
        </Alert>
      </Frame>
    );
  }

  const {key, locale, path} = content;
  const pageUrl = sitePageUrl(content.publicUrl);
  const result = loaded && loaded.page === `${key}|${locale}|${path}` ? loaded.data : null;
  const reload = () => void load(key, locale, path);
  const done = (r: WriteResult) => {
    setAdding(false);
    setNotice(noticeOf(r));
    reload();
  };

  const refresh = (
    <Button appearance="subtle" disabled={busy} onClick={reload} size="sm">
      Refresh
    </Button>
  );

  return (
    <Frame
      actions={result ? refresh : undefined}
      busy={busy}
      error={error}
      onRetry={reload}
      subtitle={
        <>
          Page URL <Code>{result?.path ?? path}</Code>
        </>
      }
    >
      <NoticeAlert notice={notice} />
      {result && !result.hasConfig && (
        <Alert intent="information">
          <Text fontSize="sm">This site has no redirect list yet, so redirects can&apos;t be added here. A developer sets it up once.</Text>
        </Alert>
      )}
      {result?.hasConfig && (
        <Group flexDirection="column" gap="12">
          {result.shadowedBy && (
            <Alert intent="danger">
              <Text fontSize="sm">
                Visitors who open <Code>{result.shadowedBy.via}</Code> never see this page: the redirect{' '}
                <Code>{result.shadowedBy.rule.fromPath}</Code> → <Code>{result.shadowedBy.rule.toPath}</Code> sends them away
                first. Disable it in Extensions &gt; Redirects if that isn&apos;t intended.
              </Text>
            </Alert>
          )}

          {result.urlChanges.map(({oldPath, coveredBy}) =>
            coveredBy ? (
              <span className="ui-muted" key={oldPath} style={{fontSize: 13}}>
                Its old address <Code>{oldPath}</Code> redirects to <Code>{coveredBy.toPath}</Code>.
              </span>
            ) : (
              <RenameFix
                context={context}
                key={oldPath}
                oldPath={oldPath}
                onDone={done}
                pagePath={result.path}
                pageUrl={pageUrl}
              />
            ),
          )}

          <div className="ui-card">
            <div className="ui-card-title">
              <span>Redirects to this page</span>
              <span className="ui-faint ui-small">{result.inbound.length || 'none'}</span>
            </div>
            {result.inbound.length === 0 ? (
              <span className="ui-muted ui-small">No redirect sends visitors here yet.</span>
            ) : (
              <div>
                {result.inbound.map((rule) => (
                  <InboundRule key={rule.key} rule={rule} />
                ))}
              </div>
            )}
            {adding ? (
              <div style={{borderTop: '1px solid var(--ui-line)', paddingTop: 12}}>
                <AddRedirect
                  context={context}
                  existing={result.rules}
                  fixedTo={result.path}
                  onCancel={() => setAdding(false)}
                  onDone={done}
                  pageUrl={pageUrl}
                />
              </div>
            ) : (
              <div>
                <Button onClick={() => setAdding(true)} size="sm">
                  Add a redirect to this page
                </Button>
              </div>
            )}
          </div>
          <span className="ui-faint ui-small">
            The site has {count(result.rules.length, 'redirect')}. Extensions &gt; Redirects lists them all, with checks.
          </span>
        </Group>
      )}
    </Frame>
  );
}

register((context) => <PageRedirects context={context} />);
