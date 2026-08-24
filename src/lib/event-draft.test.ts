import { describe, expect, it } from 'vitest';
import type { CalendarEvent, Recurrence } from '../calendar/calendar-model';
import {
  createEventDraft,
  eventToForm,
  isEventFormDirty,
  toEventDraft,
  validateEventForm,
  type EventFormDraft
} from './event-draft';

// 2026-07-23 是周四，与 form/event 的开始日期一致。
const rule: Recurrence = { freq: 'weekly', interval: 1, byDay: ['TH'], end: { kind: 'never' } };

const form: EventFormDraft = {
  title: '  设计评审  ',
  startDate: '2026-07-23',
  endDate: '2026-07-23',
  startTime: '14:00',
  endTime: '15:00',
  allDay: false,
  category: 'work',
  color: '#4FC9DA',
  linkedTaskId: null,
  note: '  保留备注空格  ',
  reminders: [],
  recurrence: null
};

const event: CalendarEvent = {
  id: 'e1',
  title: '设计评审',
  startAt: '2026-07-23T14:00',
  endAt: '2026-07-23T15:00',
  allDay: false,
  category: 'important',
  color: '#F06445',
  linkedTaskId: 't1',
  note: '确认范围',
  createdAt: '2026-07-23T09:00:00Z',
  updatedAt: '2026-07-23T09:00:00Z',
  reminders: [],
  recurrence: null,
  startTz: null,
  endTz: null,
  rrule: null,
  seriesId: null,
  seriesStartAt: null,
  occurrenceStartAt: null,
  subscriptionId: null,
  isOverridden: false
};

