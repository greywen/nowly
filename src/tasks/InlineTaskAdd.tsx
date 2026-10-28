import { type KeyboardEvent, useRef, useState } from 'react';
import { Plus } from '../components/icons';
import { t } from '../i18n';

type InlineTaskAddProps = {
  // Accessible name for both the trigger and the input, e.g. "在待处理添加任务".
  label: string;
  onCreate(title: string): Promise<unknown>;
};

function messageFrom(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : t('common.opFailed');
}

// One-line task capture at the end of a lane or quadrant. Enter saves and keeps
// the input open for the next task; Esc or blurring an empty input collapses it;
// blurring with text saves it first.
export function InlineTaskAdd({ label, onCreate }: InlineTaskAddProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Focus returns to the trigger after Esc so the keyboard position is kept,
  // but without the focus ring; it comes back once the trigger is left.
  const [quietFocus, setQuietFocus] = useState(false);
  const busyRef = useRef(false);
  const focusedRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function collapse(restoreFocus: boolean) {
    setOpen(false);
    setTitle('');
    setError('');
    if (restoreFocus) {
      setQuietFocus(true);
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }

  async function save(value: string) {
    const trimmed = value.trim();
    if (!trimmed || busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await onCreate(trimmed);
      setTitle('');
      return true;
    } catch (reason) {
      setError(messageFrom(reason));
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Enter that confirms an IME candidate must not submit the task.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      collapse(true);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!title.trim()) {
        collapse(true);
        return;
      }
      void save(title).then((saved) => {
        // The user may have moved on while the write was in flight.
        if (saved && !focusedRef.current) collapse(false);
      });
    }
  }

  async function handleBlur() {
    focusedRef.current = false;
    if (busyRef.current) return;
    if (!title.trim()) {
      collapse(false);
      return;
    }
    if (await save(title)) collapse(false);
  }

  if (!open) {
    return (
      <button
        ref={triggerRef}
        type="button"
        className={`inline-add__trigger${quietFocus ? ' inline-add__trigger--quiet' : ''}`}
        aria-label={label}
        onBlur={() => setQuietFocus(false)}
        onClick={() => {
          setQuietFocus(false);
          setOpen(true);
        }}
      >
        <Plus aria-hidden="true" />
        {t('inlineAdd.trigger')}
      </button>
    );
  }

  return (
    <div className="inline-add">
      <input
        className="good-input inline-add__input"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        placeholder={t('inlineAdd.placeholder')}
        autoComplete="off"
        autoFocus
        value={title}
        readOnly={busy}
        onFocus={() => { focusedRef.current = true; }}
        onChange={(event) => {
          setTitle(event.target.value);
          if (error) setError('');
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => void handleBlur()}
      />
      {error
        ? <p className="inline-add__error" role="alert">{error}</p>
        : <p className="inline-add__hint">{t('inlineAdd.hint')}</p>}
    </div>
  );
}
