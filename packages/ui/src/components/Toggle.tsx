import * as Switch from '@radix-ui/react-switch';
import { useId } from 'react';
import { Icon } from '../icons';

export interface ToggleProps {
  label: string;
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  /** Hide the visible label (still the accessible name), e.g. in a header next to a title. */
  hideLabel?: boolean;
}

export function Toggle({ label, checked, onCheckedChange, disabled, hideLabel }: ToggleProps) {
  const id = useId();
  return (
    <div className="au-toggle">
      <Switch.Root
        id={id}
        className="au-switch"
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      >
        {/* The state in words, inside the switch. aria-checked already announces it, so this is decoration. */}
        <span className="au-switch__text" aria-hidden="true">
          {checked ? 'ON' : 'OFF'}
        </span>
        <Switch.Thumb className="au-switch__thumb">
          <Icon name="check" size={14} strokeWidth={3} />
        </Switch.Thumb>
      </Switch.Root>
      <label htmlFor={id} className={hideLabel ? 'au-sr-only' : undefined}>
        {label}
      </label>
    </div>
  );
}
