import { Check, ChevronDown, Pencil, Plus, Trash2, X } from './icons';
import {
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from 'react';
import { t } from '../i18n';
import { ColorPicker } from './ColorPicker';
import { ConfirmDialog } from './ConfirmDialog';
import { DESIGN_COLORS, normalizeHexColor, type ColorPreset, type HexColor } from '../lib/color';
import type { Category, CategoryDraft } from '../calendar/calendar-model';

type CategorySelectProps = {
  id: string;
  label: string;
  categories: Category[];
  // The selected category id, or '' for "no category".
  value: string;
  onChange: (categoryId: string) => void;
  onCreate: (draft: CategoryDraft) => Promise<Category>;
  onUpdate: (id: string, draft: CategoryDraft) => Promise<Category>;
  onDelete: (id: string) => Promise<void>;
  disabled?: boolean;
  hideLabel?: boolean;
  // Escape and outside-click on the delete confirmation should not close the
  // host dialog; hosts can react to this to hand over focus/escape handling.
  onOverlayOpenChange?: (open: boolean) => void;
};

// The palette offered when creating/editing a category. Category and color are
// one concept, so the picker seeds from the design system's core hues.
function categoryColorPresets(): readonly ColorPreset[] {
  return [
    { value: DESIGN_COLORS.primary, label: t('color.teal') },
    { value: DESIGN_COLORS.danger, label: t('color.coral') },
    { value: DESIGN_COLORS.success, label: t('color.green') },
    { value: DESIGN_COLORS.warning, label: t('color.amber') },
    { value: DESIGN_COLORS.info, label: t('color.indigo') }
  ];
}

const DEFAULT_NEW_COLOR = DESIGN_COLORS.primary as HexColor;

type EditorState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; category: Category };

