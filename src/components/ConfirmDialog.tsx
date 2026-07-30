import { useId, type ReactNode, type RefObject } from 'react';
import { Dialog } from './Dialog';

export type ConfirmDialogProps = {
  title: string;
  description: ReactNode;
  tone?: 'default' | 'danger';
  confirmLabel: string;
  busyLabel: string;
  busy?: boolean;
  errorMessage?: string;
  isTopLayer?: boolean;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({
  title,
  description,
  tone = 'default',
  confirmLabel,
  busyLabel,
  busy = false,
  errorMessage,
  isTopLayer = true,
  restoreFocusRef,
  onCancel,
  onConfirm
}: ConfirmDialogProps) {
  const titleId = useId();

  return (
    <Dialog
      title={title}
      ariaLabelledBy={titleId}
      isTopLayer={isTopLayer}
      restoreFocusRef={restoreFocusRef}
      onRequestClose={busy ? () => undefined : onCancel}
      className="confirm-dialog"
      footer={
        <>
          <button type="button" className="good-button" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className={`good-button${tone === 'danger' ? ' good-button--danger' : ' good-button--primary'}`}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </>
      }
    >
      <div className="confirm-dialog__description">{description}</div>
      {errorMessage ? <div className="dialog-error" role="alert">{errorMessage}</div> : null}
    </Dialog>
  );
}
