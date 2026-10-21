import { afterEach, expect, it } from 'vitest';
import { translations } from './translations';
import { setLanguage, translate } from './index';

afterEach(() => {
  for (const table of Object.values(translations)) delete table['test.plural'];
  setLanguage('zh');
});

it('uses all six Arabic plural categories and formats the count', () => {
  translations.ar ??= {};
  translations.ar['test.plural'] = '{count, plural, zero {zero #} one {one #} two {two #} few {few #} many {many #} other {other #}}';
  setLanguage('ar');
  for (const [count, category] of [[0, 'zero'], [1, 'one'], [2, 'two'], [3, 'few'], [11, 'many'], [100, 'other']] as const) {
    expect(translate('test.plural', { count })).toBe(`${category} ${new Intl.NumberFormat('ar', { useGrouping: false }).format(count)}`);
  }
});

it('interpolates placeholders inside plural branches and prefers exact matches', () => {
  translations.en['test.plural'] = '{count, plural, =0 {Nothing for {name}} one {# note for {name}} other {# notes for {name}}}';
  setLanguage('en');
  expect(translate('test.plural', { count: 0, name: 'Alex' })).toBe('Nothing for Alex');
  expect(translate('test.plural', { count: 2, name: 'Alex' })).toBe('2 notes for Alex');
});

it('uses English grammar if a safety fallback is required', () => {
  translations.en['test.plural'] = '{count, plural, one {# note} other {# notes}}';
  setLanguage('ja');
  expect(translate('test.plural', { count: 1 })).toBe('1 note');
});
