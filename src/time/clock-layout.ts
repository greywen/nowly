import type { ClockMode, WorldClock } from './time-model';

type ClockFormat = Pick<WorldClock, 'mode' | 'hourCycle' | 'showSeconds'> & Partial<Pick<WorldClock, 'layout' | 'fontMode' | 'fontSize' | 'showLabel' | 'showDate' | 'showDifference'>>;

export type ClockLayoutInput = {
  width: number;
  height: number;
  count: number;
  mode: ClockMode;
  formats?: readonly ClockFormat[];
};

export type ClockLayout = {
  columns: number;
  faceSize: number;
  fontSize: number;
  rowMinHeight: number;
  minCellWidth: number;
  showOptionalInfo: boolean;
  scroll: boolean;
};

const MIN_FACE = 72;
const MIN_FONT = 0.85;
const GAP = 12;
const MIN_DIGITAL_WIDTH = 96;
const MIN_DIGITAL_ROW = 52;
const MIN_MIXED_ROW = 116;
const MIN_ANALOG_ROW = 88;

export function computeClockLayout({ width, height, count, mode, formats = [{ mode, hourCycle: 'h23', showSeconds: false }] }: ClockLayoutInput): ClockLayout {
  const safeCount = Math.max(1, count);
  const availableWidth = Math.max(1, width);
  const availableHeight = Math.max(1, height);
  const maxColumns = mode === 'analog' && availableWidth < 220 ? 1 : safeCount;
  let best: (ClockLayout & { score: number }) | null = null;

  for (let columns = 1; columns <= maxColumns; columns += 1) {
    const rows = Math.ceil(safeCount / columns);
    const cellWidth = (availableWidth - (columns - 1) * GAP) / columns;
    const cellHeight = (availableHeight - (rows - 1) * GAP) / rows;
    const candidate = scoreCandidate(cellWidth, cellHeight, availableHeight, safeCount, columns, rows, mode, formats);
    if (columns > 1 && cellWidth < candidate.minCellWidth) continue;
    if (!best || candidate.score > best.score) best = candidate;
  }

  return best ?? scoreCandidate(availableWidth, availableHeight, availableHeight, safeCount, 1, safeCount, mode, formats);
}

