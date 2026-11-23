import type { Note } from '../notes-model';
import { useId, useRef, useState } from 'react';
import { Select } from '../../components/Select';
import { useNowlyRepository } from '../../data/RepositoryContext';
import { t } from '../../i18n';
import { exportNotes } from './native';
import type { NoteExportFormat } from './service';
import './export.css';

export function NoteExportControls({ notes, onBusyChange }: { notes: readonly Note[]; onBusyChange?: (busy: boolean) => void }) {
  const source = useNowlyRepository();
  const id = useId();
  const [format, setFormat] = useState<NoteExportFormat>('pdf');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  async function run() {
    if (!notes.length || locked.current) return;
    locked.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setStatus('');
    setError('');
    try {
      const saved = await exportNotes(notes.map(note => ({ ...note })), format, source, (done, total) => {
        setStatus(t('noteExport.progress', { done, total }));
      });
      setStatus(t(saved ? 'noteExport.success' : 'noteExport.cancelled'));
    } catch (failure) {
      const reason = failure && typeof failure === 'object' && 'reason' in failure ? failure.reason : '';
      const specific = typeof reason === 'string' && ['attachment', 'tooLarge', 'desktopOnly', 'empty'].includes(reason);
      setError(t(specific ? `noteExport.${reason}` : 'noteExport.failed'));
      setStatus('');
    } finally {
      locked.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  return <div className="note-export-controls" aria-busy={busy}>
    <div className="note-export-controls__actions">
      <Select id={id} label={t('noteExport.format')} value={format} disabled={busy}
        options={[{value:'pdf',label:'PDF'},{value:'markdown',label:'Markdown (.md)'}]}
        onChange={value => { setFormat(value as NoteExportFormat); setError(''); setStatus(''); }} />
      <button type="button" className="good-button good-button--primary" disabled={!notes.length || busy} onClick={() => void run()}>
        {t(busy ? 'noteExport.busy' : 'noteExport.submit')}
      </button>
    </div>
    <p className="note-export-controls__hint">{t(format === 'markdown' ? 'noteExport.markdownHint' : 'noteExport.pdfHint')}</p>
    <p className="note-export-controls__hint">{t('noteExport.bundleHint')}</p>
    {error ? <p role="alert" className="dialog-error">{error}</p> : null}
    {status ? <p role="status" className="note-export-controls__status">{status}</p> : null}
  </div>;
}
