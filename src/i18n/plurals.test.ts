import { afterEach, expect, it } from 'vitest';
import { translations } from './translations';
import { setLanguage, translate } from './index';

afterEach(() => {
  for (const table of Object.values(translations)) delete table['test.plural'];
  setLanguage('zh');
});

it('selects plural categories with the active language rules', () => {
  // French treats zero as singular, unlike English.
  translations.fr['test.plural'] = '{count, plural, one {one #} other {other #}}';
  setLanguage('fr');
  for (const [count, category] of [[0, 'one'], [1, 'one'], [2, 'other'], [100, 'other']] as const) {
    expect(translate('test.plural', { count })).toBe(`${category} ${new Intl.NumberFormat('fr-FR', { useGrouping: false }).format(count)}`);
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
