import { useId, useState } from 'react';
import type { EditScope } from '../calendar/calendar-model';
import { Dialog } from '../components/Dialog';
import { t } from '../i18n';

type RecurrenceScopeDialogProps = {
  action: 'edit' | 'delete';
  isFirstOccurrence: boolean;
  slotsChanged: boolean;
  hasLinkedTask: boolean;
  busy?: boolean;
  errorMessage?: string;
  onCancel(): void;
  onConfirm(scope: EditScope): void;
};

export function RecurrenceScopeDialog({
  action,
  isFirstOccurrence,
  slotsChanged,
  hasLinkedTask,
  busy = false,
  errorMessage,
  onCancel,
  onConfirm
}: RecurrenceScopeDialogProps) {
  const [scope, setScope] = useState<EditScope>('occurrence');
  const titleId = useId();
  // The first occurrence makes "this and following" identical to "all".
  const scopes: EditScope[] = isFirstOccurrence
    ? ['occurrence', 'all']
    : ['occurrence', 'thisAndFollowing', 'all'];
  const notice =
    scope === 'all' && slotsChanged
      ? t('recurrence.noticeExceptionsCleared')
      : scope === 'thisAndFollowing' && hasLinkedTask
        ? t('recurrence.noticeLinkedTaskKept')
        : '';

  return (
    <Dialog
      title={action === 'edit' ? t('recurrence.editScopeTitle') : t('recurrence.deleteScopeTitle')}
      ariaLabelledBy={titleId}
      onRequestClose={busy ? () => undefined : onCancel}
      footer={
        <>
          <button type="button" className="good-button" disabled={busy} onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="good-button good-button--primary"
            disabled={busy}
            onClick={() => onConfirm(scope)}
          >
            {busy ? t(action === 'edit' ? 'common.saving' : 'common.deleting') : t('common.confirm')}
          </button>
        </>
      }
    >
      <fieldset className="recurrence-scope">
        <legend>{t('recurrence.scopeLegend')}</legend>
        {scopes.map((value) => (
          <label key={value} className="form-check form-check-custom form-check-solid">
            <input
              className="form-check-input"
              type="radio"
              name="recurrence-scope"
              value={value}
              checked={scope === value}
              disabled={busy}
              onChange={() => setScope(value)}
            />
            <span className="form-check-label">{t(`recurrence.scope.${value}`)}</span>
          </label>
        ))}
      </fieldset>
      {notice ? <p className="recurrence-scope__notice">{notice}</p> : null}
      {errorMessage ? <div className="dialog-error" role="alert">{errorMessage}</div> : null}
    </Dialog>
  );
}
