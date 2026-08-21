import { describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n';
import {
  occurrenceKey,
  presetToRecurrence,
  recurrenceToPreset,
  validateRecurrence,
  weekdayOf,
  type RecurrencePreset
} from './recurrence';
import type { CalendarEvent, Recurrence } from '../calendar/calendar-model';

const base: CalendarEvent = {
  id: 's1',
  title: '周会',
  startAt: '2026-08-03T10:00',
  endAt: '2026-08-03T11:00',
  allDay: false,
  category: 'work',
  color: '#0BB783',
  linkedTaskId: null,
  note: '',
  reminders: [],
  createdAt: 't',
  updatedAt: 't',
  recurrence: null,
  seriesId: null,
  seriesStartAt: null,
  occurrenceStartAt: null,
  isOverridden: false
};

function instance(slot: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return { ...base, seriesId: base.id, seriesStartAt: base.startAt, occurrenceStartAt: slot, startAt: slot, ...overrides };
}

describe('weekdayOf', () => {
  it('maps a full week of local dates onto two-letter uppercase codes', () => {
    const week = [
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
      '2026-08-08',
      '2026-08-09'
    ];
    expect(week.map((date) => weekdayOf(`${date}T10:00`))).toEqual([
      'MO',
      'TU',
      'WE',
      'TH',
      'FR',
      'SA',
      'SU'
    ]);
  });
});

describe('occurrenceKey', () => {
  it('uses the plain id for single events', () => {
    expect(occurrenceKey(base)).toBe('s1');
  });

  it('combines the series id with the original slot for instances', () => {
    expect(occurrenceKey(instance('2026-08-10T10:00'))).toBe('s1@2026-08-10T10:00');
  });

  it('keeps every instance of one series distinguishable', () => {
    const keys = ['2026-08-03T10:00', '2026-08-10T10:00', '2026-08-17T10:00'].map((slot) =>
      occurrenceKey(instance(slot))
    );
    expect(new Set(keys).size).toBe(3);
    expect(keys).toEqual(['s1@2026-08-03T10:00', 's1@2026-08-10T10:00', 's1@2026-08-17T10:00']);
  });

  it('separates the same slot across two different series', () => {
    const left = occurrenceKey(instance('2026-08-10T10:00'));
    const right = occurrenceKey(instance('2026-08-10T10:00', { id: 's2', seriesId: 's2' }));
    expect(left).not.toBe(right);
  });

  it('keys an overridden instance by its original slot, not its moved start', () => {
    const overridden = instance('2026-08-10T10:00', {
      startAt: '2026-08-12T15:00',
      endAt: '2026-08-12T16:00',
      isOverridden: true
    });
    expect(occurrenceKey(overridden)).toBe('s1@2026-08-10T10:00');
  });
});

describe('presetToRecurrence', () => {
  it('maps none to null', () => {
    expect(presetToRecurrence('none', '2026-08-05T10:00')).toBeNull();
  });

  it('derives the weekday from the start date for the weekly preset', () => {
    expect(presetToRecurrence('weekly', '2026-08-05T10:00')).toEqual({
      freq: 'weekly',
      interval: 1,
      byDay: ['WE'],
      end: { kind: 'never' }
    });
  });

  it('leaves byDay empty for the non-weekly presets', () => {
    for (const preset of ['daily', 'monthly', 'yearly'] as const) {
      expect(presetToRecurrence(preset, '2026-08-05T10:00')).toEqual({
        freq: preset,
        interval: 1,
        byDay: [],
        end: { kind: 'never' }
      });
    }
  });

  it('seeds the custom preset with a weekly rule on the start weekday', () => {
    expect(presetToRecurrence('custom', '2026-08-05T10:00')).toEqual({
      freq: 'weekly',
      interval: 1,
      byDay: ['WE'],
      end: { kind: 'never' }
    });
  });

  // The wire format is the contract with the Rust command layer: camelCase keys,
  // lowercase `kind` tags, uppercase weekday codes. A rename on either side is a
  // rejected payload, so the serialized string is asserted verbatim.
  it('serializes to the exact JSON shape the command layer accepts', () => {
    expect(JSON.stringify(presetToRecurrence('weekly', '2026-08-05T10:00'))).toBe(
      '{"freq":"weekly","interval":1,"byDay":["WE"],"end":{"kind":"never"}}'
    );
  });

  it('serializes every end variant with a lowercase kind tag', () => {
    const ends: Recurrence['end'][] = [
      { kind: 'never' },
      { kind: 'until', date: '2026-12-31' },
      { kind: 'count', count: 4 }
    ];
    expect(
      ends.map((end) => JSON.stringify({ ...presetToRecurrence('daily', '2026-08-05T10:00')!, end }))
    ).toEqual([
      '{"freq":"daily","interval":1,"byDay":[],"end":{"kind":"never"}}',
      '{"freq":"daily","interval":1,"byDay":[],"end":{"kind":"until","date":"2026-12-31"}}',
      '{"freq":"daily","interval":1,"byDay":[],"end":{"kind":"count","count":4}}'
    ]);
  });
});

describe('recurrenceToPreset', () => {
  it('recognises a plain weekly rule as the weekly preset', () => {
    expect(
      recurrenceToPreset({ freq: 'weekly', interval: 1, byDay: ['WE'], end: { kind: 'never' } }, '2026-08-05T10:00')
    ).toBe('weekly');
  });

  it('falls back to custom when the rule carries extra weekdays', () => {
    expect(
      recurrenceToPreset({ freq: 'weekly', interval: 1, byDay: ['MO', 'FR'], end: { kind: 'never' } }, '2026-08-03T10:00')
    ).toBe('custom');
  });

  it('falls back to custom when the single weekday is not the start weekday', () => {
    expect(
      recurrenceToPreset({ freq: 'weekly', interval: 1, byDay: ['FR'], end: { kind: 'never' } }, '2026-08-03T10:00')
    ).toBe('custom');
  });

  it('falls back to custom when a non-weekly rule carries weekdays', () => {
    expect(
      recurrenceToPreset({ freq: 'monthly', interval: 1, byDay: ['MO'], end: { kind: 'never' } }, '2026-08-03T10:00')
    ).toBe('custom');
  });

  it('falls back to custom for any interval other than one', () => {
    expect(
      recurrenceToPreset({ freq: 'daily', interval: 2, byDay: [], end: { kind: 'never' } }, '2026-08-03T10:00')
    ).toBe('custom');
  });

  it('falls back to custom for a bounded rule', () => {
    expect(
      recurrenceToPreset({ freq: 'daily', interval: 1, byDay: [], end: { kind: 'until', date: '2026-12-31' } }, '2026-08-03T10:00')
    ).toBe('custom');
    expect(
      recurrenceToPreset({ freq: 'daily', interval: 1, byDay: [], end: { kind: 'count', count: 4 } }, '2026-08-03T10:00')
    ).toBe('custom');
  });

  it('maps a missing rule back to none', () => {
    expect(recurrenceToPreset(null, '2026-08-03T10:00')).toBe('none');
  });

  it('round-trips every plain preset through a Recurrence', () => {
    const startAt = '2026-08-05T10:00';
    const presets: RecurrencePreset[] = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
    expect(presets.map((preset) => recurrenceToPreset(presetToRecurrence(preset, startAt), startAt))).toEqual(
      presets
    );
  });

  it('reads the custom seed back as the weekly preset', () => {
    // `custom` is a UI affordance, not a data shape: its seed is a plain weekly
    // rule, so reopening the form shows `weekly` until the user edits a detail.
    const startAt = '2026-08-05T10:00';
    expect(recurrenceToPreset(presetToRecurrence('custom', startAt), startAt)).toBe('weekly');
  });
});

describe('validateRecurrence', () => {
  it('accepts a missing rule', () => {
    expect(validateRecurrence(null, '2026-08-03T10:00')).toBeUndefined();
  });

  it('rejects an interval below one', () => {
    expect(validateRecurrence({ freq: 'daily', interval: 0, byDay: [], end: { kind: 'never' } }, '2026-08-03T10:00'))
      .toBeTruthy();
    expect(validateRecurrence({ freq: 'daily', interval: -1, byDay: [], end: { kind: 'never' } }, '2026-08-03T10:00'))
      .toBeTruthy();
  });

  it('rejects a fractional interval', () => {
    expect(validateRecurrence({ freq: 'daily', interval: 1.5, byDay: [], end: { kind: 'never' } }, '2026-08-03T10:00'))
      .toBeTruthy();
  });

  it('rejects a weekly rule with no weekday selected', () => {
    expect(validateRecurrence({ freq: 'weekly', interval: 1, byDay: [], end: { kind: 'never' } }, '2026-08-03T10:00'))
      .toBeTruthy();
  });

  it('rejects a count below one or fractional', () => {
    expect(
      validateRecurrence({ freq: 'daily', interval: 1, byDay: [], end: { kind: 'count', count: 0 } }, '2026-08-03T10:00')
    ).toBeTruthy();
    expect(
      validateRecurrence({ freq: 'daily', interval: 1, byDay: [], end: { kind: 'count', count: 2.5 } }, '2026-08-03T10:00')
    ).toBeTruthy();
  });

  it('rejects an until date earlier than the start date', () => {
    expect(
      validateRecurrence(
        { freq: 'daily', interval: 1, byDay: [], end: { kind: 'until', date: '2026-08-01' } },
        '2026-08-03T10:00'
      )
    ).toBeTruthy();
  });

  it('accepts an until date on the start date itself', () => {
    expect(
      validateRecurrence(
        { freq: 'daily', interval: 1, byDay: [], end: { kind: 'until', date: '2026-08-03' } },
        '2026-08-03T10:00'
      )
    ).toBeUndefined();
  });

  it('accepts a valid rule', () => {
    expect(
      validateRecurrence({ freq: 'weekly', interval: 2, byDay: ['MO'], end: { kind: 'count', count: 4 } }, '2026-08-03T10:00')
    ).toBeUndefined();
  });

  it('reports a distinct message per rejected field', () => {
    const messages = [
      validateRecurrence({ freq: 'daily', interval: 0, byDay: [], end: { kind: 'never' } }, '2026-08-03T10:00'),
      validateRecurrence({ freq: 'weekly', interval: 1, byDay: [], end: { kind: 'never' } }, '2026-08-03T10:00'),
      validateRecurrence(
        { freq: 'daily', interval: 1, byDay: [], end: { kind: 'count', count: 0 } },
        '2026-08-03T10:00'
      ),
      validateRecurrence(
        { freq: 'daily', interval: 1, byDay: [], end: { kind: 'until', date: '2026-08-01' } },
        '2026-08-03T10:00'
      )
    ];
    expect(new Set(messages).size).toBe(4);
  });

  it('renders localized copy for every rejected field instead of the raw i18n key', () => {
    const rejected = () => [
      validateRecurrence({ freq: 'daily', interval: 0, byDay: [], end: { kind: 'never' } }, '2026-08-03T10:00'),
      validateRecurrence({ freq: 'weekly', interval: 1, byDay: [], end: { kind: 'never' } }, '2026-08-03T10:00'),
      validateRecurrence(
        { freq: 'daily', interval: 1, byDay: [], end: { kind: 'count', count: 0 } },
        '2026-08-03T10:00'
      ),
      validateRecurrence(
        { freq: 'daily', interval: 1, byDay: [], end: { kind: 'until', date: '2026-08-01' } },
        '2026-08-03T10:00'
      )
    ];

    expect(rejected()).toEqual([
      '重复间隔必须是不小于 1 的整数。',
      '按周重复时至少选择一个星期。',
      '重复次数必须是不小于 1 的整数。',
      '截止日期不能早于开始日期。'
    ]);

    // `translate` falls back to the other language before the raw key, so each
    // side has to be checked on its own to catch a half-added key.
    try {
      setLanguage('en');
      expect(rejected()).toEqual([
        'The repeat interval must be a whole number of at least 1.',
        'Select at least one weekday for a weekly repeat.',
        'The number of occurrences must be a whole number of at least 1.',
        'The end date cannot be earlier than the start date.'
      ]);
    } finally {
      setLanguage('zh');
    }
  });
});
