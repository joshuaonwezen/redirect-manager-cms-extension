import {Button, Tooltip} from '@optiaxiom/react';
import {useEffect, useRef, useState, type MouseEvent, type ReactNode} from 'react';

import {copyToClipboard} from './clipboard';
import {Icon} from './ui';

// How long a click gets to take the editor away (the new tab takes focus) before it counts
// as blocked, and how long the button then says what happened.
const WATCH_MS = 700;
const NOTICE_MS = 5000;

const COPIED_TIP =
  "The CMS doesn't let extensions open new tabs, so the link was copied: paste it into a new tab. Right-click › Open link in new tab also works.";
const MANUAL_TIP = "The CMS doesn't let extensions open new tabs. Right-click › Open link in new tab.";

/**
 * A link to `url`, shaped like a button, that opens in a new tab. The CMS loads extensions
 * in a sandboxed iframe that doesn't allow new tabs: a click then does nothing at all (and
 * window.open returns null). So this is a real link, which right-click › Open link in new tab
 * and dragging to the tab bar still open, and when a click leaves the editor where it was,
 * the link is copied and the button says so. If the CMS ever allows new tabs, the click
 * just opens it.
 */
export function OpenLink({
  url,
  children,
  appearance = 'default',
  size,
  iconOnly = false,
}: {
  url: string;
  /** The button's words; with `iconOnly`, its accessible name. */
  children: ReactNode;
  appearance?: 'default' | 'primary' | 'subtle';
  size?: 'sm' | 'md';
  iconOnly?: boolean;
}) {
  const [note, setNote] = useState<'copied' | 'manual' | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // Cmd/Ctrl/Shift-clicks are the browser's own way to open a link; leave them be.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    let left = false;
    const leave = () => {
      left = true;
    };
    window.addEventListener('blur', leave);
    document.addEventListener('visibilitychange', leave);
    later(() => {
      window.removeEventListener('blur', leave);
      document.removeEventListener('visibilitychange', leave);
      if (left || document.visibilityState === 'hidden') return;
      // Still within the click's user activation, which the clipboard needs.
      void copyToClipboard(url).then((ok) => {
        setNote(ok ? 'copied' : 'manual');
        later(() => setNote(null), NOTICE_MS);
      });
    }, WATCH_MS);
  };

  const label = note === 'copied' ? 'Link copied' : note === 'manual' ? 'Right-click to open' : iconOnly ? null : children;

  return (
    <Tooltip content={note === 'copied' ? COPIED_TIP : MANUAL_TIP} open={note !== null}>
      <Button
        addonAfter={label === null ? undefined : <Icon name={note ? 'check' : 'open'} size={12} />}
        appearance={appearance}
        asChild
        icon={label === null ? <Icon name="open" size={14} /> : undefined}
        size={size}
      >
        <a aria-label={iconOnly ? String(children) : undefined} href={url} onClick={onClick} rel="noopener noreferrer" target="_blank">
          {label}
        </a>
      </Button>
    </Tooltip>
  );
}
