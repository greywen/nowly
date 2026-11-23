import { type RefObject, useId, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { X } from '../../components/icons';
import { t } from '../../i18n';
import type { Note } from '../notes-model';
import { NoteExportControls } from './NoteExportControls';

export function NoteExportDialog({ note, onClose, restoreFocusRef }: {
  note: Note; onClose(): void; restoreFocusRef?: RefObject<HTMLElement | null>;
}) {
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  return <Dialog title={t('noteExport.title')} ariaLabelledBy={titleId} restoreFocusRef={restoreFocusRef}
    onRequestClose={() => { if (!busy) onClose(); }}
    headerActions={<button type="button" className="good-icon-button" aria-label={t('common.close')} disabled={busy} onClick={onClose}><X aria-hidden="true" /></button>}>
    <p className="note-export-controls__hint">{t('noteExport.draftHint')}</p>
    <NoteExportControls notes={[note]} onBusyChange={setBusy} />
  </Dialog>;
}
