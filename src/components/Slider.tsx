type SliderProps = {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  valueText?: string;
  onChange: (value: number) => void;
  disabled?: boolean;
  id?: string;
};

export function Slider({ label, min, max, step = 1, value, valueText, onChange, disabled, id }: SliderProps) {
  return (
    <input
      id={id}
      className="good-slider blur-slider"
      type="range"
      aria-label={label}
      aria-valuetext={valueText}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.valueAsNumber)}
    />
  );
}
