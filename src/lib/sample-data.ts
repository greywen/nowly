import type { CalendarEvent } from '../calendar/calendar-model';
import type { MatrixTask } from '../matrix/matrix-model';
import type { Note } from '../notes/notes-model';

export const sampleEvents: CalendarEvent[] = [
  {
    id: 'event-1',
    title: '站会',
    startAt: '2026-07-23T09:30:00',
    endAt: '2026-07-23T10:00:00',
    allDay: false,
    categoryId: 'work',
    color: 'blue',
    linkedTaskId: null,
    note: ''
  },
  {
    id: 'event-2',
    title: '设计评审',
    startAt: '2026-07-23T14:00:00',
    endAt: '2026-07-23T15:00:00',
    allDay: false,
    categoryId: 'work',
    color: 'red',
    linkedTaskId: 'task-1',
    note: '确认单主界面 UI'
  },
  {
    id: 'event-3',
    title: '健身',
    startAt: '2026-07-23T18:30:00',
    endAt: '2026-07-23T19:30:00',
    allDay: false,
    categoryId: 'personal',
    color: 'green',
    linkedTaskId: null,
    note: ''
  }
];

export const sampleTasks: MatrixTask[] = [
  {
    id: 'task-1',
    title: '发布 v0.1',
    quadrant: 'important_urgent',
    dueAt: '2026-07-23',
    priority: 1,
    completed: false,
    linkedEventId: 'event-2',
    note: ''
  },
  {
    id: 'task-2',
    title: '模块接口设计',
    quadrant: 'important_not_urgent',
    dueAt: null,
    priority: 2,
    completed: false,
    linkedEventId: null,
    note: ''
  },
  {
    id: 'task-3',
    title: '回复消息',
    quadrant: 'not_important_urgent',
    dueAt: '2026-07-23',
    priority: 3,
    completed: false,
    linkedEventId: null,
    note: ''
  },
  {
    id: 'task-4',
    title: '整理素材',
    quadrant: 'not_important_not_urgent',
    dueAt: null,
    priority: 3,
    completed: false,
    linkedEventId: null,
    note: ''
  }
];

export const sampleNotes: Note[] = [
  {
    id: 'note-1',
    title: '产品原则',
    content: '只有一个主界面，所有操作通过弹窗完成。',
    color: 'yellow',
    pinned: true,
    createdAt: '2026-07-23T09:00:00',
    updatedAt: '2026-07-23T09:00:00'
  },
  {
    id: 'note-2',
    title: '待办记录',
    content: '买咖啡豆；晚上看 FullCalendar basic 示例。',
    color: 'yellow',
    pinned: false,
    createdAt: '2026-07-23T09:10:00',
    updatedAt: '2026-07-23T09:10:00'
  }
];
