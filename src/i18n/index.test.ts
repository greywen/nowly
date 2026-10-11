import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage, translate } from './index';
import { translations } from './translations';

afterEach(() => {
  delete translations.zh['test.englishFallback'];
  delete translations.en['test.englishFallback'];
  delete translations.zh['test.chineseOnly'];
  setLanguage('zh');
});

describe('translation fallback', () => {
  it('uses English when the selected language has no translation', () => {
    translations.en['test.englishFallback'] = 'Saved {count} images';
    setLanguage('zh');
    expect(translate('test.englishFallback', { count: 2 })).toBe('Saved 2 images');
  });

  it('does not leak Chinese-only translations into English', () => {
    translations.zh['test.chineseOnly'] = '仅中文';
    setLanguage('en');
    expect(translate('test.chineseOnly')).toBe('test.chineseOnly');
  });

  it('localizes task operation and status errors', () => {
    setLanguage('en');
    for (const key of ['taskWorkspace.moveFailed', 'taskWorkspace.completionFailed', 'taskWorkspace.createdNotVisible', 'taskWorkspace.updatedNotVisible', 'kanbanWidget.moveFailed', 'kanbanWidget.reorderFailed', 'statusIsland.readError']) {
      expect(translate(key)).not.toBe(key);
      expect(translate(key)).not.toMatch(/[\u4e00-\u9fff]/);
    }
  });

  it('provides an English translation for every Chinese UI key', () => {
    expect(Object.keys(translations.zh).filter(key => !translations.en[key])).toEqual([]);
  });
});