describe('event draft helpers', () => {
  it('creates defaults at the next five-minute mark with a one-hour duration', () => {
    expect(createEventDraft('2026-07-23', new Date(2026, 6, 23, 9, 42))).toEqual({
      title: '',
      startDate: '2026-07-23',
      endDate: '2026-07-23',
      startTime: '09:45',
      endTime: '10:45',
      allDay: false,
      category: 'work',
      color: '#4FC9DA',
      linkedTaskId: null,
      note: '',
      reminders: [],
      recurrence: null
    });
  });

  it('uses safe late-evening defaults that never cross a day', () => {
    expect(createEventDraft('2026-07-23', new Date(2026, 6, 23, 23, 20))).toMatchObject({
      startTime: '22:55',
      endTime: '23:55'
    });
  });

  it('converts an event into an editable form without losing values', () => {
    expect(eventToForm(event)).toEqual({
      title: '设计评审',
      startDate: '2026-07-23',
      endDate: '2026-07-23',
      startTime: '14:00',
      endTime: '15:00',
      allDay: false,
      category: 'important',
      color: '#F06445',
      linkedTaskId: 't1',
      note: '确认范围',
      reminders: [],
      recurrence: null
    });
    expect(eventToForm({ ...event, recurrence: rule }).recurrence).toEqual(rule);
  });

  it('normalizes timed and all-day forms while trimming only the title', () => {
    expect(toEventDraft(form)).toEqual({
      title: '设计评审',
      startAt: '2026-07-23T14:00',
      endAt: '2026-07-23T15:00',
      allDay: false,
      category: 'work',
      color: '#4FC9DA',
      linkedTaskId: null,
      note: '  保留备注空格  ',
      reminders: [],
      recurrence: null
    });
    expect(toEventDraft({ ...form, allDay: true, startTime: '09:15', endTime: '10:20' })).toMatchObject({
      startAt: '2026-07-23T00:00',
      endAt: '2026-07-23T23:59'
    });
  });

  it('carries the recurrence rule through to the draft instead of dropping it', () => {
    expect(toEventDraft({ ...form, recurrence: rule }).recurrence).toEqual(rule);
  });

  it('rejects every invalid recurrence shape without touching valid ones', () => {
    expect(validateEventForm({ ...form, recurrence: rule })).toEqual({});
    const invalid: Recurrence[] = [
      { ...rule, interval: 0 },
      { ...rule, byDay: [] },
      { ...rule, end: { kind: 'count', count: 0 } },
      { ...rule, end: { kind: 'until', date: '2026-07-22' } }
    ];
    for (const recurrence of invalid) {
      expect(Object.keys(validateEventForm({ ...form, recurrence }))).toEqual(['recurrence']);
    }
    expect(validateEventForm({ ...form, recurrence: { ...rule, end: { kind: 'until', date: '2026-07-23' } } })).toEqual({});
  });

  it('validates title, dates, required times, order, category, and color', () => {
    expect(validateEventForm(form)).toEqual({});
    expect(validateEventForm({ ...form, title: ' ' })).toEqual({ title: '请输入日程标题。' });
    expect(validateEventForm({ ...form, startDate: '' })).toEqual({ startAt: '请选择开始日期。' });
    expect(validateEventForm({ ...form, endDate: '' })).toEqual({ endAt: '请选择结束日期。' });
    expect(validateEventForm({ ...form, endDate: '2026-07-22' })).toEqual({ endAt: '结束日期不能早于开始日期。' });
    expect(validateEventForm({ ...form, endDate: '2026-07-24' })).toEqual({});
    expect(validateEventForm({ ...form, startTime: '' })).toEqual({ startAt: '请选择开始时间。' });
    expect(validateEventForm({ ...form, endTime: '' })).toEqual({ endAt: '请选择结束时间。' });
    expect(validateEventForm({ ...form, endTime: '13:55' })).toEqual({ endAt: '结束时间不能早于开始时间。' });
    expect(validateEventForm({ ...form, endDate: '2026-07-24', endTime: '13:55' })).toEqual({});
    expect(validateEventForm({ ...form, category: 'other' as never })).toEqual({ category: '请选择有效分类。' });
    expect(validateEventForm({ ...form, color: '#7c5cfc' })).toEqual({});
    expect(toEventDraft({ ...form, color: '#7c5cfc' })).toMatchObject({ color: '#7C5CFC' });
    expect(validateEventForm({ ...form, color: 'purple' as never })).toEqual({ color: '请选择有效颜色。' });
  });

  it('does not require hidden times for an all-day form', () => {
    expect(validateEventForm({ ...form, allDay: true, startTime: '', endTime: '' })).toEqual({});
  });

  it('detects raw title and note changes but ignores hidden all-day times', () => {
    expect(isEventFormDirty(form, { ...form })).toBe(false);
    expect(isEventFormDirty(form, { ...form, title: '设计评审' })).toBe(true);
    expect(isEventFormDirty(form, { ...form, note: '保留备注空格' })).toBe(true);
    const allDay = { ...form, allDay: true };
    expect(isEventFormDirty(allDay, { ...allDay, startTime: '01:00', endTime: '02:00' })).toBe(false);
    expect(isEventFormDirty(allDay, { ...allDay, endDate: '2026-07-24' })).toBe(true);
  });

  it('carries reminders through the form and sorts, de-dupes, and drops negatives in the draft', () => {
    expect(eventToForm({ ...event, reminders: [30, 10] }).reminders).toEqual([30, 10]);
    // 保存时归一化：排序、去重、丢弃负值。
    expect(toEventDraft({ ...form, reminders: [60, 10, 10, -5] }).reminders).toEqual([10, 60]);
    expect(toEventDraft(form).reminders).toEqual([]);
  });

  it('rejects out-of-range, duplicate, and over-cap reminders', () => {
    expect(validateEventForm({ ...form, reminders: [10, 60] })).toEqual({});
    expect(Object.keys(validateEventForm({ ...form, reminders: [-1] }))).toEqual(['reminders']);
    expect(Object.keys(validateEventForm({ ...form, reminders: [4 * 7 * 24 * 60 + 1] }))).toEqual(['reminders']);
    expect(Object.keys(validateEventForm({ ...form, reminders: [10, 10] }))).toEqual(['reminders']);
    expect(Object.keys(validateEventForm({ ...form, reminders: [0, 5, 10, 15, 30, 60] }))).toEqual(['reminders']);
  });
});
