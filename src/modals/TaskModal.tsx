import { useState } from 'react';
import { X } from 'lucide-react';
import type { CalendarEvent } from '../calendar/calendar-model';
import { Select } from '../components/Select';
import { quadrantLabels, type MatrixTask } from '../matrix/matrix-model';

type TaskModalProps = {
  task: MatrixTask;
  events: CalendarEvent[];
  onClose: () => void;
};

const quadrantOptions = Object.entries(quadrantLabels).map(([value, label]) => ({ value, label }));
const priorityOptions = [
  { value: '1', label: '高' },
  { value: '2', label: '中' },
  { value: '3', label: '低' }
];

export function TaskModal({ task, events, onClose }: TaskModalProps) {
  const [quadrant, setQuadrant] = useState(task.quadrant);
  const [priority, setPriority] = useState(String(task.priority));
  const [linkedEventId, setLinkedEventId] = useState(task.linkedEventId ?? '');
  const eventOptions = [{ value: '', label: '无关联' }, ...events.map((event) => ({ value: event.id, label: event.title }))];

  return (
    <section className="good-modal pointer-events-auto fixed right-6 top-24 z-20 grid max-h-[calc(100vh-7rem)] w-[min(420px,calc(100vw-3rem))] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
      <header className="good-modal-header">
        <h2>任务编辑</h2>
        <button aria-label="关闭" onClick={onClose} className="good-icon-button"><X /></button>
      </header>
      <div className="good-modal-body">
        <div className="good-field"><label htmlFor="task-title">标题</label><input id="task-title" className="good-input" defaultValue={task.title} /></div>
        <Select id="task-quadrant" name="quadrant" label="所属象限" options={quadrantOptions} value={quadrant} onChange={(value) => setQuadrant(value as MatrixTask['quadrant'])} />
        <Select id="task-priority" name="priority" label="优先级" options={priorityOptions} value={priority} onChange={setPriority} />
        <Select id="task-linked-event" name="linkedEventId" label="关联日程" options={eventOptions} value={linkedEventId} onChange={setLinkedEventId} searchable />
        <div className="good-field"><label htmlFor="task-note">备注</label><textarea id="task-note" className="good-input good-textarea" defaultValue={task.note} /></div>
      </div>
      <footer className="good-modal-footer">
        <button onClick={onClose} className="good-button">取消</button>
        <button className="good-button good-button--primary">保存</button>
      </footer>
    </section>
  );
}
