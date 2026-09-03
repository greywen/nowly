import { describe, expect, it } from 'vitest';
import { externalToCalendarEvent, type ExternalEvent } from './subscription-model';

describe('externalToCalendarEvent', () => {
  const external: ExternalEvent = {
    id: 'x1',
    subscriptionId: 's1',
    remoteEventId: 'remote-1',
    provider: 'google',
    writable: true,
    title: '团队周会',
    startAt: '2026-08-10T18:00',
    endAt: '2026-08-10T19:00',
    startTz: 'Asia/Shanghai',
    endTz: 'Asia/Shanghai',
    allDay: false,
    location: '会议室',
    description: '议程',
    color: '#4FC9DA',
    reminders: [10, 60]
  };

  it('maps an OAuth event into a writable CalendarEvent', () => {
    const event = externalToCalendarEvent(external);
    expect(event.id).toBe('x1');
    expect(event.subscriptionId).toBe('s1');
    expect(event.title).toBe('团队周会');
    expect(event.startAt).toBe('2026-08-10T18:00');
    expect(event.color).toBe('#4FC9DA');
    // 只读事件不参与重复/关联逻辑；提醒直接沿用来源日历。
    expect(event.recurrence).toBeNull();
    expect(event.reminders).toEqual([10, 60]);
    // description 同时填入编辑器使用的 note，地点仍保持独立字段。
    expect(event.note).toBe('议程');
    expect(event.externalWritable).toBe(true);
    expect(event.remoteEventId).toBe('remote-1');
    expect(event.externalLocation).toBe('会议室');
    expect(event.externalDescription).toBe('议程');
  });

  it('converts an all-day exclusive end for grid rendering and keeps the source boundary', () => {
    const event = externalToCalendarEvent({
      ...external,
      allDay: true,
      startAt: '2026-08-10T00:00',
      endAt: '2026-08-11T00:00'
    });
    expect(event.endAt).toBe('2026-08-10T23:59');
    expect(event.externalExclusiveEndAt).toBe('2026-08-11T00:00');
  });
});