function scoreCandidate(width: number, height: number, containerHeight: number, count: number, columns: number, rows: number, mode: ClockMode, formats: readonly ClockFormat[]): ClockLayout & { score: number } {
  const hasFace = mode !== 'digital';
  const hasTime = mode !== 'analog';
  const digitalMinRow = formats.some((format) => format.mode === 'digital' && format.layout === 'stacked') ? MIN_MIXED_ROW : formats.some((format) => format.mode === 'digital' && format.layout === 'date') ? MIN_ANALOG_ROW : MIN_DIGITAL_ROW;
  const baseRowHeight = mode === 'digital' ? digitalMinRow : mode === 'analog' ? MIN_ANALOG_ROW : MIN_MIXED_ROW;
  const optionalReserve = Math.max(height, baseRowHeight) > (mode === 'mixed' ? 150 : 104);
  const content = formats.map((format) => {
    const labelHeight = format.showLabel ? 0.95 * 13 * 1.5 : 0;
    const metadataCount = Number((format.mode === 'digital' && format.layout === 'date') || (optionalReserve && format.showDate === true)) + Number(optionalReserve && format.showDifference === true);
    const timeLines = format.mode === 'digital' && format.layout === 'stacked' ? (format.showSeconds ? 3 : 2) : 1;
    const timeHeight = format.mode === 'analog' ? 0 : (format.mode === 'mixed' ? 1.15 : 1.5) * 13 * 1.25 * timeLines;
    const elements = Number(format.mode !== 'digital') + Number(timeHeight > 0) + Number(labelHeight > 0) + metadataCount;
    const reserve = labelHeight + timeHeight + metadataCount * 0.85 * 13 * 1.5 + Math.max(0, elements - 1) * 8;
    return { reserve, minimum: reserve + (format.mode === 'digital' ? 0 : MIN_FACE) };
  });
  const rowMinHeight = Math.max(baseRowHeight, ...content.map((tile) => Math.ceil(tile.minimum)));
  const requiredHeight = rows * rowMinHeight + (rows - 1) * GAP;
  const effectiveHeight = Math.max(height, rowMinHeight);
  const textReserve = Math.max(hasTime ? (optionalReserve ? 48 : 36) : (optionalReserve ? 28 : 0), ...content.map((tile) => tile.reserve));
  const faceMax = hasFace ? Math.max(MIN_FACE, Math.min(width - 16, effectiveHeight - textReserve, mode === 'mixed' ? 150 : 180)) : 0;
  const fontMax = hasTime ? (mode === 'digital' ? (effectiveHeight >= 150 ? 1.75 : 1.5) : 1.15) : 0.95;
  // Reserve a conservative glyph width in the design's sans font (13px root),
  // including separators and AM/PM, so the longest time fits before choosing columns.
  const textWidth = Math.max(0, ...formats.map((format) => {
    if (format.mode === 'analog') return 0;
    const characters = format.mode === 'digital' && format.layout === 'stacked' ? (format.hourCycle === 'h12' ? 5 : 2) : 5 + (format.showSeconds ? 3 : 0) + (format.hourCycle === 'h12' ? 3 : 0);
    const fontSize = format.mode === 'mixed' ? 1.15 : fontMax;
    return Math.ceil(characters * fontSize * 13 * 0.75);
  }));
  const minCellWidth = Math.max(hasFace ? MIN_FACE : MIN_DIGITAL_WIDTH, textWidth);
  const narrowDigital = width < minCellWidth;
  const tooNarrowForFace = hasFace && width < MIN_FACE;
  const cramped = hasFace && (width < MIN_FACE || effectiveHeight - textReserve < MIN_FACE);
  const scroll = narrowDigital || cramped || requiredHeight > containerHeight || (height < 96 && mode !== 'digital');
  const readability = (hasFace ? Math.min(faceMax / MIN_FACE, 2) : 1) + (hasTime ? fontMax / MIN_FONT : 1);
  const optionalScore = optionalReserve ? 10 : 0;
  const scrollPenalty = scroll ? (mode === 'digital' ? -2 : -20) : 0;
  const widthPenalty = (narrowDigital || tooNarrowForFace) ? -100 : 0;
  const compactTextPenalty = hasTime && mode !== 'digital' && width < 128 ? -8 : 0;
  const columnPenalty = columns * (mode === 'digital' ? -0.1 : -0.6);
  const densityScore = mode === 'digital' || scroll ? columns * (mode === 'digital' ? 0.35 : 0.3) - rows * 0.05 : 0;
  const scrollRowPenalty = scroll ? rows * -0.4 : 0;
  return {
    columns,
    faceSize: hasFace ? Math.max(MIN_FACE, Math.round(faceMax)) : 0,
    fontSize: Math.max(MIN_FONT, fontMax),
    rowMinHeight,
    minCellWidth,
    showOptionalInfo: optionalReserve,
    scroll,
    score: readability + optionalScore + scrollPenalty + widthPenalty + compactTextPenalty + columnPenalty + densityScore + scrollRowPenalty - count * 0.001
  };
}

export function computeDigitalFontSize(width: number, height: number, text: string, clock: Pick<WorldClock, 'fontMode' | 'fontSize'>, layout: WorldClock['layout']): number {
  const lines = layout === 'stacked' ? text.split(':') : [text];
  const characters = Math.max(...lines.map((line) => line.length), 1);
  const preferred = clock.fontMode === 'manual' ? Math.min(160, Math.max(32, clock.fontSize ?? 96)) : 160;
  return Math.max(1, Math.min(preferred, Math.max(1, width) / (characters * 0.75), Math.max(1, height - (lines.length > 1 ? 4 : 0)) / (lines.length * 1.25))) / 13;
}
