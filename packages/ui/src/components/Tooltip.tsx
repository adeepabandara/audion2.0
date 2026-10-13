import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';
import { ThemedPortal } from '../theme';

export interface TooltipProps {
  content: string;
  children: ReactNode;
  /** Render open (stories and tests). */
  defaultOpen?: boolean;
}

export function Tooltip({ content, children, defaultOpen }: TooltipProps) {
  return (
    <RadixTooltip.Provider delayDuration={300}>
      <RadixTooltip.Root defaultOpen={defaultOpen}>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <ThemedPortal>
          <RadixTooltip.Content className="au-tooltip" sideOffset={6}>
            {content}
          </RadixTooltip.Content>
        </ThemedPortal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
