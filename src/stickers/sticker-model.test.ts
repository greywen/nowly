import { describe, expect, it } from 'vitest';
import { copySticker, emptyStickerBoard, geometryFits, newTextSticker, validateStickerBoard } from './sticker-model';

describe('sticker domain', () => {
  it('starts with a versioned empty board', () => {
    expect(emptyStickerBoard()).toEqual({ version: 1, revision: 0, objects: [] });
  });
  it('validates exact count boundaries and duplicate ids', () => {
    const board = emptyStickerBoard();
    board.objects = Array.from({ length: 50 }, (_, i) => newTextSticker(String(i), '文字'));
    expect(validateStickerBoard(board)).toBeNull();
    board.objects.push(newTextSticker('extra', '文字'));
    expect(validateStickerBoard(board)).toBe('count');
    board.objects.pop();
    board.objects[1].id = board.objects[0].id;
    expect(validateStickerBoard(board)).toBe('invalid');
  });
  it('counts Unicode scalars and validates font endpoints', () => {
    const text = newTextSticker('one', '😀'.repeat(2000));
    for (const fontSize of [12, 160]) {
      expect(validateStickerBoard({ ...emptyStickerBoard(), objects: [{ ...text, fontSize }] })).toBeNull();
    }
    expect(validateStickerBoard({ ...emptyStickerBoard(), objects: [{ ...text, text: text.text + '😀' }] })).toBe('text');
    expect(validateStickerBoard({ ...emptyStickerBoard(), objects: [{ ...text, fontSize: 161 }] })).toBe('text');
  });
  it('checks rotated bounds and finite coordinates', () => {
    const object = newTextSticker('one', '文字');
    expect(geometryFits(object)).toBe(true);
    expect(geometryFits({ ...object, x: 0, y: 0, rotation: 45 })).toBe(false);
    expect(geometryFits({ ...object, x: NaN })).toBe(false);
    expect(geometryFits({ ...object, width: Infinity })).toBe(false);
  });
  it('rejects malformed stored data rather than returning an empty board', () => {
    for (const value of [null, {}, { version: 2, revision: 0, objects: [] }]) {
      expect(validateStickerBoard(value)).toBe('invalid');
    }
    expect(validateStickerBoard({ ...emptyStickerBoard(), objects: [{ ...newTextSticker('one', '文字'), color: 'red' }] })).toBe('text');
  });
  it('copies with a fresh id without changing the original', () => {
    const original = newTextSticker('one', '文字');
    const copied = copySticker(original, 'two');
    expect(copied.id).toBe('two');
    expect(copied.x).toBe(original.x + 16);
    expect(original.id).toBe('one');
    expect(geometryFits(copied)).toBe(true);
  });
});
