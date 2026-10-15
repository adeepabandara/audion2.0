import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';
import { ThemedPortal } from '../theme';

export interface TooltipProps {
  /** Plain text, or richer content (the meeting-context panel uses a heading and a paragraph). */
  content: ReactNode;
  children: ReactNode;
  /** Which side of the trigger it opens on. Radix flips it when there is no room. */
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** Distance from the trigger in px (default 8). The meeting-context panel uses it to clear the whole card. */
  sideOffset?: number;
  /** Extra class for the bubble, for a wider or taller one. */
  className?: string;
  /** Render open (stories and tests). */
  defaultOpen?: boolean;
}

export function Tooltip({
  content,
  children,
  defaultOpen,
  side,
  align,
  sideOffset = 8,
  className,
}: TooltipProps) {
  return (
    <RadixTooltip.Provider delayDuration={300}>
      <RadixTooltip.Root defaultOpen={defaultOpen}>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <ThemedPortal>
          <RadixTooltip.Content
            className={['au-tooltip', className].filter(Boolean).join(' ')}
            sideOffset={sideOffset}
            side={side}
            align={align}
          >
            {content}
          </RadixTooltip.Content>
        </ThemedPortal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
