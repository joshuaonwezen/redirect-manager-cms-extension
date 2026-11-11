import {Alert, Button, Group, Separator, Text} from '@optiaxiom/react';
import {register, type ExtensionContext} from '@optimizely/cms-extensibility-sdk';
import type {PageRedirects as PageResult, RuleRow, WriteResult} from '@shared/types';
import {useCallback, useEffect, useRef, useState} from 'react';

import {call} from '../common/api';
import {Frame} from '../common/Frame';
import {useContent} from '../common/useContent';
import {AddRedirect, RiskConfirm, useAddRule} from './AddRedirect';
import {Issues} from './Issues';
import {mono, NoticeAlert, noticeOf, RuleText, useNotice} from './parts';

/** The page moved: one confirmation sends its old address here. */
function RenameFix({
  context,
  oldPath,
  pagePath,
  onDone,
}: {
  context: ExtensionContext;
  oldPath: string;
  pagePath: string;
  onDone: (result: WriteResult) => void;
}) {
  const adder = useAddRule(context, onDone);
  return (
    <Group flexDirection="column" gap="8">
      <Alert intent="warning">
        <Group flexDirection="column" gap="8">
          <Text fontSize="sm">
            This page used to be at <span style={mono}>{oldPath}</span>. Links and bookmarks to that address now get a &quot;page
            not found&quot;.
          </Text>
          <Text fontSize="sm">
            Send visitors from <span style={mono}>{oldPath}</span> to this page?
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
      {adder.error && (
        <Alert intent="danger">
          <Text fontSize="sm">{adder.error}</Text>
        </Alert>
      )}
    </Group>
  );
}

function InboundRule({rule}: {rule: RuleRow}) {
  return (
    <Group flexDirection="column" gap="4">
      <RuleText rule={rule} />
      <Issues issues={rule.issues} />
    </Group>
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
  const result = loaded && loaded.page === `${key}|${locale}|${path}` ? loaded.data : null;
  const reload = () => void load(key, locale, path);
  const done = (r: WriteResult) => {
    setAdding(false);
    setNotice(noticeOf(r));
    reload();
  };

  return (
    <Frame busy={busy} error={error} onRetry={reload} subtitle={`Page URL: ${result?.path ?? path}`}>
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
                Visitors who open <span style={mono}>{result.shadowedBy.via}</span> never see this page: the redirect{' '}
                <span style={mono}>{result.shadowedBy.rule.fromPath}</span> → <span style={mono}>{result.shadowedBy.rule.toPath}</span>{' '}
                sends them away first. Disable it in Extensions &gt; Redirects if that isn&apos;t intended.
              </Text>
            </Alert>
          )}

          {result.urlChanges.map(({oldPath, coveredBy}) =>
            coveredBy ? (
              <Text color="fg.secondary" fontSize="sm" key={oldPath}>
                Its old address <span style={mono}>{oldPath}</span> redirects to <span style={mono}>{coveredBy.toPath}</span>.
              </Text>
            ) : (
              <RenameFix context={context} key={oldPath} oldPath={oldPath} onDone={done} pagePath={result.path} />
            ),
          )}

          <Separator />
          <Text fontSize="sm" fontWeight="600">
            Redirects to this page ({result.inbound.length})
          </Text>
          {result.inbound.length === 0 ? (
            <Text color="fg.secondary" fontSize="sm">
              None.
            </Text>
          ) : (
            result.inbound.map((rule) => <InboundRule key={rule.key} rule={rule} />)
          )}
          {adding ? (
            <AddRedirect
              context={context}
              existing={result.rules}
              fixedTo={result.path}
              onCancel={() => setAdding(false)}
              onDone={done}
            />
          ) : (
            <Button onClick={() => setAdding(true)}>Add a redirect to this page</Button>
          )}
          <Text color="fg.tertiary" fontSize="xs">
            The site has {result.rules.length} redirect{result.rules.length === 1 ? '' : 's'}. Extensions &gt; Redirects lists them
            all, with checks.
          </Text>
        </Group>
      )}
    </Frame>
  );
}

register((context) => <PageRedirects context={context} />);
