import { isHexColor } from '../lib/color';

export const STICKER_WIDTH = 800;
export const STICKER_HEIGHT = 600;
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

export function geometryFits(value: StickerGeometry): boolean {
  if (![value.x, value.y, value.width, value.height, value.rotation, value.opacity].every(Number.isFinite)) return false;
  if (value.width <= 0 || value.height <= 0 || Math.abs(value.rotation) > 180 || value.opacity < 0 || value.opacity > 100) return false;
  const radians = value.rotation * Math.PI / 180;
  const w = Math.abs(value.width * Math.cos(radians)) + Math.abs(value.height * Math.sin(radians));
  const h = Math.abs(value.width * Math.sin(radians)) + Math.abs(value.height * Math.cos(radians));
  const cx = value.x + value.width / 2;
  const cy = value.y + value.height / 2;
  return cx - w / 2 >= -1e-7 && cy - h / 2 >= -1e-7 &&
    cx + w / 2 <= STICKER_WIDTH + 1e-7 && cy + h / 2 <= STICKER_HEIGHT + 1e-7;
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
    if (!geometryFits(o as StickerGeometry)) return 'geometry';
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

export function copySticker(object: StickerObject, id: string): StickerObject {
  const shifted = { ...object, id, x: object.x + 16, y: object.y + 16 };
  return geometryFits(shifted) ? shifted : { ...object, id };
}
