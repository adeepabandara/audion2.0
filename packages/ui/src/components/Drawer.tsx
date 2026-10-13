import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { ThemedPortal } from '../theme';
import { Button } from './Button';

export interface DrawerProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}

/** Slides in from the right edge of the viewport/panel. Focus is trapped; Esc closes. */
export function Drawer({ open, onOpenChange, title, description, children }: DrawerProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <ThemedPortal>
        <Dialog.Overlay className="au-overlay" />
        <Dialog.Content className="au-drawer">
          <div className="au-drawer__head">
            <Dialog.Title className="au-drawer__title">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" icon="x" iconOnly>
                Close {title}
              </Button>
            </Dialog.Close>
          </div>
          {description ? (
            <Dialog.Description className="au-field__value">{description}</Dialog.Description>
          ) : (
            <Dialog.Description className="au-sr-only">{title}</Dialog.Description>
          )}
          {children}
        </Dialog.Content>
      </ThemedPortal>
    </Dialog.Root>
  );
}
