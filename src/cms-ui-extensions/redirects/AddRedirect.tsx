import {Alert, Button, Field, Group, Input, Switch, Text} from '@optiaxiom/react';
import type {ExtensionContext} from '@optimizely/cms-extensibility-sdk';
import {validateNewRule, type NewRule, type RawRule} from '@shared/redirects';
import type {WriteResult} from '@shared/types';
import {useMemo, useState} from 'react';

import {call, errorMessage} from '../common/api';

/**
 * Adds one redirect: a new Redirect Rule block plus a new published version of Redirect
 * Config. The same checks as the backend run as you type, so a loop or a duplicate never
 * reaches the CMS; the backend checks again against the CMS's current rules before writing.
 */
export function AddRedirect({
  context,
  existing,
  initial,
  onDone,
  onCancel,
}: {
  context: ExtensionContext;
  existing: RawRule[];
  initial?: Partial<NewRule>;
  onDone: (result: WriteResult) => void;
  onCancel: () => void;
}) {
  const [fromPath, setFromPath] = useState(initial?.fromPath ?? '');
  const [toPath, setToPath] = useState(initial?.toPath ?? '');
  const [permanent, setPermanent] = useState(initial?.permanent ?? true);
  const [matchSubpaths, setMatchSubpaths] = useState(initial?.matchSubpaths ?? false);
  const [note, setNote] = useState(initial?.note ?? '');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const input: NewRule = {fromPath, toPath, permanent, matchSubpaths, note};
  const check = useMemo(
    () => validateNewRule({fromPath, toPath, permanent, matchSubpaths, note}, existing),
    [fromPath, toPath, permanent, matchSubpaths, note, existing],
  );
  const show = touched || Boolean(fromPath && toPath);
  const valid = Object.keys(check.errors).length === 0 && Boolean(fromPath && toPath);

  async function submit() {
    setTouched(true);
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await call(context, 'addRule', input));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Group flexDirection="column" gap="12">
      <Field error={show ? check.errors.fromPath : undefined} label="From (old URL)" required>
        <Input onChange={(e) => setFromPath(e.target.value)} placeholder="/old-page" value={fromPath} />
      </Field>
      <Field
        description="A path on this site, or a full URL for another site."
        error={show ? check.errors.toPath : undefined}
        label="To (new URL)"
        required
      >
        <Input onChange={(e) => setToPath(e.target.value)} placeholder="/new-page" value={toPath} />
      </Field>
      <Switch checked={permanent} onCheckedChange={setPermanent}>
        Permanent (308). Off: temporary (307).
      </Switch>
      <Switch checked={matchSubpaths} onCheckedChange={setMatchSubpaths}>
        Also redirect everything under it
      </Switch>
      <Field description="Why the redirect exists, for the next editor." label="Note">
        <Input onChange={(e) => setNote(e.target.value)} value={note} />
      </Field>
      {check.warnings.map((w) => (
        <Alert intent="warning" key={w}>
          <Text fontSize="sm">{w}</Text>
        </Alert>
      ))}
      {error && (
        <Alert intent="danger">
          <Text fontSize="sm">{error}</Text>
        </Alert>
      )}
      <Text color="fg.tertiary" fontSize="xs">
        Publishes a Redirect Rule and a new version of Redirect Config. The site serves it once its redirect cache refreshes.
      </Text>
      <Group gap="8">
        <Button appearance="primary" disabled={show && !valid} loading={busy} onClick={() => void submit()}>
          Add redirect
        </Button>
        <Button appearance="subtle" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </Group>
    </Group>
  );
}
