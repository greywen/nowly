// Size presets for the module preview workbench. A module's iframe viewport IS
// its on-grid size, so previewing at real pixel dimensions is the only faithful
// check. The gear labels (3x2 … 12x8) mirror the grid cell counts the design
// spec uses; the pixel math below reproduces the 1280×720 default window with
// responsive gap-16 (single cell ≈ 89×63, gap 16), which is the tightest common
// case an author should design against.

export const PREVIEW_CELL_W = 89;
export const PREVIEW_CELL_H = 63;
export const PREVIEW_GAP = 16;

// Convert a gear span (in grid cells) to a pixel size, accounting for the gaps
// between cells. Pure so it can be unit-tested without a DOM.
export function gearsToPixels(
  cellsW: number,
  cellsH: number,
  cell: { w: number; h: number; gap: number } = { w: PREVIEW_CELL_W, h: PREVIEW_CELL_H, gap: PREVIEW_GAP }
): { width: number; height: number } {
  return {
    width: cellsW * cell.w + (cellsW - 1) * cell.gap,
    height: cellsH * cell.h + (cellsH - 1) * cell.gap
  };
}

export type SizePreset = {
  id: string;
  label: string;
  cellsW: number;
  cellsH: number;
  width: number;
  height: number;
};

function preset(id: string, cellsW: number, cellsH: number): SizePreset {
  const { width, height } = gearsToPixels(cellsW, cellsH);
  return { id, label: `${cellsW}×${cellsH}`, cellsW, cellsH, width, height };
}

// The four gears the design spec calls out for the workbench.
export const SIZE_PRESETS: SizePreset[] = [
  preset('3x2', 3, 2),
  preset('4x3', 4, 3),
  preset('6x4', 6, 4),
  preset('12x8', 12, 8)
];

export const DEFAULT_PRESET_ID = '4x3';

export function findPreset(id: string): SizePreset {
  return SIZE_PRESETS.find((entry) => entry.id === id) ?? SIZE_PRESETS[0];
}
