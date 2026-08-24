import { describe, expect, it } from 'vitest';
import { externalToCalendarEvent, type ExternalEvent } from './subscription-model';

describe('externalToCalendarEvent', () => {
  const external: ExternalEvent = {
    id: 'x1',
    subscriptionId: 's1',
    title: '团队周会',
    startAt: '2026-08-10T18:00',
    endAt: '2026-08-10T19:00',
    startTz: 'Asia/Shanghai',
    endTz: 'Asia/Shanghai',
    allDay: false,
    location: '会议室',
    description: '议程',
    color: '#4FC9DA'
  };

  it('maps an external event into a read-only CalendarEvent', () => {
    const event = externalToCalendarEvent(external);
    expect(event.id).toBe('x1');
    expect(event.subscriptionId).toBe('s1');
    expect(event.title).toBe('团队周会');
    expect(event.startAt).toBe('2026-08-10T18:00');
    expect(event.color).toBe('#4FC9DA');
    // 只读事件不参与重复/关联/提醒逻辑。
    expect(event.recurrence).toBeNull();
    expect(event.linkedTaskId).toBeNull();
    expect(event.reminders).toEqual([]);
    // note 承载地点/描述，供只读详情展示。
    expect(event.note).toContain('会议室');
  });
});
