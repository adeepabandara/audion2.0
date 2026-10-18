import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { ThemedPortal } from '../theme';
import { Button } from './Button';

export interface ModalProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Width in px (capped to the window). */
  width?: number;
}

/**
 * A pop-up in the middle of the window, over a dimmed veil. Like the Drawer it is NOT modal in Radix's sense (no
 * aria-hidden on the page behind, no outside-click dismissal): inside a Shadow DOM on someone else's page, Radix would
 * mark the host page hidden and mistake clicks in the pop-up for clicks outside it. Esc and the close button dismiss it.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  width = 520,
}: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <ThemedPortal>
        <div className="au-modal-veil" aria-hidden="true" />
        <Dialog.Content
          className="au-modal"
          style={{ width: `min(${width}px, calc(100vw - 24px))` }}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <div className="au-modal__head">
            <Dialog.Title className="au-modal__title">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" icon="x" iconOnly>
                Close {title}
              </Button>
            </Dialog.Close>
          </div>
          {description ? (
            <Dialog.Description className="au-modal__desc">{description}</Dialog.Description>
          ) : (
            <Dialog.Description className="au-sr-only">{title}</Dialog.Description>
          )}
          <div className="au-modal__body">{children}</div>
        </Dialog.Content>
      </ThemedPortal>
    </Dialog.Root>
  );
}
