import {
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef
} from 'react';

const focusableSelector =
  'button:not([disabled]),[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export type DialogProps = {
  title: string;
  ariaLabelledBy: string;
  isTopLayer?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onRequestClose: () => void;
  headerActions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Dialog({
  title,
  ariaLabelledBy,
  isTopLayer = true,
  initialFocusRef,
  restoreFocusRef,
  onRequestClose,
  headerActions,
  footer,
  children,
  className
}: DialogProps) {
  const generatedId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = ariaLabelledBy || generatedId;

  useEffect(() => {
    const target = initialFocusRef?.current ?? dialogRef.current?.querySelector<HTMLElement>(focusableSelector);
    target?.focus();
  }, [initialFocusRef]);

  useEffect(() => {
    const restoreTarget = restoreFocusRef?.current;
    return () => restoreTarget?.focus();
  }, [restoreFocusRef]);

  useEffect(() => {
    if (!isTopLayer) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onRequestClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []
      ).filter((element) => !element.hasAttribute('disabled'));
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isTopLayer, onRequestClose]);

  return (
    <div className="overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`good-dialog${className ? ` ${className}` : ''}`}
      >
        <header className="good-dialog__header">
          <h2 id={titleId}>{title}</h2>
          {headerActions ? <div className="good-dialog__header-actions">{headerActions}</div> : null}
        </header>
        <div className="good-dialog__body">{children}</div>
        {footer ? <footer className="good-dialog__footer">{footer}</footer> : null}
      </div>
    </div>
  );
}
