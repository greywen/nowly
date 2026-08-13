import { Plus } from 'lucide-react';
import type { Note } from './notes-model';
import { colorStyle } from '../lib/color';

type LoadStatus = 'loading' | 'ready' | 'error';

type NotesWidgetProps = {
  notes: Note[];
  status: LoadStatus;
  errorMessage?: string;
  onRetry: () => void;
  onCreateNote: () => void;
  onOpenNote: (note: Note, trigger: HTMLElement) => void;
  onViewAll: (trigger: HTMLElement) => void;
};

export function NotesWidget({
  notes,
  status,
  errorMessage,
  onRetry,
  onCreateNote,
  onOpenNote,
  onViewAll
}: NotesWidgetProps) {
  const sortedNotes = [...notes].sort((left, right) => Number(right.pinned) - Number(left.pinned));

  return (
    <div className="widget-content">
      <div className="card-header">
        <div className="heading-group">
          <h2>便签</h2>
        </div>
        <div className="toolbar-actions">
          <button type="button" className="link-btn" onClick={(event) => onViewAll(event.currentTarget)}>查看全部便签</button>
          <button type="button" className="btn btn-icon" aria-label="新增便签" onClick={onCreateNote}>
            <Plus aria-hidden="true" />
          </button>
        </div>
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
              onClick={(event) => onOpenNote(note, event.currentTarget)}
              className="note"
              style={colorStyle(note.color)}
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
