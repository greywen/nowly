export const ICON_STYLES = ['duotone', 'solid', 'outline'] as const;

export type IconStyle = (typeof ICON_STYLES)[number];

// The Good design baseline renders its navigation and cards in duotone.
export const DEFAULT_ICON_STYLE: IconStyle = 'duotone';

export function isIconStyle(value: unknown): value is IconStyle {
  return typeof value === 'string' && (ICON_STYLES as readonly string[]).includes(value);
}
