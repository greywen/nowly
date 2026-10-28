import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Category, CategoryDraft } from '../calendar/calendar-model';
import type { CalendarSubscription } from '../calendar/subscription-model';
import { useCategories } from '../calendar/useCategories';
import { createEventWith } from '../calendar/useEvents';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DEFAULT_ICON_STYLE, type IconStyle } from '../components/icon-style';
import { IconStyleProvider } from '../components/icons';
import { useNowlyRepository } from '../data/RepositoryContext';
import type { AppSettings } from '../data/nowly-repository';
import { t, useTranslation } from '../i18n';
import type { HexColor } from '../lib/color';
import { EventModal } from '../modals/EventModal';
import { NoteModal } from '../modals/NoteModal';
import type { Note } from '../notes/notes-model';
import { defaultSettings } from '../settings/useSettings';
import { useRecentColors } from '../settings/useRecentColors';
import { useTaskWorkspace } from '../tasks/TaskWorkspaceContext';
import { UnifiedTaskDialog } from '../tasks/UnifiedTaskDialog';
import {
  QUICK_CREATE_CLOSE_REQUESTED_EVENT,
  QUICK_CREATE_OPEN_EVENT,
  RECORDS_CHANGED_EVENT,
  type RecordsChangedKind
} from './events';
import { normalizeQuickCreateRequest, type QuickCreateKind, type QuickCreateRequest } from './request';
import './quick-create.css';

const DIALOG_SELECTOR = '.overlay > :is(.event-dialog, .task-dialog, .note-dialog)';
const FIRST_FIELD_SELECTOR = '.good-dialog__body :is(input.good-input, .ql-editor)';
// Rich text editors mount after their dependencies load. The window waits for
// them so it does not grow right after appearing, but never forever.
const EDITOR_WAIT_MS = 1500;

type Current = { request: QuickCreateRequest; kind: QuickCreateKind; session: number };
type State = { current: Current | null; switchTo: QuickCreateKind | null; confirmClose: boolean };
type Look = { density: AppSettings['density']; iconStyle: IconStyle };
type Watch = { dialog: Element; observers: Array<{ disconnect(): void }>; timer: number; waited: boolean };

const CLOSED: State = { current: null, switchTo: null, confirmClose: false };
const FALLBACK_LOOK: Look = { density: defaultSettings.density, iconStyle: DEFAULT_ICON_STYLE };

function receive(state: State, request: QuickCreateRequest, dirty: boolean): State {
  const current = state.current;
  if (!current || (request.kind !== current.kind && !dirty)) {
    return { current: { request, kind: request.kind, session: request.id }, switchTo: null, confirmClose: false };
  }
  // The open dialog keeps its draft; layout and closing follow the newest request.
  return { current: { ...current, request }, switchTo: request.kind === current.kind ? null : request.kind, confirmClose: false };
}

function localIsoDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function editorsReady(dialog: Element) {
  return Array.from(dialog.querySelectorAll('.rich-editor__quill')).every((editor) => editor.querySelector('.ql-editor'));
}

// Density and icon style are read again for every request: the window stays
// alive while hidden, and the main window may have changed them meanwhile.
function useLook(requestId: number | null) {
  const repository = useNowlyRepository();
  const [look, setLook] = useState<Look | null>(null);
  useEffect(() => {
    if (requestId === null) return;
    let cancelled = false;
    repository.getSettings().then(
      (settings) => { if (!cancelled) setLook({ density: settings.density, iconStyle: settings.iconStyle }); },
      () => { if (!cancelled) setLook((current) => current ?? FALLBACK_LOOK); }
    );
    return () => { cancelled = true; };
  }, [repository, requestId]);
  return look;
}

const ignore = async () => undefined;

type DialogProps = { onClose(): void; onDirtyChange(dirty: boolean): void };

