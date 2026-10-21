import { afterEach, describe, expect, it } from 'vitest';
import { localizeRepositoryError } from './localize-error';
import { getLanguage, setLanguage, SUPPORTED_LANGUAGES } from './store';
import { translations } from './translations';
import { nativeErrorTranslations } from './native-errors';

const originalLanguage = getLanguage();
afterEach(() => setLanguage(originalLanguage));

describe('localizeRepositoryError', () => {
  it('localizes a French conflict while preserving all diagnostic metadata', () => {
    setLanguage('fr');
    const error = { code: 'conflict', message: '日程保存状态已变化，请重试。', field: null, revision: 8 };
    expect(localizeRepositoryError(error)).toEqual({
      ...error,
      message: 'Ces données ont été modifiées ailleurs. Rechargez-les, puis réessayez.',
      originalMessage: error.message,
    });
    expect(error.message).toBe('日程保存状态已变化，请重试。');
  });

  it('keeps Arabic validation attached to the original field', () => {
    setLanguage('ar');
    const error = { code: 'validation_error', field: 'occurrenceStartAt', message: '此重复日程实例不可编辑。' };
    expect(localizeRepositoryError(error)).toEqual({
      ...error,
      message: 'تحقق من الحقل المحدد ثم حاول مرة أخرى.',
      originalMessage: error.message,
    });
  });

  it('reuses an exact authored source translation instead of generic guidance', () => {
    setLanguage('fr');
    const error = { code: 'validation_error', field: 'title', message: '请输入日程标题。' };
    expect(localizeRepositoryError(error)).toMatchObject({
      field: 'title',
      message: translations.fr['eventDraft.errorTitle'],
      originalMessage: error.message,
    });
  });

  it('keeps unknown rejections and user text untouched', () => {
    setLanguage('fr');
    for (const error of ['用户写的中文', new Error('用户写的中文'), { code: 'custom_error', message: '用户写的中文' }, null]) {
      expect(localizeRepositoryError(error)).toBe(error);
    }
  });

  it('provides safe English guidance for a known native error code', () => {
    setLanguage('en');
    expect(localizeRepositoryError({ code: 'not_found', message: '日程不存在。' })).toMatchObject({
      code: 'not_found',
      message: 'This item is no longer available. Reload and try again.',
      originalMessage: '日程不存在。',
    });
  });

  it('preserves authored Chinese messages unchanged', () => {
    setLanguage('zh');
    const error = { code: 'validation_error', field: 'url', message: '订阅地址必须使用 HTTPS。' };
    expect(localizeRepositoryError(error)).toBe(error);
  });

  it('localizes the backend generic English system message into Chinese', () => {
    setLanguage('zh');
    expect(localizeRepositoryError({ code: 'system_error', message: 'The system operation failed. Please try again.' })).toMatchObject({
      message: '系统操作失败，请重试。',
      originalMessage: 'The system operation failed. Please try again.',
    });
  });

  it('does not replace a message already localized by the browser repository', () => {
    setLanguage('fr');
    const error = { code: 'validation_error', field: 'title', message: translations.fr['eventDraft.errorTitle'] };
    expect(localizeRepositoryError(error)).toBe(error);
  });

  it('retains non-enumerable diagnostics and Error identity when structured errors use Error instances', () => {
    setLanguage('fr');
    const error = Object.assign(new Error('日程保存状态已变化，请重试。'), { code: 'conflict' });
    const localized = localizeRepositoryError(error);
    expect(localized).toBeInstanceOf(Error);
    expect(localized).toMatchObject({
      code: 'conflict',
      stack: error.stack,
      message: nativeErrorTranslations.fr['nativeError.conflict'],
      originalMessage: error.message,
    });
  });

  it('provides each error code in all supported locales and keeps the original diagnostic on repeat localization', () => {
    for (const language of SUPPORTED_LANGUAGES) {
      expect(Object.keys(nativeErrorTranslations[language])).toEqual(Object.keys(nativeErrorTranslations.en));
      setLanguage(language);
      for (const code of ['conflict', 'not_found', 'validation_error', 'database_error', 'system_error']) {
        const error = { code, message: '测试错误详情', originalMessage: '原始诊断', field: 'title' };
        const localized = localizeRepositoryError(error);
        expect(localized).toMatchObject({
          code, field: 'title', originalMessage: '原始诊断',
          message: language === 'zh' ? error.message : nativeErrorTranslations[language][`nativeError.${code}`],
        });
        expect(localizeRepositoryError(localized)).toBe(localized);
      }
    }
  });
});
