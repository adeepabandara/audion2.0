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
  /**
   * Default true: dims the page, traps focus and marks the rest of the document aria-hidden.
   * Pass false inside a host page we do not own (Meet): no dimming, no aria-hidden on the host's DOM,
   * and clicks outside never dismiss (Radix mis-detects clicks inside a Shadow DOM as outside).
   */
  modal?: boolean;
  /** Drawer width in px (capped to the viewport). */
  width?: number;
}

/** Panel anchored to the right edge of the viewport. Esc and the close button dismiss it. */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  modal = true,
  width,
}: DrawerProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <ThemedPortal>
        {modal && <Dialog.Overlay className="au-overlay" />}
        <Dialog.Content
          className="au-drawer"
          style={width ? { width: `min(${width}px, 100vw)` } : undefined}
          onInteractOutside={modal ? undefined : (e) => e.preventDefault()}
        >
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
