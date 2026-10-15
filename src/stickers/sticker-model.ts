import { isHexColor } from '../lib/color';

export const STICKER_WIDTH = 800;
export const STICKER_HEIGHT = 600;
/** How far (in logical units) objects may extend past each stage edge to use a module that is not 4:3. */
export const STICKER_OVERSCAN = 4000;
export type StickerBounds = { left: number; top: number; right: number; bottom: number };
export const STICKER_STAGE_BOUNDS: StickerBounds = { left: 0, top: 0, right: STICKER_WIDTH, bottom: STICKER_HEIGHT };
export const STICKER_STORAGE_BOUNDS: StickerBounds = {
  left: -STICKER_OVERSCAN, top: -STICKER_OVERSCAN, right: STICKER_WIDTH + STICKER_OVERSCAN, bottom: STICKER_HEIGHT + STICKER_OVERSCAN
};
export const MAX_STICKER_BYTES = 10 * 1024 * 1024;
export const MAX_STICKERS = 50;
export type StickerGeometry = {
  x: number; y: number; width: number; height: number;
  rotation: number; opacity: number;
};
type StickerBase = StickerGeometry & { id: string; locked: boolean };
export type TextSticker = StickerBase & {
  kind: 'text'; text: string; fontSize: number; color: string;
  bold: boolean; italic: boolean; underline: boolean;
  align: 'left' | 'center' | 'right';
};
export type ImageSticker = StickerBase & {
  kind: 'image'; assetId: string; style: 'original' | 'rounded' | 'circle' | 'photo';
};
export type StickerObject = TextSticker | ImageSticker;
export type StickerBoard = { version: 1; revision: number; objects: StickerObject[] };
export type StickerAsset = {
  id: string; fileName: string; mime: string; byteSize: number; width: number; height: number;
};
export type StickerProblem = 'invalid' | 'count' | 'geometry' | 'text' | 'image';

export function emptyStickerBoard(): StickerBoard {
  return { version: 1, revision: 0, objects: [] };
}

export function newTextSticker(id: string, text: string): TextSticker {
  return {
    id, kind: 'text', text, x: 200, y: 200, width: 360, height: 160,
    rotation: 0, opacity: 100, locked: false,
    fontSize: 32, color: '#211F1C', bold: false, italic: false, underline: false, align: 'left'
  };
}

export function geometryFits(value: StickerGeometry, bounds: StickerBounds = STICKER_STAGE_BOUNDS): boolean {
  if (![value.x, value.y, value.width, value.height, value.rotation, value.opacity].every(Number.isFinite)) return false;
  if (value.width <= 0 || value.height <= 0 || Math.abs(value.rotation) > 180 || value.opacity < 0 || value.opacity > 100) return false;
  const { halfWidth, halfHeight } = rotatedHalfSize(value);
  const cx = value.x + value.width / 2;
  const cy = value.y + value.height / 2;
  return cx - halfWidth >= bounds.left - 1e-7 && cy - halfHeight >= bounds.top - 1e-7 &&
    cx + halfWidth <= bounds.right + 1e-7 && cy + halfHeight <= bounds.bottom + 1e-7;
}

/** Logical area that is actually visible when the 800×600 stage is scaled to fit and centered in a host. */
export function visibleStickerBounds(hostWidth: number, hostHeight: number): StickerBounds {
  const scale = Math.min(hostWidth / STICKER_WIDTH, hostHeight / STICKER_HEIGHT);
  if (!(scale > 0) || !Number.isFinite(scale)) return STICKER_STAGE_BOUNDS;
  const extraX = Math.min(STICKER_OVERSCAN, Math.max(0, (hostWidth / scale - STICKER_WIDTH) / 2));
  const extraY = Math.min(STICKER_OVERSCAN, Math.max(0, (hostHeight / scale - STICKER_HEIGHT) / 2));
  return { left: 0 - extraX, top: 0 - extraY, right: STICKER_WIDTH + extraX, bottom: STICKER_HEIGHT + extraY };
}

/** Moves an object by its rotated box so it lies inside bounds; returns the same object when it already fits. */
export function fitStickerIntoBounds<T extends StickerGeometry>(value: T, bounds: StickerBounds): T {
  if (geometryFits(value, bounds)) return value;
  const { halfWidth, halfHeight } = rotatedHalfSize(value);
  const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), Math.max(min, max));
  const cx = clamp(value.x + value.width / 2, bounds.left + halfWidth, bounds.right - halfWidth);
  const cy = clamp(value.y + value.height / 2, bounds.top + halfHeight, bounds.bottom - halfHeight);
  return { ...value, x: cx - value.width / 2, y: cy - value.height / 2 };
}

export function validateStickerBoard(raw: unknown): StickerProblem | null {
  if (!raw || typeof raw !== 'object') return 'invalid';
  const board = raw as Record<string, unknown>;
  if (board.version !== 1 || !Number.isSafeInteger(board.revision) || Number(board.revision) < 0 || !Array.isArray(board.objects)) return 'invalid';
  if (board.objects.length > MAX_STICKERS) return 'count';
  const ids = new Set<string>();
  for (const rawObject of board.objects) {
    if (!rawObject || typeof rawObject !== 'object') return 'invalid';
    const o = rawObject as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id || o.id.length > 128 || ids.has(o.id) || typeof o.locked !== 'boolean') return 'invalid';
    ids.add(o.id);
    const fields = ['x', 'y', 'width', 'height', 'rotation', 'opacity'] as const;
    if (!fields.every(key => typeof o[key] === 'number')) return 'geometry';
    if (!geometryFits(o as StickerGeometry, STICKER_STORAGE_BOUNDS)) return 'geometry';
    if (o.kind === 'text') {
      if (typeof o.text !== 'string' || [...o.text].length > 2000 || !Number.isInteger(o.fontSize) ||
        Number(o.fontSize) < 12 || Number(o.fontSize) > 160 || !isHexColor(o.color) ||
        !['left', 'center', 'right'].includes(String(o.align)) ||
        !['bold', 'italic', 'underline'].every(key => typeof o[key] === 'boolean')) return 'text';
    } else if (o.kind === 'image') {
      if (typeof o.assetId !== 'string' || !/^[a-f0-9]{32}$/.test(o.assetId) ||
        !['original', 'rounded', 'circle', 'photo'].includes(String(o.style))) return 'image';
    } else return 'invalid';
  }
  return null;
}

export function copySticker(object: StickerObject, id: string, bounds: StickerBounds = STICKER_STAGE_BOUNDS): StickerObject {
  const shifted = { ...object, id, x: object.x + 16, y: object.y + 16 };
  return geometryFits(shifted, bounds) ? shifted : { ...object, id };
}

function rotatedHalfSize(value: StickerGeometry) {
  const radians = value.rotation * Math.PI / 180;
  return {
    halfWidth: (Math.abs(value.width * Math.cos(radians)) + Math.abs(value.height * Math.sin(radians))) / 2,
    halfHeight: (Math.abs(value.width * Math.sin(radians)) + Math.abs(value.height * Math.cos(radians))) / 2
  };
}
