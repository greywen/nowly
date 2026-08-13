import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  buildGlobalColorPalette,
  DEFAULT_COLOR_PRESETS,
  colorStyle,
  normalizeHexColor,
  type ColorPreset,
  type HexColor
} from '../lib/color';

type ColorPickerProps = {
  legend: string;
  name: string;
  value: HexColor;
  presets: readonly ColorPreset[];
  recentColors: readonly HexColor[];
  disabled?: boolean;
  onChange(color: HexColor): void;
  onRememberColor?(color: HexColor): void;
};

type Rgb = { r: number; g: number; b: number };
type Hsv = { h: number; s: number; v: number };
type PickerPosition = { left: number; top: number };

const PICKER_WIDTH = 286;
const PICKER_HEIGHT = 222;
const VIEWPORT_GAP = 8;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function hexToRgb(color: HexColor): Rgb {
  const normalized = normalizeHexColor(color) ?? '#4FC9DA';
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16)
  };
}

function rgbToHex({ r, g, b }: Rgb): HexColor {
  const channel = (value: number) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;

  if (delta > 0) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;

  return {
    h: Math.round(hue),
    s: max === 0 ? 0 : Math.round((delta / max) * 100),
    v: Math.round(max * 100)
  };
}

function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const saturation = clamp(s, 0, 100) / 100;
  const brightness = clamp(v, 0, 100) / 100;
  const chroma = brightness * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = brightness - chroma;
  const [red, green, blue] =
    hue < 60 ? [chroma, x, 0] :
    hue < 120 ? [x, chroma, 0] :
    hue < 180 ? [0, chroma, x] :
    hue < 240 ? [0, x, chroma] :
    hue < 300 ? [x, 0, chroma] : [chroma, 0, x];

  return {
    r: (red + offset) * 255,
    g: (green + offset) * 255,
    b: (blue + offset) * 255
  };
}

function pickerPosition(anchor: DOMRect): PickerPosition {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const left = clamp(anchor.right - PICKER_WIDTH, VIEWPORT_GAP, viewportWidth - PICKER_WIDTH - VIEWPORT_GAP);
  const below = anchor.bottom + VIEWPORT_GAP;
  const top = below + PICKER_HEIGHT <= viewportHeight - VIEWPORT_GAP
    ? below
    : Math.max(VIEWPORT_GAP, anchor.top - PICKER_HEIGHT - VIEWPORT_GAP);
  return { left, top };
}

