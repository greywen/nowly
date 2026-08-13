import type { CSSProperties } from 'react';

// The runtime validator is the source of truth; keeping this as a string type
// lets legacy records load during the database migration window.
export type HexColor = string;
export type ColorPreset = { value: HexColor; label: string };

export const DESIGN_COLORS = {
  primary: '#4FC9DA',
  success: '#B8D935',
  info: '#4F55DA',
  warning: '#E8C444',
  danger: '#F06445'
} as const satisfies Record<string, HexColor>;

export const MAX_RECENT_COLORS = 5;
export const DEFAULT_COLOR_VALUES = ['#4FC9DA', '#198754', '#0D6EFD', '#FFC107', '#DC3545'] as const satisfies readonly HexColor[];
export const DEFAULT_COLOR_PRESETS: readonly ColorPreset[] = [
  { value: '#4FC9DA', label: '青色' },
  { value: '#198754', label: '绿色' },
  { value: '#0D6EFD', label: '蓝色' },
  { value: '#FFC107', label: '黄色' },
  { value: '#DC3545', label: '红色' }
];
const HEX = /^#[0-9A-F]{6}$/i;

export function isHexColor(value: unknown): value is HexColor {
  return typeof value === 'string' && HEX.test(value);
}

export function normalizeHexColor(value: unknown): HexColor | null {
  return isHexColor(value) ? (value.toUpperCase() as HexColor) : null;
}

function rgb(color: HexColor): [number, number, number] {
  return [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16)) as [number, number, number];
}

function hex(channels: [number, number, number]): HexColor {
  return `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`.toUpperCase() as HexColor;
}

function mix(left: HexColor, right: HexColor, rightWeight: number): HexColor {
  const a = rgb(left);
  const b = rgb(right);
  return hex(a.map((channel, index) => channel * (1 - rightWeight) + b[index] * rightWeight) as [number, number, number]);
}

function luminance(color: HexColor): number {
  const channels = rgb(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastRatio(left: HexColor, right: HexColor): number {
  const [high, low] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

export function deriveColorTone(value: HexColor) {
  const base = normalizeHexColor(value) ?? DESIGN_COLORS.primary;
  const background = mix(base, '#FFFFFF', 0.86);
  let foreground = mix(base, '#211F1C', 0.45);
  for (let weight = 0.5; contrastRatio(foreground, background) < 4.5 && weight <= 1; weight += 0.05) {
    foreground = mix(base, '#211F1C', weight);
  }
  return { base, background, foreground };
}

export type ColorStyle = CSSProperties & {
  '--selected-color': HexColor;
  '--selected-color-bg': HexColor;
  '--selected-color-fg': HexColor;
};

export function colorStyle(color: HexColor): ColorStyle {
  const tone = deriveColorTone(color);
  return {
    '--selected-color': tone.base,
    '--selected-color-bg': tone.background,
    '--selected-color-fg': tone.foreground
  };
}

export function sanitizeRecentColors(values: unknown): HexColor[] {
  if (!Array.isArray(values)) return [];
  const result: HexColor[] = [];
  for (const value of values) {
    const normalized = normalizeHexColor(value);
    if (normalized && !result.includes(normalized)) result.push(normalized);
    if (result.length === MAX_RECENT_COLORS) break;
  }
  return result;
}

export function addRecentColor(values: readonly string[], value: string): HexColor[] {
  const normalized = normalizeHexColor(value);
  if (!normalized) return sanitizeRecentColors(values);
  const existing = sanitizeRecentColors(values).filter((color) => !DEFAULT_COLOR_VALUES.includes(color as typeof DEFAULT_COLOR_VALUES[number]));
  if (DEFAULT_COLOR_VALUES.includes(normalized as typeof DEFAULT_COLOR_VALUES[number])) return existing;
  if (existing.includes(normalized)) return [normalized, ...existing.filter((color) => color !== normalized)];
  return [normalized, ...existing].slice(0, MAX_RECENT_COLORS);
}

export function buildGlobalColorPalette(values: readonly string[]): HexColor[] {
  const history = sanitizeRecentColors(values).filter((color) => !DEFAULT_COLOR_VALUES.includes(color as typeof DEFAULT_COLOR_VALUES[number]));
  return [...history, ...DEFAULT_COLOR_VALUES.slice(history.length)].slice(0, MAX_RECENT_COLORS);
}

export function isPresetColor(color: HexColor, presets: readonly ColorPreset[]): boolean {
  return presets.some((preset) => preset.value === color);
}
