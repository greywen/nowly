import { useState } from 'react';
import { X } from 'lucide-react';
import { Select } from '../components/Select';
import type { CalendarEvent, EventCategory } from '../calendar/calendar-model';
import type { MatrixTask } from '../matrix/matrix-model';

type EventModalProps = {
  event: CalendarEvent;
  tasks: MatrixTask[];
  onClose: () => void;
};

const categoryOptions: { value: EventCategory; label: string }[] = [
  { value: 'work', label: '工作' },
  { value: 'important', label: '重要' },
  { value: 'personal', label: '个人' },
  { value: 'learning', label: '学习' }
];

export function EventModal({ event, tasks, onClose }: EventModalProps) {
  const [categoryId, setCategoryId] = useState(event.category || 'work');
  const [linkedTaskId, setLinkedTaskId] = useState(event.linkedTaskId ?? '');
  const taskOptions = [{ value: '', label: '无关联' }, ...tasks.map((task) => ({ value: task.id, label: task.title }))];

  return (
    <section className="good-modal pointer-events-auto fixed right-6 top-24 z-20 grid max-h-[calc(100vh-7rem)] w-[min(420px,calc(100vw-3rem))] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
      <header className="good-modal-header">
        <h2>日程编辑</h2>
        <button aria-label="关闭" onClick={onClose} className="good-icon-button"><X /></button>
      </header>
      <div className="good-modal-body">
        <div className="good-field"><label htmlFor="event-title">标题</label><input id="event-title" className="good-input" defaultValue={event.title} /></div>
        <div className="good-field"><label htmlFor="event-start">开始</label><input id="event-start" className="good-input" defaultValue={event.startAt} /></div>
        <Select id="event-category" name="categoryId" label="分类" options={categoryOptions} value={categoryId} onChange={(value) => setCategoryId(value as EventCategory)} />
        <Select id="event-linked-task" name="linkedTaskId" label="关联任务" options={taskOptions} value={linkedTaskId} onChange={setLinkedTaskId} searchable />
        <div className="good-field"><label htmlFor="event-note">备注</label><textarea id="event-note" className="good-input good-textarea" defaultValue={event.note} /></div>
      </div>
      <footer className="good-modal-footer">
        <button onClick={onClose} className="good-button">取消</button>
        <button className="good-button good-button--primary">保存</button>
      </footer>
    </section>
  );
}
