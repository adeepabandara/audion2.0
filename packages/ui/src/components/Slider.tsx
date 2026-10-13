import * as RadixSlider from '@radix-ui/react-slider';

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onValueChange?: (value: number) => void;
  format?: (value: number) => string;
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onValueChange,
  format = String,
}: SliderProps) {
  return (
    <div className="au-field">
      <div className="au-field__head">
        <span>{label}</span>
        <span className="au-field__value" aria-hidden="true">
          {format(value)}
        </span>
      </div>
      <RadixSlider.Root
        className="au-slider"
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => v !== undefined && onValueChange?.(v)}
      >
        <RadixSlider.Track className="au-slider__track">
          <RadixSlider.Range className="au-slider__range" />
        </RadixSlider.Track>
        <RadixSlider.Thumb
          className="au-slider__thumb"
          aria-label={label}
          aria-valuetext={format(value)}
        />
      </RadixSlider.Root>
    </div>
  );
}
