import {Button, Group, Text} from '@optiaxiom/react';
import {useState, type ReactNode} from 'react';

import {copyToClipboard} from './clipboard';

/**
 * A button that opens `url` in a new tab. The extension runs in a CMS iframe whose
 * sandbox may block popups; when window.open comes back null, show the URL with a
 * copy button instead of failing silently.
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
      opened = window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      opened = null;
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
