import { Plus } from 'lucide-react';
import type { Note } from './notes-model';

const noteColorClass: Record<Note['color'], string> = {
  yellow: 'note--yellow',
  blue: 'note--blue',
  green: 'note--green',
  purple: 'note--purple'
};

type LoadStatus = 'loading' | 'ready' | 'error';

type NotesWidgetProps = {
  notes: Note[];
  status: LoadStatus;
  errorMessage?: string;
  onRetry: () => void;
  onCreateNote: () => void;
  onOpenNote: (note: Note) => void;
};

export function NotesWidget({
  notes,
  status,
  errorMessage,
  onRetry,
  onCreateNote,
  onOpenNote
}: NotesWidgetProps) {
  const sortedNotes = [...notes].sort((left, right) => Number(right.pinned) - Number(left.pinned));

  return (
    <div className="widget-content">
      <div className="card-header">
        <div className="heading-group">
          <h2>便签</h2>
        </div>
        <button type="button" className="btn btn-icon" aria-label="新增便签" onClick={onCreateNote}>
          <Plus aria-hidden="true" />
        </button>
      </div>
      <div data-testid="notes-scroll" className="panel-body">
        {status === 'error' ? (
          <div className="module-message" role="alert">
            <span>{errorMessage ?? '无法读取便签。'}</span>
            <button type="button" className="link-btn" aria-label="重试读取便签" onClick={onRetry}>
              重试
            </button>
          </div>
        ) : null}
        {status === 'loading' ? <p className="empty-copy">正在读取本地便签</p> : null}
        {status === 'ready' && sortedNotes.length === 0 ? (
          <div className="empty-state">
            <p>还没有便签</p>
            <button
              type="button"
              className="link-btn"
              aria-label="新建便签"
              onClick={onCreateNote}
            >
              新建便签
            </button>
          </div>
        ) : null}
        <div className="notes-list">
          {sortedNotes.map((note) => (
            <button
              key={note.id}
              type="button"
              onClick={() => onOpenNote(note)}
              className={`note ${noteColorClass[note.color]}`}
            >
              <div className="note-title">{note.title}</div>
              <div className="note-content">{note.content}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
