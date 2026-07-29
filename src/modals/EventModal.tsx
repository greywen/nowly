import { X } from 'lucide-react';
import type { CalendarEvent } from '../calendar/calendar-model';

type EventModalProps = {
  event: CalendarEvent;
  onClose: () => void;
};

export function EventModal({ event, onClose }: EventModalProps) {
  return (
    <section className="pointer-events-auto fixed right-6 top-24 z-20 grid max-h-[calc(100vh-7rem)] w-[min(420px,calc(100vw-3rem))] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-modal">
      <header className="flex h-14 items-center justify-between border-b border-slate-100 px-4">
        <h2 className="font-black">日程编辑</h2>
        <button aria-label="关闭" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-xl bg-slate-100">
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="min-h-0 overflow-auto p-4">
        <label className="mb-1 block text-xs font-black text-muted">标题</label>
        <input className="mb-3 h-10 w-full rounded-xl border border-slate-200 px-3 font-bold" defaultValue={event.title} />
        <label className="mb-1 block text-xs font-black text-muted">开始</label>
        <input className="mb-3 h-10 w-full rounded-xl border border-slate-200 px-3 font-bold" defaultValue={event.startAt} />
        <label className="mb-1 block text-xs font-black text-muted">备注</label>
        <textarea className="h-24 w-full resize-none rounded-xl border border-slate-200 p-3 font-bold" defaultValue={event.note} />
      </div>
      <footer className="flex h-14 justify-end gap-2 border-t border-slate-100 px-4 py-2">
        <button onClick={onClose} className="rounded-xl bg-slate-100 px-4 font-black">取消</button>
        <button className="rounded-xl bg-brand px-4 font-black text-white">保存</button>
      </footer>
    </section>
  );
}
