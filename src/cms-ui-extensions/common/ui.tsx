import {Tooltip} from '@optiaxiom/react';
import type {ReactNode} from 'react';

// The panels' shared look, the same tokens as the Translation status extension, so every
// extension in the CMS rail reads as one family. Chip text is 4.5:1 or better on its
// background in both themes (checked for every state), and every state also carries an
// icon and a word, never color alone.
//
// Only the light theme plus an explicit data-theme="dark": the CMS host is light, and
// following the OS setting (prefers-color-scheme) painted dark surfaces on a light page.
export const STYLE = `
.ui {
  --ui-surface: #ffffff;
  --ui-raised: #fafaf8;
  --ui-line: #e4e3df;
  --ui-line-strong: #b9b7b0;
  --ui-ink: #0b0b0b;
  --ui-ink-2: #52514e;
  --ui-ink-3: #77756f;
  --ui-track: #ecebe7;
  --ui-good: #0ca30c;
  --ui-draft: #2a78d6;
  --ui-warn: #c98400;
  --ui-bad: #d0352b;
  --ui-good-text: #0b6e0b;
  --ui-draft-text: #1d5aa6;
  --ui-warn-text: #8a5a00;
  --ui-bad-text: #b3261e;
  --ui-neutral-text: #52514e;
  --ui-good-bg: #e8f6e8;
  --ui-draft-bg: #e8f1fc;
  --ui-warn-bg: #fdf3df;
  --ui-bad-bg: #fdecea;
  --ui-neutral-bg: #efeeea;
  --ui-focus: #2a78d6;
  color: var(--ui-ink);
}
:root[data-theme="dark"] .ui {
  --ui-surface: #1a1a19;
  --ui-raised: #222220;
  --ui-line: #3a3936;
  --ui-line-strong: #6b6a65;
  --ui-ink: #f0efec;
  --ui-ink-2: #c3c2b7;
  --ui-ink-3: #a3a29a;
  --ui-track: #34332f;
  --ui-good: #2fbf2f;
  --ui-draft: #3987e5;
  --ui-warn: #e0a32a;
  --ui-bad: #e8675e;
  --ui-good-text: #7fd97f;
  --ui-draft-text: #8cb8f0;
  --ui-warn-text: #f0c070;
  --ui-bad-text: #f2b8b5;
  --ui-neutral-text: #c3c2b7;
  --ui-good-bg: #1d3320;
  --ui-draft-bg: #1b2b40;
  --ui-warn-bg: #3a2e14;
  --ui-bad-bg: #3c1d1b;
  --ui-neutral-bg: #2c2b28;
}
.ui-muted { color: var(--ui-ink-2); }
.ui-faint { color: var(--ui-ink-3); }
.ui-small { font-size: 12px; line-height: 18px; }
.ui-code {
  font: 500 11px/16px ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--ui-ink-2);
  border: 1px solid var(--ui-line);
  border-radius: 4px;
  padding: 0 4px;
  white-space: nowrap;
}
.ui-code[data-wrap] { white-space: normal; overflow-wrap: anywhere; align-self: flex-start; max-width: 100%; }
.ui-chip {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 12px; line-height: 18px; font-weight: 500;
  padding: 1px 8px 1px 6px; border-radius: 999px; white-space: nowrap;
}
.ui-chip svg { flex: none; }
.ui-chip[data-state="good"] { color: var(--ui-good-text); background: var(--ui-good-bg); }
.ui-chip[data-state="draft"] { color: var(--ui-draft-text); background: var(--ui-draft-bg); }
.ui-chip[data-state="warn"] { color: var(--ui-warn-text); background: var(--ui-warn-bg); }
.ui-chip[data-state="bad"] { color: var(--ui-bad-text); background: var(--ui-bad-bg); }
.ui-chip[data-state="neutral"] { color: var(--ui-neutral-text); background: var(--ui-neutral-bg); }
.ui-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.ui-card {
  border: 1px solid var(--ui-line); border-radius: 8px; background: var(--ui-surface);
  padding: 12px; display: flex; flex-direction: column; gap: 8px; min-width: 0;
}
.ui-card[data-tone="draft"] { border-color: var(--ui-draft); }
.ui-card[data-tone="bad"] { border-color: var(--ui-bad); }
.ui-card-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 24px; }
.ui-card-title > :first-child { font-size: 14px; font-weight: 600; min-width: 0; }
.ui-card[data-folded] { padding: 4px 4px 4px 0; }
.ui-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 32px; font-size: 14px; min-width: 0; }
.ui-row + .ui-row, .ui-item + .ui-item { border-top: 1px solid var(--ui-line); padding-top: 8px; }
.ui-item { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ui-item + .ui-item { margin-top: 10px; padding-top: 10px; }
.ui-name { display: block; max-width: 100%; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ui-grow { flex: 1; min-width: 0; }
.ui-actions { display: flex; align-items: center; gap: 4px; flex: none; }
.ui-tile { border: 1px solid var(--ui-line); border-radius: 8px; padding: 12px 14px; background: var(--ui-surface); min-width: 0; }
.ui-tile-value { font-size: 24px; line-height: 32px; font-weight: 600; font-variant-numeric: tabular-nums; }
.ui-tile-label { font-size: 13px; color: var(--ui-ink-2); display: flex; align-items: center; gap: 6px; }
.ui-grid { display: grid; gap: 12px; }
.ui-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; }
.ui-table th {
  text-align: left; font-weight: 600; font-size: 12px; color: var(--ui-ink-2);
  padding: 8px 10px; border-bottom: 1px solid var(--ui-line); white-space: nowrap;
  position: sticky; top: 0; background: var(--ui-surface); z-index: 1;
}
.ui-table td { padding: 8px 10px; border-bottom: 1px solid var(--ui-line); vertical-align: top; }
.ui-table tbody tr:hover td { background: var(--ui-raised); }
.ui-num { font-variant-numeric: tabular-nums; white-space: nowrap; }
.ui-table[data-compact] { font-size: 12px; }
.ui-table[data-compact] th, .ui-table[data-compact] td { padding: 6px 6px; }
.ui-table[data-compact] th:first-child, .ui-table[data-compact] td:first-child { padding-left: 0; }
.ui-table[data-compact] th:last-child, .ui-table[data-compact] td:last-child { padding-right: 0; }
.ui-table[data-compact] tbody tr:last-child td { border-bottom: 0; }
.ui-tag { font-size: 11px; line-height: 16px; font-weight: 600; text-transform: uppercase; letter-spacing: .02em; color: var(--ui-ink-3); }
.ui-select {
  flex: 1; min-width: 0; font: inherit; font-size: 13px; line-height: 18px; color: var(--ui-ink);
  padding: 5px 8px; border: 1px solid var(--ui-line-strong); border-radius: 6px; background: var(--ui-surface);
}
.ui-select:focus-visible { outline: 2px solid var(--ui-focus); outline-offset: 1px; }
.ui-meter { height: 6px; border-radius: 3px; background: var(--ui-track); overflow: hidden; }
.ui-meter > span { display: block; height: 100%; border-radius: 3px; background: var(--ui-good); }
`;

