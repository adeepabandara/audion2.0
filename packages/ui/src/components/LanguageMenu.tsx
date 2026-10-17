import * as RadixPopover from '@radix-ui/react-popover';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../icons';
import { ThemedPortal } from '../theme';
import { Flag, type FlagCode } from './Flag';

export interface LanguageOption {
  value: string;
  /** The language's own name. */
  label: string;
  flag: FlagCode;
  /** A small second line, e.g. "No translation". */
  hint?: string;
}

export interface LanguageMenuProps {
  /** What the menu is for; becomes part of the button's accessible name. */
  label: string;
  value: string;
  options: LanguageOption[];
  onValueChange(value: string): void;
  side?: 'top' | 'bottom';
  align?: 'start' | 'end';
}

/**
 * A language picker with country flags: a button showing the current flag and name, and a list of choices. Built on
 * the popover (a native <select> cannot show pictures). Keyboard: Enter or Space opens it, arrows move, Enter picks,
 * Esc closes and returns focus to the button.
 */
export function LanguageMenu({
  label,
  value,
  options,
  onValueChange,
  side = 'top',
  align = 'end',
}: LanguageMenuProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0]!;

  // Inside a Shadow DOM a click can look like it came from outside, so the library's own outside-click is switched
  // off and replaced by this one, which asks the real event path.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const path = e.composedPath();
      if (list.current && path.includes(list.current)) return;
      if (trigger.current && path.includes(trigger.current)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);

  const items = () => [...(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = items();
    // Inside a Shadow DOM the focused element is found through the shadow root, not the document.
    const root = list.current?.getRootNode() as Document | ShadowRoot | undefined;
    const at = all.indexOf((root?.activeElement ?? document.activeElement) as HTMLElement);
    const move = (n: number) => {
      e.preventDefault();
      all[(n + all.length) % all.length]?.focus();
    };
    if (e.key === 'ArrowDown') move(at + 1);
    else if (e.key === 'ArrowUp') move(at - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(all.length - 1);
  };

  return (
    <RadixPopover.Root open={open} onOpenChange={setOpen}>
      <RadixPopover.Trigger asChild>
        <button
          ref={trigger}
          type="button"
          className="au-langbtn"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-label={`${label}: ${current.label}`}
          title={`${label}: ${current.label}`}
        >
          <Flag code={current.flag} />
          <span className="au-langbtn__name">{current.label}</span>
          <Icon name="chevron-down" size={14} />
        </button>
      </RadixPopover.Trigger>
      <ThemedPortal>
        <RadixPopover.Content
          className="au-langmenu"
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={8}
          onInteractOutside={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            const all = items();
            (all.find((el) => el.getAttribute('aria-selected') === 'true') ?? all[0])?.focus();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            trigger.current?.focus();
          }}
        >
          <div
            ref={list}
            id={listId}
            role="listbox"
            aria-label={label}
            onKeyDown={onKeyDown}
            className="au-langmenu__list"
          >
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                className="au-langmenu__item"
                onClick={() => {
                  onValueChange(o.value);
                  setOpen(false);
                }}
              >
                <Flag code={o.flag} />
                <span className="au-langmenu__text">
                  {o.label}
                  {o.hint && <small>{o.hint}</small>}
                </span>
                {o.value === value && <Icon name="check" size={16} />}
              </button>
            ))}
          </div>
        </RadixPopover.Content>
      </ThemedPortal>
    </RadixPopover.Root>
  );
}
