import { describe, expect, it } from 'vitest';
import { copySticker, emptyStickerBoard, fitStickerIntoBounds, geometryFits, newTextSticker, STICKER_OVERSCAN, STICKER_STAGE_BOUNDS, validateStickerBoard, visibleStickerBounds } from './sticker-model';

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
  it('extends the usable area to the whole visible module around the centered stage', () => {
    expect(visibleStickerBounds(1600, 600)).toEqual({ left: -400, top: 0, right: 1200, bottom: 600 });
    expect(visibleStickerBounds(400, 600)).toEqual({ left: 0, top: -300, right: 800, bottom: 900 });
    expect(visibleStickerBounds(0, 0)).toEqual(STICKER_STAGE_BOUNDS);
    const wide = visibleStickerBounds(100_000, 60);
    expect(wide.left).toBe(-STICKER_OVERSCAN);
    expect(wide.right).toBe(800 + STICKER_OVERSCAN);
    const object = { ...newTextSticker('one', '文字'), x: -300, y: 20 };
    expect(geometryFits(object)).toBe(false);
    expect(geometryFits(object, visibleStickerBounds(1600, 600))).toBe(true);
    expect(validateStickerBoard({ ...emptyStickerBoard(), objects: [object] })).toBeNull();
    expect(validateStickerBoard({ ...emptyStickerBoard(), objects: [{ ...object, x: -STICKER_OVERSCAN - 1 }] })).toBe('geometry');
  });
  it('pulls an object back inside bounds by its rotated box', () => {
    const object = { ...newTextSticker('one', '文字'), x: 1000, y: -50, width: 80, height: 60, rotation: 90 };
    const fitted = fitStickerIntoBounds(object, STICKER_STAGE_BOUNDS);
    expect(fitted.x).toBeCloseTo(730);
    expect(fitted.y).toBeCloseTo(10);
    expect(geometryFits(fitted)).toBe(true);
    const inside = newTextSticker('two', '文字');
    expect(fitStickerIntoBounds(inside, STICKER_STAGE_BOUNDS)).toBe(inside);
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