export type ChipState = 'good' | 'draft' | 'warn' | 'bad' | 'neutral';

const ICONS = {
  check: <path d="M3.5 8.5l3 3 6-7" />,
  pencil: <path d="M10.5 3.5l2 2-6.5 6.5H4v-2zM9 5l2 2" />,
  alert: <path d="M8 3.5v5.5M8 12v.5" />,
  cross: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
  dash: <path d="M4.5 8h7" />,
  arrow: <path d="M12.5 8a4.5 4.5 0 1 1-1.3-3.2M12.5 3v2.5H10" />,
  pause: <path d="M6 4.5v7M10 4.5v7" />,
  play: <path d="M5.5 4v8l6.5-4z" />,
  clock: <path d="M8 3a5 5 0 1 0 0 10A5 5 0 0 0 8 3zM8 5.5V8l1.75 1.25" />,
  open: <path d="M9.5 3.5h3v3M12.5 3.5L7.5 8.5M11 9.5v3H3.5V5h3" />,
} as const;

export type IconName = keyof typeof ICONS;

/** The icon each state carries by default: the state reads without its color. */
const STATE_ICON: Record<ChipState, IconName> = {good: 'check', draft: 'pencil', warn: 'alert', bad: 'cross', neutral: 'dash'};

export function Icon({name, size = 14}: {name: IconName; size?: number}) {
  return (
    <svg aria-hidden fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} viewBox="0 0 16 16" width={size}>
      {ICONS[name]}
    </svg>
  );
}

/** A state in a word, with its icon. `title` adds a tooltip with the detail. */
export function Chip({state, label, icon, title}: {state: ChipState; label: ReactNode; icon?: IconName; title?: string}) {
  const chip = (
    <span className="ui-chip" data-state={state}>
      <Icon name={icon ?? STATE_ICON[state]} size={12} />
      {label}
    </span>
  );
  return title ? <Tooltip content={title}>{chip}</Tooltip> : chip;
}

/** A key, path or URL: monospaced, framed. `wrap` lets a long one break anywhere. */
export function Code({children, wrap}: {children: ReactNode; wrap?: boolean}) {
  return (
    <code className="ui-code" data-wrap={wrap ? '' : undefined}>
      {children}
    </code>
  );
}

export const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;
