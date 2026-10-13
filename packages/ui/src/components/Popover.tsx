import * as RadixPopover from '@radix-ui/react-popover';
import type { ReactNode } from 'react';
import { ThemedPortal } from '../theme';

export interface PopoverProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The element the popover points at (e.g. the chip row). */
  anchor: ReactNode;
  title: string;
  children: ReactNode;
}

/** Popover anchored to existing content; used for the low-confidence confirm prompt. */
export function Popover({ open, onOpenChange, anchor, title, children }: PopoverProps) {
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Anchor asChild>
        <div>{anchor}</div>
      </RadixPopover.Anchor>
      <ThemedPortal>
        <RadixPopover.Content
          className="au-popover"
          side="bottom"
          align="start"
          sideOffset={8}
          aria-label={title}
        >
          <p className="au-popover__title">{title}</p>
          {children}
          <RadixPopover.Arrow style={{ fill: 'var(--au-border)' }} />
        </RadixPopover.Content>
      </ThemedPortal>
    </RadixPopover.Root>
  );
}

export function PopoverActions({ children }: { children: ReactNode }) {
  return <div className="au-popover__actions">{children}</div>;
}