export function ColorPicker({ legend, name, value, presets, recentColors, disabled = false, onChange, onRememberColor }: ColorPickerProps) {
  const customRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PickerPosition>({ left: VIEWPORT_GAP, top: VIEWPORT_GAP });
  const palette = buildGlobalColorPalette(recentColors);
  const selectedIndex = palette.indexOf(value);
  const selectedIsCustom = !palette.includes(value);
  const customValue = selectedIsCustom ? value : value;
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsv(hexToRgb(customValue)));
  const hsvRef = useRef(hsv);
  const choices = palette.map((color, index) => ({
    value: color,
    label: DEFAULT_COLOR_PRESETS.find((preset) => preset.value === color)?.label ?? `最近颜色 ${index + 1}`
  }));

  useEffect(() => {
    const next = rgbToHsv(hexToRgb(customValue));
    hsvRef.current = next;
    setHsv(next);
  }, [customValue]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const reposition = () => {
      if (triggerRef.current) setPosition(pickerPosition(triggerRef.current.getBoundingClientRect()));
    };
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: globalThis.PointerEvent) => {
      const target = event.target as Node;
      if (!customRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  function select(color: HexColor) {
    setOpen(false);
    onChange(color);
    onRememberColor?.(color);
  }

  function commit(next: Hsv) {
    const normalized = {
      h: clamp(next.h, 0, 359),
      s: clamp(next.s, 0, 100),
      v: clamp(next.v, 0, 100)
    };
    hsvRef.current = normalized;
    setHsv(normalized);
    const color = rgbToHex(hsvToRgb(normalized));
    onChange(color);
    onRememberColor?.(color);
  }

  function updateSaturationBrightness(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    commit({
      ...hsvRef.current,
      s: ((clamp(event.clientX, bounds.left, bounds.right) - bounds.left) / bounds.width) * 100,
      v: (1 - (clamp(event.clientY, bounds.top, bounds.bottom) - bounds.top) / bounds.height) * 100
    });
  }

  function updateHue(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.height) return;
    commit({
      ...hsvRef.current,
      h: ((clamp(event.clientY, bounds.top, bounds.bottom) - bounds.top) / bounds.height) * 359
    });
  }

  function beginDrag(event: ReactPointerEvent<HTMLDivElement>, update: (event: ReactPointerEvent<HTMLDivElement>) => void) {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    update(event);
  }

  const popover = open ? createPortal(
    <div
      ref={popoverRef}
      className="color-picker__popover"
      role="dialog"
      aria-label="自定义颜色"
      style={{ position: 'fixed', left: position.left, top: position.top } as CSSProperties}
    >
      <div
        className="color-picker__sv"
        role="slider"
        tabIndex={0}
        aria-label="饱和度和亮度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.s)}
        aria-valuetext={`饱和度 ${Math.round(hsv.s)}%，亮度 ${Math.round(hsv.v)}%`}
        style={{ '--picker-hue': `hsl(${hsv.h} 100% 50%)` } as CSSProperties}
        onPointerDown={(event) => beginDrag(event, updateSaturationBrightness)}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture?.(event.pointerId)) updateSaturationBrightness(event);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') commit({ ...hsvRef.current, s: hsvRef.current.s - 1 });
          else if (event.key === 'ArrowRight') commit({ ...hsvRef.current, s: hsvRef.current.s + 1 });
          else if (event.key === 'ArrowUp') commit({ ...hsvRef.current, v: hsvRef.current.v + 1 });
          else if (event.key === 'ArrowDown') commit({ ...hsvRef.current, v: hsvRef.current.v - 1 });
          else return;
          event.preventDefault();
        }}
      >
        <span
          className="color-picker__sv-thumb"
          style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%` }}
          aria-hidden="true"
        />
      </div>
      <div
        className="color-picker__hue"
        role="slider"
        tabIndex={0}
        aria-label="色相"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={Math.round(hsv.h)}
        onPointerDown={(event) => beginDrag(event, updateHue)}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture?.(event.pointerId)) updateHue(event);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp') commit({ ...hsvRef.current, h: hsvRef.current.h - 1 });
          else if (event.key === 'ArrowDown') commit({ ...hsvRef.current, h: hsvRef.current.h + 1 });
          else return;
          event.preventDefault();
        }}
      >
        <span className="color-picker__hue-thumb" style={{ top: `${(hsv.h / 359) * 100}%` }} aria-hidden="true" />
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <fieldset className="color-picker">
      <legend>{legend}</legend>
      <div className="color-picker__choices color-picker__choices--single-row">
        {choices.map((choice, index) => (
          <label key={choice.value} className="color-picker__choice" style={colorStyle(choice.value)}>
            <input
              className="form-check-input"
              type="radio"
              name={name}
              aria-label={choice.label}
              checked={value === choice.value}
              disabled={disabled}
              onChange={() => select(choice.value)}
            />
            <span className="color-picker__swatch" aria-hidden="true" />
          </label>
        ))}
        <div ref={customRef} className="color-picker__choice color-picker__custom" style={colorStyle(customValue)}>
          <label className="form-check form-check-custom form-check-solid color-picker__custom-label">
            <input
              className="form-check-input"
              type="radio"
              name={name}
              aria-label="自定义"
              checked={selectedIsCustom}
              disabled={disabled}
              onClick={() => !disabled && setOpen(true)}
              onChange={() => undefined}
            />
            <span className="form-check-label">自定义</span>
          </label>
          <button
            ref={triggerRef}
            type="button"
            className="color-picker__trigger"
            aria-label="选择自定义颜色"
            aria-expanded={open}
            disabled={disabled}
            style={colorStyle(customValue)}
            onClick={() => setOpen((current) => !current)}
          >
            <span aria-hidden="true" />
          </button>
        </div>
      </div>
      {popover}
    </fieldset>
  );
}