function QuickEventDialog({ onSaved, ...props }: DialogProps & {
  onSaved(): void;
  subscriptions: CalendarSubscription[];
  categories: Category[];
  recentColors: HexColor[];
  onRememberCustomColor(color: HexColor): void;
  onCreateCategory(draft: CategoryDraft): Promise<Category>;
  onUpdateCategory(id: string, draft: CategoryDraft): Promise<Category>;
  onDeleteCategory(id: string): Promise<void>;
}) {
  const repository = useNowlyRepository();
  // One draft per dialog: the form compares itself against this initial state.
  const mode = useMemo(() => ({ type: 'create' as const, dateIso: localIsoDate(new Date()) }), []);
  return (
    <EventModal
      {...props}
      mode={mode}
      onSaved={onSaved}
      onDeleted={ignore}
      createEvent={(draft, subscriptionId) => createEventWith(repository, draft, subscriptionId ?? null)}
      updateEvent={ignore}
      deleteEvent={ignore}
    />
  );
}

function QuickTaskDialog({ onSaved, ...props }: DialogProps & { onSaved(): void }) {
  const mode = useMemo(() => ({ type: 'create' as const, dueDate: null }), []);
  return <UnifiedTaskDialog {...props} mode={mode} onSaved={onSaved} />;
}

function QuickNoteDialog({ onSaved, ...props }: DialogProps & {
  onSaved(): void;
  recentColors: HexColor[];
  onRememberCustomColor(color: HexColor): void;
}) {
  const repository = useNowlyRepository();
  const mode = useMemo(() => ({ type: 'create' as const }), []);
  return (
    <NoteModal
      {...props}
      mode={mode}
      onSaved={onSaved}
      onDeleted={ignore}
      createNote={(draft) => repository.createNote(draft)}
      updateNote={(note: Note) => Promise.resolve(note)}
      deleteNote={ignore}
    />
  );
}

/**
 * The quick-create window: one create dialog at a time, opened from the Bar
 * menu or a global shortcut without bringing up the main window.
 */