// A dropdown that both selects and manages calendar categories. Users pick an
// existing category (or "no category"), or open an inline editor to add a new
// one (name + color) or edit/delete existing ones. Deleting a category makes
// every event/subscription that used it fall back to no category, no color.
export function CategorySelect({
  id,
  label,
  categories,
  value,
  onChange,
  onCreate,
  onUpdate,
  onDelete,
  disabled = false,
  hideLabel = false,
  onOverlayOpenChange
}: CategorySelectProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [placeAbove, setPlaceAbove] = useState(false);
  const [popupMaxHeight, setPopupMaxHeight] = useState(360);
  const [popupRect, setPopupRect] = useState<{ left: number; top: number; bottom: number; width: number } | null>(null);
  const [editor, setEditor] = useState<EditorState>({ mode: 'closed' });
  const [draftName, setDraftName] = useState('');
  const [draftColor, setDraftColor] = useState<HexColor>(DEFAULT_NEW_COLOR);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Category | null>(null);

  const selected = categories.find((category) => category.id === value) ?? null;

  useLayoutEffect(() => {
    if (!open) return;
    function measure() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const modalBody = rootRef.current?.closest('.good-modal-body, .good-dialog__body');
      const boundary = modalBody?.getBoundingClientRect();
      const topBoundary = Math.max(16, boundary?.top ?? 16);
      const bottomBoundary = Math.min(window.innerHeight - 16, boundary?.bottom ?? window.innerHeight - 16);
      const spaceBelow = bottomBoundary - rect.bottom - 8;
      const spaceAbove = rect.top - topBoundary - 8;
      const above = spaceBelow < 280 && spaceAbove > spaceBelow;
      setPlaceAbove(above);
      setPopupMaxHeight(Math.max(160, Math.min(400, above ? spaceAbove : spaceBelow)));
      setPopupRect({ left: rect.left, top: rect.bottom, bottom: rect.top, width: rect.width });
    }
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    function dismiss(event: PointerEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      close(false);
    }
    document.addEventListener('pointerdown', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    onOverlayOpenChange?.(confirmDelete !== null);
  }, [confirmDelete, onOverlayOpenChange]);

  function openList() {
    if (!disabled) setOpen(true);
  }
  function close(restoreFocus = true) {
    setOpen(false);
    resetEditor();
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }
  function resetEditor() {
    setEditor({ mode: 'closed' });
    setDraftName('');
    setDraftColor(DEFAULT_NEW_COLOR);
    setFormError('');
  }
  function choose(categoryId: string) {
    onChange(categoryId);
    close();
  }
  function beginCreate() {
    setEditor({ mode: 'create' });
    setDraftName('');
    setDraftColor(DEFAULT_NEW_COLOR);
    setFormError('');
  }
  function beginEdit(category: Category) {
    setEditor({ mode: 'edit', category });
    setDraftName(category.name);
    setDraftColor(normalizeHexColor(category.color) ?? DEFAULT_NEW_COLOR);
    setFormError('');
  }

  async function submitEditor() {
    const name = draftName.trim();
    if (!name) {
      setFormError(t('category.errorName'));
      return;
    }
    const color = normalizeHexColor(draftColor);
    if (!color) {
      setFormError(t('category.errorColor'));
      return;
    }
    setBusy(true);
    setFormError('');
    try {
      if (editor.mode === 'create') {
        const created = await onCreate({ name, color });
        onChange(created.id);
        close();
      } else if (editor.mode === 'edit') {
        await onUpdate(editor.category.id, { name, color });
        resetEditor();
      }
    } catch (error) {
      setFormError(errorMessage(error) || t('category.errorSave'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemoval() {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await onDelete(confirmDelete.id);
      // The removed category leaves the field unselected if it was the choice.
      if (value === confirmDelete.id) onChange('');
      setConfirmDelete(null);
    } catch (error) {
      setFormError(errorMessage(error) || t('category.errorSave'));
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!open && ['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      openList();
      return;
    }
    if (open && event.key === 'Escape') {
      event.preventDefault();
      if (editor.mode !== 'closed') resetEditor();
      else close();
    }
  }

  const editing = editor.mode !== 'closed';

  return (
    <div ref={rootRef} className="select-field category-select">
      <label className={hideLabel ? 'select-label visually-hidden' : 'select-label'} id={`${id}-label`} htmlFor={id}>{label}</label>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-labelledby={`${id}-label`}
        aria-haspopup="dialog"
        aria-controls={listboxId}
        aria-expanded={open}
        disabled={disabled}
        className="select-trigger"
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={handleKeyDown}
      >
        <span className="select-value">
          {selected ? <span className="select-dot" style={{ background: selected.color }} aria-hidden="true" /> : null}
          {selected ? selected.name : <span className="category-select__placeholder">{t('category.none')}</span>}
        </span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={popupRef}
          id={listboxId}
          className={`select-popup category-select__popup${placeAbove ? ' select-popup--above' : ''}`}
          style={{
            maxHeight: `${popupMaxHeight}px`,
            ...(popupRect
              ? {
                  left: `${popupRect.left}px`,
                  width: `${popupRect.width}px`,
                  ...(placeAbove
                    ? { bottom: `${window.innerHeight - popupRect.bottom + 8}px` }
                    : { top: `${popupRect.top + 8}px` })
                }
              : { visibility: 'hidden' })
          }}
        >
          {editing ? (
            <div className="category-select__editor" role="group" aria-label={editor.mode === 'create' ? t('category.addTitle') : t('category.editTitle')}>
              <div className="category-select__editor-head">
                <span>{editor.mode === 'create' ? t('category.addTitle') : t('category.editTitle')}</span>
                <button type="button" className="good-icon-button" aria-label={t('common.cancel')} disabled={busy} onClick={resetEditor}>
                  <X aria-hidden="true" />
                </button>
              </div>
              <input
                className="good-input"
                autoFocus
                value={draftName}
                placeholder={t('category.namePlaceholder')}
                disabled={busy}
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void submitEditor(); } }}
              />
              <ColorPicker
                legend={t('category.colorLegend')}
                name={`${id}-color`}
                value={draftColor}
                presets={categoryColorPresets()}
                recentColors={[]}
                disabled={busy}
                onChange={setDraftColor}
              />
              {formError ? <div role="alert" className="dialog-error">{formError}</div> : null}
              <div className="category-select__editor-actions">
                <button type="button" className="good-button" disabled={busy} onClick={resetEditor}>{t('common.cancel')}</button>
                <button type="button" className="good-button good-button--primary" disabled={busy} onClick={() => void submitEditor()}>
                  {editor.mode === 'create' ? t('category.add') : t('category.save')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="select-listbox" role="listbox" aria-labelledby={`${id}-label`}>
                <button
                  type="button"
                  className="select-option"
                  role="option"
                  aria-selected={value === ''}
                  onClick={() => choose('')}
                >
                  <span className="select-value category-select__none">{t('category.none')}</span>
                  {value === '' ? <Check aria-hidden="true" /> : null}
                </button>
                {categories.map((category) => (
                  <div key={category.id} className={`category-select__row${category.id === value ? ' is-selected' : ''}`}>
                    <button
                      type="button"
                      className="select-option category-select__pick"
                      role="option"
                      aria-selected={category.id === value}
                      onClick={() => choose(category.id)}
                    >
                      <span className="select-value">
                        <span className="select-dot" style={{ background: category.color }} aria-hidden="true" />
                        {category.name}
                      </span>
                      {category.id === value ? <Check aria-hidden="true" /> : null}
                    </button>
                    <span className="category-select__row-tools">
                      <button type="button" className="good-icon-button" aria-label={t('category.edit', { name: category.name })} onClick={() => beginEdit(category)}>
                        <Pencil aria-hidden="true" />
                      </button>
                      <button type="button" className="good-icon-button" aria-label={t('category.delete', { name: category.name })} onClick={() => setConfirmDelete(category)}>
                        <Trash2 aria-hidden="true" />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
              <button type="button" className="category-select__add" onClick={beginCreate}>
                <Plus aria-hidden="true" />
                {t('category.add')}
              </button>
            </>
          )}
        </div>
      ) : null}
      {confirmDelete ? (
        <ConfirmDialog
          title={t('category.deleteTitle', { name: confirmDelete.name })}
          description={t('category.deleteBody')}
          tone="danger"
          confirmLabel={t('category.deleteConfirm')}
          busyLabel={t('common.deleting')}
          busy={busy}
          onConfirm={() => void confirmRemoval()}
          onCancel={() => setConfirmDelete(null)}
        />
      ) : null}
    </div>
  );
}

function errorMessage(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? (error as { message: string }).message
    : '';
}
