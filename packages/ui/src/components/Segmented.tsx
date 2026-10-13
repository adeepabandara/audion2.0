import * as RadioGroup from '@radix-ui/react-radio-group';
import { Icon, type IconName } from '../icons';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

export interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: SegmentedOption<T>[];
  onValueChange?: (value: T) => void;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onValueChange,
}: SegmentedProps<T>) {
  return (
    <RadioGroup.Root
      className="au-segmented"
      aria-label={label}
      value={value}
      onValueChange={(v) => onValueChange?.(v as T)}
      orientation="horizontal"
    >
      {options.map((o) => (
        <RadioGroup.Item key={o.value} value={o.value} className="au-segmented__item">
          {o.icon && <Icon name={o.icon} size={16} />}
          {o.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