export function QuickCreateApp() {
  useTranslation();
  const repository = useNowlyRepository();
  const [state, setStateValue] = useState<State>(CLOSED);
  const stateRef = useRef(state);
  const setState = useCallback((next: State) => {
    stateRef.current = next;
    setStateValue(next);
  }, []);
  const lastRequestId = useRef(0);
  const dirty = useRef(false);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const current = state.current;
  const session = current?.session ?? null;
  const kind = current?.kind ?? null;
  const look = useLook(current?.request.id ?? null);
  const { recentColors, rememberColor } = useRecentColors();
  const { categories, reloadCategories, createCategory, updateCategory, deleteCategory } = useCategories();
  const [subscriptions, setSubscriptions] = useState<CalendarSubscription[]>([]);
  const { workspace, retry: reloadWorkspace } = useTaskWorkspace();
  const [taskSession, setTaskSession] = useState<number | null>(null);

  const markDirty = useCallback((value: boolean) => { dirty.current = value; }, []);
  const notify = useCallback((changed: RecordsChangedKind) => {
    void emit(RECORDS_CHANGED_EVENT, { kind: changed }).catch(() => undefined);
  }, []);

  const close = useCallback(() => {
    const request = stateRef.current.current?.request;
    dirty.current = false;
    setState(CLOSED);
    if (request) void invoke('close_quick_create', { requestId: request.id }).catch(() => undefined);
  }, [setState]);

  const accept = useCallback((value: unknown) => {
    const request = normalizeQuickCreateRequest(value);
    if (!request || request.id <= lastRequestId.current) return;
    lastRequestId.current = request.id;
    const next = receive(stateRef.current, request, dirty.current);
    if (next.current?.session !== stateRef.current.current?.session) dirty.current = false;
    else if (next.switchTo && !stateRef.current.switchTo) restoreFocus.current = document.activeElement as HTMLElement | null;
    setState(next);
  }, [setState]);

  const requestClose = useCallback(() => {
    const now = stateRef.current;
    if (!now.current) return;
    if (!dirty.current) {
      close();
      return;
    }
    if (!now.confirmClose) restoreFocus.current = document.activeElement as HTMLElement | null;
    setState({ ...now, switchTo: null, confirmClose: true });
  }, [close, setState]);

  // Listen before pulling, so a request sent in between is not lost; ids make
  // a request seen twice harmless.
  useEffect(() => {
    let disposed = false;
    const removers: Array<() => void> = [];
    const keep = (remove: () => void) => {
      if (disposed) remove();
      else removers.push(remove);
    };
    void Promise.all([
      listen(QUICK_CREATE_OPEN_EVENT, (event) => accept(event.payload)).then(keep),
      listen(QUICK_CREATE_CLOSE_REQUESTED_EVENT, requestClose).then(keep)
    ])
      .then(() => (disposed ? null : invoke<unknown>('get_quick_create_request')))
      .then((value) => { if (!disposed) accept(value); })
      .catch(() => undefined);
    return () => {
      disposed = true;
      removers.forEach((remove) => remove());
    };
  }, [accept, requestClose]);

  useEffect(() => {
    if (kind !== 'event' || session === null) return;
    let cancelled = false;
    reloadCategories();
    repository.listCalendarSubscriptions().then(
      (list) => { if (!cancelled) setSubscriptions(list); },
      () => { if (!cancelled) setSubscriptions([]); }
    );
    return () => { cancelled = true; };
  }, [kind, session, reloadCategories, repository]);

  // A new task dialog waits for a fresh workspace: its lane defaults come from it.
  useEffect(() => {
    if (kind !== 'task' || session === null) return;
    let cancelled = false;
    void reloadWorkspace().finally(() => { if (!cancelled) setTaskSession(session); });
    return () => { cancelled = true; };
  }, [kind, session, reloadWorkspace]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.surface = 'quick-create';
    return () => {
      delete root.dataset.surface;
      delete root.dataset.density;
      root.style.removeProperty('--quick-create-max-h');
    };
  }, []);

  const density = look?.density;
  useLayoutEffect(() => {
    if (density) document.documentElement.dataset.density = density;
  }, [density]);

  const reported = useRef<string | null>(null);
  const focused = useRef<number | null>(null);
  const watched = useRef<Watch | null>(null);

  // Measures the dialog and reports it to the native window. Layout has to
  // work while the window is still hidden, where ResizeObserver and animation
  // frames do not run, so it is driven by commits and DOM mutations too.
  const settle = useCallback(() => {
    const active = stateRef.current.current;
    const watch = watched.current;
    if (!active || !watch) return;
    const dialog = watch.dialog;
    if (focused.current !== active.session) {
      const field = dialog.querySelector<HTMLElement>(FIRST_FIELD_SELECTOR);
      // Dialog puts focus on its close button when it mounts; taking over only
      // after that keeps it from taking focus back.
      if (field && dialog.contains(document.activeElement)) {
        field.focus();
        focused.current = active.session;
        // Strict mode replays the dialog's mount effects right after this
        // commit, before any input can arrive, so the field takes focus back.
        queueMicrotask(() => {
          if (field.isConnected && document.activeElement !== field && dialog.contains(document.activeElement)) field.focus();
        });
      }
    }
    if (!watch.waited && !editorsReady(dialog)) return;
    const height = (dialog as HTMLElement).offsetHeight;
    if (height <= 0) return;
    const key = `${active.request.id}:${active.kind}:${height}`;
    if (reported.current === key) return;
    reported.current = key;
    void invoke('quick_create_layout', { requestId: active.request.id, kind: active.kind, height }).catch(() => undefined);
  }, []);

  const unwatch = useCallback(() => {
    const watch = watched.current;
    if (!watch) return;
    watch.observers.forEach((observer) => observer.disconnect());
    window.clearTimeout(watch.timer);
    watched.current = null;
  }, []);

  useLayoutEffect(() => {
    if (current) document.documentElement.style.setProperty('--quick-create-max-h', `${current.request.maxHeight}px`);
    const dialog = current ? document.querySelector(DIALOG_SELECTOR) : null;
    if (watched.current?.dialog !== dialog) {
      unwatch();
      if (dialog) {
        const watch: Watch = { dialog, observers: [], timer: 0, waited: false };
        const mutations = new MutationObserver(settle);
        mutations.observe(dialog, { childList: true, subtree: true, attributes: true });
        watch.observers.push(mutations);
        if (typeof ResizeObserver !== 'undefined') {
          const resize = new ResizeObserver(settle);
          resize.observe(dialog);
          watch.observers.push(resize);
        }
        watch.timer = window.setTimeout(() => {
          watch.waited = true;
          settle();
        }, EDITOR_WAIT_MS);
        watched.current = watch;
      }
    }
    settle();
  });
  // Runs after the dialog's own mount effects, which move focus.
  useEffect(() => { settle(); });
  useEffect(() => unwatch, [unwatch]);

  const stay = useCallback(() => {
    setState({ ...stateRef.current, switchTo: null, confirmClose: false });
  }, [setState]);
  const switchNow = useCallback(() => {
    const now = stateRef.current;
    if (!now.current || !now.switchTo) return;
    dirty.current = false;
    setState({ current: { request: now.current.request, kind: now.switchTo, session: now.current.request.id }, switchTo: null, confirmClose: false });
  }, [setState]);

  const withCategoryNotice = useCallback(<T,>(write: Promise<T>) => write.then((result) => {
    notify('category');
    return result;
  }), [notify]);

  let dialog = null;
  if (current && look) {
    const shared = { onClose: close, onDirtyChange: markDirty };
    if (current.kind === 'event') {
      dialog = (
        <QuickEventDialog
          key={current.session}
          {...shared}
          onSaved={() => notify('event')}
          subscriptions={subscriptions}
          categories={categories}
          recentColors={recentColors}
          onRememberCustomColor={rememberColor}
          onCreateCategory={(draft) => withCategoryNotice(createCategory(draft))}
          onUpdateCategory={(id, draft) => withCategoryNotice(updateCategory(id, draft))}
          onDeleteCategory={(id) => withCategoryNotice(deleteCategory(id))}
        />
      );
    } else if (current.kind === 'note') {
      dialog = (
        <QuickNoteDialog
          key={current.session}
          {...shared}
          onSaved={() => notify('note')}
          recentColors={recentColors}
          onRememberCustomColor={rememberColor}
        />
      );
    } else if (taskSession === current.session) {
      dialog = workspace.status === 'ready'
        ? <QuickTaskDialog key={current.session} {...shared} onSaved={() => notify('task')} />
        : (
          <ConfirmDialog
            className="task-dialog"
            title={t('taskModal.createTitle')}
            description={workspace.status === 'error' ? workspace.message : t('matrix.readError')}
            confirmLabel={t('common.retry')}
            busyLabel={t('common.retry')}
            busy={workspace.status === 'loading'}
            onCancel={close}
            onConfirm={() => void reloadWorkspace()}
          />
        );
    }
  }

  return (
    <IconStyleProvider style={look?.iconStyle ?? DEFAULT_ICON_STYLE}>
      {dialog}
      {dialog && (state.switchTo || state.confirmClose) ? (
        <ConfirmDialog
          title={t('common.discardTitle')}
          description={t('common.discardDesc')}
          confirmLabel={t('common.discard')}
          busyLabel={t('common.discarding')}
          restoreFocusRef={restoreFocus}
          onCancel={stay}
          onConfirm={state.switchTo ? switchNow : close}
        />
      ) : null}
    </IconStyleProvider>
  );
}
