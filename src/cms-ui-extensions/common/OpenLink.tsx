import {Button, Group, Text} from '@optiaxiom/react';
import {useState, type ReactNode} from 'react';

import {copyToClipboard} from './clipboard';

/**
 * A button that opens `url` in a new tab. The extension runs in a CMS iframe whose
 * sandbox may block popups; only when window.open really comes back null does it show
 * the URL with a copy button instead.
 */
export function OpenLink({
  url,
  children,
  appearance = 'default',
  size,
}: {
  url: string;
  children: ReactNode;
  appearance?: 'default' | 'primary' | 'subtle';
  size?: 'sm' | 'md';
}) {
  const [blocked, setBlocked] = useState(false);
  const [copied, setCopied] = useState(false);

  const open = () => {
    let opened: Window | null = null;
    try {
      // Not the "noopener" feature: with it window.open returns null even when the tab
      // opened, so a blocked popup can't be told apart. Cut the opener link instead.
      opened = window.open(url, '_blank');
    } catch {
      opened = null;
    }
    if (opened) {
      try {
        opened.opener = null;
      } catch {
        // The tab is open either way; this only drops its link back to the editor.
      }
    }
    setBlocked(!opened);
  };

  return (
    <Group flexDirection="column" gap="4">
      <Button appearance={appearance} onClick={open} size={size}>
        {children}
      </Button>
      {blocked && (
        <Group alignItems="center" gap="4">
          <Text color="fg.secondary" fontSize="xs" style={{flex: 1, minWidth: 0, overflowWrap: 'anywhere'}}>
            {url}
          </Text>
          <Button
            appearance="subtle"
            onClick={() => void copyToClipboard(url).then(setCopied)}
            size="sm"
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </Group>
      )}
    </Group>
  );
}
