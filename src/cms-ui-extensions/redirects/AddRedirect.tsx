import {
  Alert,
  Button,
  Disclosure,
  DisclosureContent,
  DisclosureTrigger,
  Field,
  Group,
  Input,
  Switch,
  Text,
} from '@optiaxiom/react';
import type {ExtensionContext} from '@optimizely/cms-extensibility-sdk';
import {isAddConfirm, validateNewRule, type AddConfirm, type NewRule, type RawRule} from '@shared/redirects';
import type {AddRuleParams, WriteResult} from '@shared/types';
import {useMemo, useState} from 'react';

import {call, CallError, errorMessage} from '../common/api';
import {ErrorAlert, mono} from './parts';

/** A risky addition the backend wants confirmed, and the code that confirms it on the retry. */
interface Pending {
  params: AddRuleParams;
  code: AddConfirm;
  message: string;
}

/**
 * Sends one new rule. When the backend refuses it as risky (another website, a missing
 * destination, a page it would hide, a whole section), the refusal waits in `pending` until
 * the editor confirms it, and the retry carries that confirmation. From the sidebar,
 * `pageUrl` (the open page's URL) tells the backend which site to check the rule on.
 */
export function useAddRule(context: ExtensionContext, onDone: (result: WriteResult) => void, pageUrl?: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const send = async (params: AddRuleParams) => {
    setBusy(true);
    setError(null);
    try {
      const result = await call(context, 'addRule', params);
      setPending(null);
      onDone(result);
    } catch (e) {
      const code = e instanceof CallError ? e.code : '';
      if (isAddConfirm(code)) {
        setPending({params, code, message: errorMessage(e)});
      } else {
        setPending(null);
        setError(e);
      }
    } finally {
      setBusy(false);
    }
  };

  return {
    busy,
    error,
    pending,
    submit: (rule: NewRule) => send({...rule, confirm: [], ...(pageUrl ? {pageUrl} : {})}),
    confirm: () => (pending ? send({...pending.params, confirm: [...pending.params.confirm, pending.code]}) : Promise.resolve()),
    cancel: () => setPending(null),
  };
}

export type RuleAdder = ReturnType<typeof useAddRule>;

/** The refusal of a risky addition, with "Continue anyway". */
export function RiskConfirm({adder}: {adder: RuleAdder}) {
  if (!adder.pending) return null;
  return (
    <Alert intent="warning">
      <Group flexDirection="column" gap="8">
        <Text fontSize="sm">{adder.pending.message}</Text>
        <Group gap="8">
          <Button appearance="primary" loading={adder.busy} onClick={() => void adder.confirm()} size="sm">
            Continue anyway
          </Button>
          <Button appearance="subtle" disabled={adder.busy} onClick={adder.cancel} size="sm">
            Cancel
          </Button>
        </Group>
      </Group>
    </Alert>
  );
}

/**
 * Adds one redirect: a new Redirect Rule block plus a new published version of Redirect
 * Config. The same checks as the backend run as you type, so a loop or a duplicate never
 * reaches the CMS; the backend checks again against the CMS's current rules before writing.
 * With `fixedTo`, the destination is that page (the sidebar) and only From is asked.
 */
export function AddRedirect({
  context,
  existing,
  fixedTo,
  pageUrl,
  onDone,
  onCancel,
}: {
  context: ExtensionContext;
  existing: RawRule[];
  fixedTo?: string;
  pageUrl?: string;
  onDone: (result: WriteResult) => void;
  onCancel: () => void;
}) {
  const [fromPath, setFromPath] = useState('');
  const [toInput, setToInput] = useState('');
  const [permanent, setPermanent] = useState(true);
  const [matchSubpaths, setMatchSubpaths] = useState(false);
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const adder = useAddRule(context, onDone, pageUrl);

  const toPath = fixedTo ?? toInput;
  const check = useMemo(
    () => validateNewRule({fromPath, toPath, permanent, matchSubpaths, note}, existing),
    [fromPath, toPath, permanent, matchSubpaths, note, existing],
  );
  const show = touched || Boolean(fromPath && toPath);
  const valid = Object.keys(check.errors).length === 0;

  // A confirmation was about the rule as it was; any edit drops it.
  const edit =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      adder.cancel();
      set(value);
    };

  function submit() {
    setTouched(true);
    if (valid) void adder.submit(check.rule);
  }

  return (
    <Group flexDirection="column" gap="12">
      <Field
        description="A path on this site, like /old-page."
        error={show ? check.errors.fromPath : undefined}
        label="From (old address)"
        required
      >
        <Input onChange={(e) => edit(setFromPath)(e.target.value)} placeholder="/old-page" value={fromPath} />
      </Field>
      {fixedTo ? (
        <Text fontSize="sm">
          To: this page, <span style={mono}>{fixedTo}</span>
        </Text>
      ) : (
        <Field
          description="A path on this site, or a full https:// address for another website."
          error={show ? check.errors.toPath : undefined}
          label="To (new address)"
          required
        >
          <Input onChange={(e) => edit(setToInput)(e.target.value)} placeholder="/new-page" value={toInput} />
        </Field>
      )}
      <Disclosure>
        <DisclosureTrigger>More options</DisclosureTrigger>
        <DisclosureContent>
          <Group flexDirection="column" gap="12" pt="8">
            <Group flexDirection="column" gap="4">
              <Switch checked={permanent} onCheckedChange={edit(setPermanent)}>
                Permanent
              </Switch>
              <Text color="fg.secondary" fontSize="xs">
                Search engines move the old address&apos;s ranking to the new one. Turn it off for a temporary redirect, like a
                campaign.
              </Text>
            </Group>
            <Group flexDirection="column" gap="4">
              <Switch checked={matchSubpaths} onCheckedChange={edit(setMatchSubpaths)}>
                And everything under it
              </Switch>
              <Text color="fg.secondary" fontSize="xs">
                Also redirects longer addresses that start with From: /old/a goes to the new address followed by /a.
              </Text>
            </Group>
            <Field description="Why the redirect exists, for the next editor." label="Note">
              <Input maxLength={500} onChange={(e) => edit(setNote)(e.target.value)} value={note} />
            </Field>
          </Group>
        </DisclosureContent>
      </Disclosure>
      {check.warnings.map((w) => (
        <Alert intent="warning" key={w}>
          <Text fontSize="sm">{w}</Text>
        </Alert>
      ))}
      <ErrorAlert error={adder.error} />
      <RiskConfirm adder={adder} />
      <Text color="fg.tertiary" fontSize="xs">
        Publishes the redirect right away. It goes live on the site within a minute, or within the hour at the latest.
      </Text>
      <Group gap="8">
        <Button
          appearance="primary"
          disabled={(show && !valid) || Boolean(adder.pending)}
          loading={adder.busy && !adder.pending}
          onClick={submit}
        >
          Add redirect
        </Button>
        <Button appearance="subtle" disabled={adder.busy} onClick={onCancel}>
          Cancel
        </Button>
      </Group>
    </Group>
  );
}
