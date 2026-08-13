import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Plus } from 'lucide-react';
import {
  colorStyle,
  isHexColor,
  isPresetColor,
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

const PICKER_WIDTH = 260;
const PICKER_HEIGHT = 250;
const VIEWPORT_GAP = 8;
const MAX_HISTORY = 5;
const FALLBACK_COLOR: HexColor = '#4FC9DA';

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function hexToRgb(color: HexColor): Rgb {
  const normalized = normalizeHexColor(color) ?? FALLBACK_COLOR;
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

function hexToHsv(color: HexColor): Hsv {
  return rgbToHsv(hexToRgb(color));
}

function hsvToHex(hsv: Hsv): HexColor {
  return rgbToHex(hsvToRgb(hsv));
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
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [hexInput, setHexInput] = useState<HexColor>(() => normalizeHexColor(value) ?? FALLBACK_COLOR);
  // The draft hex is the authoritative committed color. HSV drives the slider
  // positions but is lossy (integer rounding), so a typed hex is stored exactly
  // rather than round-tripped through HSV.
  const [draftHex, setDraftHex] = useState<HexColor>(() => normalizeHexColor(value) ?? FALLBACK_COLOR);
  const hsvRef = useRef(hsv);
  const draftHexRef = useRef(draftHex);

  // The presets passed by the caller are the single source of truth for the
  // outer swatch row; anything not in that set counts as a custom color.
  const choices = presets
    .map((preset) => ({ value: normalizeHexColor(preset.value), label: preset.label }))
    .filter((choice): choice is { value: HexColor; label: string } => choice.value !== null);
  const normalizedValue = normalizeHexColor(value);
  const isCustom = normalizedValue !== null && !isPresetColor(normalizedValue, presets);

  // History shows only genuine custom colors: normalize, drop presets, dedupe,
  // and cap the list. The current value stays visible so a freshly picked color
  // still appears in history.
  const history = recentColors
    .map((color) => normalizeHexColor(color))
    .filter((color): color is HexColor => color !== null)
    .filter((color) => !isPresetColor(color, presets))
    .filter((color, index, list) => list.indexOf(color) === index)
    .slice(0, MAX_HISTORY);

  // While the popover is open the trigger mirrors the live draft; when closed it
  // shows the committed custom color, otherwise a neutral "add" affordance.
  const triggerColor = open ? draftHex : (isCustom ? normalizedValue ?? FALLBACK_COLOR : null);

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
      if (!customRef.current?.contains(target) && !popoverRef.current?.contains(target)) finishCustomSelection();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        finishCustomSelection();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function openPicker() {
    const seed = normalizedValue ?? FALLBACK_COLOR;
    const nextHsv = hexToHsv(seed);
    hsvRef.current = nextHsv;
    draftHexRef.current = seed;
    setHsv(nextHsv);
    setDraftHex(seed);
    setHexInput(seed);
    setOpen(true);
  }

  function finishCustomSelection() {
    if (!open) return;
    const color = draftHexRef.current;
    setOpen(false);
    onChange(color);
    if (!isPresetColor(color, presets)) onRememberColor?.(color);
  }

  function selectPreset(color: HexColor) {
    setOpen(false);
    onChange(color);
  }

  function selectHistory(color: HexColor) {
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
    const nextHex = hsvToHex(normalized);
    hsvRef.current = normalized;
    draftHexRef.current = nextHex;
    setHsv(normalized);
    setDraftHex(nextHex);
    setHexInput(nextHex);
  }

  function onHexInputChange(raw: string) {
    const next = raw.startsWith('#') ? raw : `#${raw}`;
    setHexInput(next.toUpperCase() as HexColor);
    if (isHexColor(next)) {
      const normalized = normalizeHexColor(next) as HexColor;
      const nextHsv = hexToHsv(normalized);
      hsvRef.current = nextHsv;
      draftHexRef.current = normalized;
      setHsv(nextHsv);
      setDraftHex(normalized);
    }
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
      <div className="color-picker__canvas">
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
      </div>
      <div className="color-picker__footer">
        <span className="color-picker__preview" style={{ background: draftHex }} aria-hidden="true" />
        <input
          className="color-picker__hex"
          type="text"
          inputMode="text"
          spellCheck={false}
          maxLength={7}
          aria-label="十六进制颜色值"
          value={hexInput}
          onChange={(event) => onHexInputChange(event.target.value)}
          onBlur={() => setHexInput(draftHex)}
        />
      </div>
      {history.length > 0 ? (
        <div className="color-picker__recent" role="group" aria-label="最近使用颜色">
          {history.map((color) => (
            <button
              key={color}
              type="button"
              className="color-picker__recent-color"
              aria-label={`历史颜色 ${color}`}
              style={colorStyle(color)}
              onClick={() => selectHistory(color)}
            />
          ))}
        </div>
      ) : (
        <p className="color-picker__recent-empty" role="group" aria-label="最近使用颜色">暂无历史颜色</p>
      )}
    </div>,
    document.body
  ) : null;

  return (
    <fieldset className="color-picker">
      <legend>{legend}</legend>
      <div className="color-picker__choices color-picker__choices--single-row">
        {choices.map((choice) => (
          <label key={choice.value} className="color-picker__choice" style={colorStyle(choice.value)}>
            <input
              className="form-check-input"
              type="radio"
              name={name}
              aria-label={choice.label}
              checked={normalizedValue === choice.value}
              disabled={disabled}
              onChange={() => selectPreset(choice.value)}
            />
            <span className="color-picker__swatch" aria-hidden="true" />
          </label>
        ))}
        <div ref={customRef} className="color-picker__choice color-picker__custom" style={triggerColor ? colorStyle(triggerColor) : undefined}>
          <button
            ref={triggerRef}
            type="button"
            className="color-picker__trigger"
            aria-label="选择自定义颜色"
            aria-expanded={open}
            aria-pressed={isCustom}
            disabled={disabled}
            style={triggerColor ? { background: triggerColor, borderColor: triggerColor } : undefined}
            onClick={() => {
              if (disabled) return;
              if (open) finishCustomSelection();
              else openPicker();
            }}
          >
            {triggerColor ? <span aria-hidden="true" /> : <Plus aria-hidden="true" size={18} strokeWidth={2} />}
          </button>
        </div>
      </div>
      {popover}
    </fieldset>
  );
}
