import {Alert, Button, Group, Separator, Text} from '@optiaxiom/react';
import {register, type ExtensionContext} from '@optimizely/cms-extensibility-sdk';
import type {NewRule} from '@shared/redirects';
import type {PageRedirects as PageResult} from '@shared/types';
import {useCallback, useEffect, useRef, useState} from 'react';

import {call} from '../common/api';
import {Frame} from '../common/Frame';
import {useContent} from '../common/useContent';
import {AddRedirect} from './AddRedirect';
import {Issues} from './Issues';

const TITLE = 'Redirects';
const mono = {fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflowWrap: 'anywhere' as const};

function PageRedirects({context}: {context: ExtensionContext}) {
  const content = useContent(context);
  const [result, setResult] = useState<PageResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState<Partial<NewRule> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(
    async (key: string, locale: string, path: string) => {
      const id = ++requestId.current;
      setBusy(true);
      try {
        const next = await call(context, 'pageRedirects', {key, locale, path});
        if (id !== requestId.current) return;
        setResult(next);
        setError(null);
      } catch (e) {
        if (id === requestId.current) setError(e);
      } finally {
        if (id === requestId.current) setBusy(false);
      }
    },
    [context],
  );

  useEffect(() => {
    setAdding(null);
    setNotice(null);
    if (content?.path) void load(content.key, content.locale, content.path);
    else setResult(null);
  }, [content?.key, content?.locale, content?.path, load]);

  if (!content) return <Frame busy title={TITLE} />;
  if (!content.path) {
    return (
      <Frame title={TITLE}>
        <Alert intent="information">
          <Text fontSize="sm">Redirects lead to pages. Open a page to see the redirects about it.</Text>
        </Alert>
      </Frame>
    );
  }

  const reload = () => void load(content.key, content.locale, content.path!);

  return (
    <Frame busy={busy} error={error} subtitle={result ? `Redirect rules about ${result.path}.` : undefined} title={TITLE}>
      {notice && (
        <Alert intent="success">
          <Text fontSize="sm">{notice}</Text>
        </Alert>
      )}
      {adding && result ? (
        <AddRedirect
          context={context}
          existing={result.rules}
          initial={adding}
          onCancel={() => setAdding(null)}
          onDone={(r) => {
            setAdding(null);
            setNotice(r.message);
            reload();
          }}
        />
      ) : (
        result && (
          <Group flexDirection="column" gap="12">
            {result.shadowedBy && (
              <Alert intent="danger">
                <Text fontSize="sm">
                  Visitors who open {result.shadowedBy.via} never see this page: the rule {result.shadowedBy.rule.fromPath} →{' '}
                  {result.shadowedBy.rule.toPath} sends them away first. Disable it in Extensions &gt; Redirects if that is not
                  intended.
                </Text>
              </Alert>
            )}

            {result.urlChanges.map(({oldPath, coveredBy}) =>
              coveredBy ? (
                <Text color="fg.secondary" fontSize="sm" key={oldPath}>
                  Its old URL <span style={mono}>{oldPath}</span> redirects to <span style={mono}>{coveredBy.toPath}</span>.
                </Text>
              ) : (
                <Group flexDirection="column" gap="8" key={oldPath}>
                  <Alert intent="warning">
                    <Text fontSize="sm">
                      This page used to be at {oldPath}. Links and bookmarks to that URL now get a not-found page.
                    </Text>
                  </Alert>
                  <Button
                    appearance="primary"
                    onClick={() => setAdding({fromPath: oldPath, toPath: result.path, note: 'The page was renamed.'})}
                  >
                    Redirect {oldPath} here
                  </Button>
                </Group>
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
              result.inbound.map((rule) => (
                <Group flexDirection="column" gap="4" key={rule.key}>
                  <Text fontSize="sm" style={mono}>
                    {rule.fromPath}
                    {rule.matchSubpaths ? '/*' : ''} → {rule.toPath}
                  </Text>
                  <Text color="fg.secondary" fontSize="xs">
                    {rule.permanent ? 'Permanent (308)' : 'Temporary (307)'}
                    {rule.note ? ` · ${rule.note}` : ''}
                  </Text>
                  {rule.issues.length > 0 && <Issues issues={rule.issues} />}
                </Group>
              ))
            )}
            <Button onClick={() => setAdding({toPath: result.path})}>Add a redirect to this page</Button>
            <Text color="fg.tertiary" fontSize="xs">
              {result.rules.length} rules in Redirect Config. Extensions &gt; Redirects shows them all, with checks.
            </Text>
          </Group>
        )
      )}
    </Frame>
  );
}

register((context) => <PageRedirects context={context} />);
