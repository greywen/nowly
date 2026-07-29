import type { Note } from './notes-model';

const noteColorClass: Record<Note['color'], string> = {
  yellow: 'border-amber-400 bg-amber-50',
  blue: 'border-sky-400 bg-sky-50',
  green: 'border-emerald-400 bg-emerald-50',
  purple: 'border-violet-400 bg-violet-50'
};

type NotesWidgetProps = {
  notes: Note[];
  onOpenNote: (note: Note) => void;
};

export function NotesWidget({ notes, onOpenNote }: NotesWidgetProps) {
  const sortedNotes = [...notes].sort((left, right) => Number(right.pinned) - Number(left.pinned));

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] p-3 xl:p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-black text-ink">便签</h2>
        <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-black text-brand">编辑</span>
      </div>
      <div data-testid="notes-scroll" className="grid min-h-0 content-start gap-2 overflow-auto pr-1">
        {sortedNotes.map((note) => (
          <button key={note.id} type="button" onClick={() => onOpenNote(note)} className={`border-l-4 ${noteColorClass[note.color]} rounded-2xl p-2.5 text-left`}>
            <div className="truncate text-xs font-black text-slate-700">{note.title}</div>
            <div className="mt-1 line-clamp-3 text-[11px] font-semibold leading-snug text-slate-600">{note.content}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
