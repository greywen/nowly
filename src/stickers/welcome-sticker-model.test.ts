import { describe, expect, it } from 'vitest';
import { geometryFits, validateStickerBoard, visibleStickerBounds } from './sticker-model';
import { buildWelcomeStickers, WELCOME_LOGO_ASSET } from './welcome-sticker-model';

describe('welcome sticker composition', () => {
  it.each([[800, 600], [1366, 550], [2560, 1200], [5120, 1200]])('fits core objects and preserves fixed layers at %s × %s', (width, height) => {
    const bounds = visibleStickerBounds(width, height);
    const objects = buildWelcomeStickers(bounds);
    expect(validateStickerBoard({ version: 1, revision: 0, objects })).toBeNull();
    expect(objects.every(object => object.locked)).toBe(true);
    expect(objects.slice(-3).map(object => object.id)).toEqual(['welcome-logo', 'welcome-title', 'welcome-subtitle']);
    expect(objects.slice(-3).every(object => geometryFits(object, bounds))).toBe(true);
    expect(objects.filter(object => object.kind === 'text' && object.opacity < 50)).toHaveLength(22);
    expect(objects.find(object => object.id === 'welcome-logo')).toMatchObject({ kind: 'image', assetId: WELCOME_LOGO_ASSET });
    expect(buildWelcomeStickers(bounds)).toEqual(objects);
  });
});
