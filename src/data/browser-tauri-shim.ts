// Browser fallback for the Tauri IPC layer.
//
// The real desktop app talks to the Rust backend through
// `window.__TAURI_INTERNALS__.invoke`. When the plain Vite page is opened in an
// ordinary browser (no Tauri runtime) that object is `undefined`, so the very
// first `invoke(...)` call throws
// `Cannot read properties of undefined (reading 'invoke')` and the whole app
// fails to boot.
//
// To keep local browser development usable we install a self-contained
// in-memory backend that speaks the same command protocol as the Rust side and
// persists to `localStorage`. This mirrors what the Playwright specs inject,
// but is complete enough to run the full UI. Data lives only in the browser's
// `localStorage`, never the real SQLite database, so this is a development
// convenience, not a substitute for the desktop app.
//
// The shim is only installed when no real (or test-injected) Tauri IPC is
// present, so it never interferes with the desktop build or e2e runs.

type Dict = Record<string, unknown>;

const STORAGE_KEY = 'nowly:browser-backend';

type Store = {
  events: Dict[];
  subscriptions: Dict[];
  externalEvents: Dict[];
  tasks: Dict[];
  notes: Dict[];
  settings: Dict;
  moduleLayout: Dict[];
  moduleState: Record<string, string>;
  focusSessions: Dict[];
  extensions: Dict[];
  kanban: {
    lanes: Dict[];
    cards: Dict[];
    priorities: Dict[];
    tags: Dict[];
    collaborators: Dict[];
  };
};

const defaultSettings: Dict = {
  wallpaperEnabled: false,
  launchAtLogin: false,
  targetMonitorId: null,
  density: 'balanced',
  weekStart: 'monday',
  dateFormat: 'localized',
  showWeekends: true,
  recentColors: []
};

function emptyStore(): Store {
  return {
    events: [],
    subscriptions: [],
    externalEvents: [],
    tasks: [],
    notes: [],
    settings: { ...defaultSettings },
    moduleLayout: [],
    moduleState: {},
    focusSessions: [],
    extensions: [],
    kanban: { lanes: [], cards: [], priorities: [], tags: [], collaborators: [] }
  };
}

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<Store>;
    const base = emptyStore();
    return {
      ...base,
      ...parsed,
      settings: { ...base.settings, ...(parsed.settings ?? {}) },
      moduleState: { ...(parsed.moduleState ?? {}) },
      kanban: { ...base.kanban, ...(parsed.kanban ?? {}) }
    };
  } catch {
    return emptyStore();
  }
}

function id(prefix: string) {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${rand}`;
}

function nowIso() {
  return new Date().toISOString();
}

// Whether an event/external record starts inside the half-open range the UI
// asks for. Recurrence is not expanded in the browser fallback; recurring
// events surface only on their original start, which is an accepted dev-only
// limitation.
function inRange(startAt: unknown, range: { startAt: string; endAtExclusive: string }) {
  return typeof startAt === 'string' && startAt >= range.startAt && startAt < range.endAtExclusive;
}

export function installBrowserTauriBackend() {
  const store = loadStore();

  const persist = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      /* storage disabled; keep running from in-memory state */
    }
  };

  const handlers: Record<string, (args: Dict) => unknown> = {
    // Calendar events
    list_events_in_range: (a) =>
      store.events.filter((e) => inRange(e.startAt, a.range as never)),
    create_event: (a) => {
      const draft = a.draft as Dict;
      const event = { id: id('e'), createdAt: nowIso(), updatedAt: nowIso(), ...draft };
      store.events.push(event);
      persist();
      return event;
    },
    update_event: (a) => {
      const target = a.target as { id: string };
      const draft = a.draft as Dict;
      store.events = store.events.map((e) =>
        e.id === target.id ? { ...e, ...draft, updatedAt: nowIso() } : e
      );
      persist();
    },
    delete_event: (a) => {
      const target = a.target as { id: string };
      store.events = store.events.filter((e) => e.id !== target.id);
      persist();
    },

    // Calendar subscriptions
    list_calendar_subscriptions: () => store.subscriptions,
    create_calendar_subscription: (a) => {
      const sub = {
        id: id('sub'),
        lastSyncedAt: null,
        lastStatus: null,
        lastError: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        ...(a.draft as Dict)
      };
      store.subscriptions.push(sub);
      persist();
      return sub;
    },
    update_calendar_subscription: (a) => {
      let updated: Dict | undefined;
      store.subscriptions = store.subscriptions.map((s) =>
        s.id === a.id ? (updated = { ...s, ...(a.draft as Dict), updatedAt: nowIso() }) : s
      );
      persist();
      return updated;
    },
    delete_calendar_subscription: (a) => {
      store.subscriptions = store.subscriptions.filter((s) => s.id !== a.id);
      store.externalEvents = store.externalEvents.filter((e) => e.subscriptionId !== a.id);
      persist();
    },
    refresh_calendar_subscription: () => undefined,
    list_external_events_in_range: (a) =>
      store.externalEvents.filter((e) => inRange(e.startAt, a.range as never)),

    // Tasks
    list_tasks: () => store.tasks,
    create_task: (a) => {
      const task = { id: id('t'), createdAt: nowIso(), updatedAt: nowIso(), ...(a.draft as Dict) };
      store.tasks.push(task);
      persist();
      return task;
    },
    update_task: (a) => {
      let updated: Dict | undefined;
      store.tasks = store.tasks.map((t) =>
        t.id === a.id ? (updated = { ...t, ...(a.draft as Dict), updatedAt: nowIso() }) : t
      );
      persist();
      return updated;
    },
    delete_task: (a) => {
      store.tasks = store.tasks.filter((t) => t.id !== a.id);
      persist();
    },
    set_task_completed: (a) => {
      let updated: Dict | undefined;
      store.tasks = store.tasks.map((t) =>
        t.id === a.id ? (updated = { ...t, completed: a.completed, updatedAt: nowIso() }) : t
      );
      persist();
      return updated;
    },

    // Notes
    list_notes: () => store.notes,
    create_note: (a) => {
      const note = { id: id('n'), createdAt: nowIso(), updatedAt: nowIso(), ...(a.draft as Dict) };
      store.notes.push(note);
      persist();
      return note;
    },
    update_note: (a) => {
      let updated: Dict | undefined;
      store.notes = store.notes.map((n) =>
        n.id === a.id ? (updated = { ...n, ...(a.draft as Dict), updatedAt: nowIso() }) : n
      );
      persist();
      return updated;
    },
    delete_note: (a) => {
      store.notes = store.notes.filter((n) => n.id !== a.id);
      persist();
    },

    // Software update check. The browser dev shim has no Cargo version and
    // should not hit the GitHub API on every page load, so it reports the
    // injected build version with no update available.
    check_for_update: () => ({
      currentVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0',
      latestVersion: null,
      updateAvailable: false,
      releaseNotes: null,
      releaseUrl: 'https://github.com/greywen/nowly/releases',
      publishedAt: null
    }),

    // Settings & environment
    get_app_settings: () => store.settings,
    update_app_settings: (a) => {
      store.settings = { ...store.settings, ...(a.settings as Dict) };
      persist();
      return store.settings;
    },
    list_monitors: () => [
      {
        id: 'browser',
        name: 'Browser',
        isPrimary: true,
        positionX: 0,
        positionY: 0,
        width: typeof window !== 'undefined' ? window.screen.width : 1920,
        height: typeof window !== 'undefined' ? window.screen.height : 1080,
        scaleFactor: 1
      }
    ],

    // Module layout & per-module state
    list_module_layout: () => store.moduleLayout,
    save_module_layout: (a) => {
      store.moduleLayout = (a.layout as Dict[]) ?? [];
      persist();
      return store.moduleLayout;
    },
    get_module_state: (a) => store.moduleState[a.moduleId as string] ?? null,
    set_module_state: (a) => {
      store.moduleState[a.moduleId as string] = a.state as string;
      persist();
    },

    // Focus timer
    create_focus_session: (a) => {
      const session = a.session as Dict;
      store.focusSessions.push(session);
      persist();
      return session;
    },
    list_focus_sessions: (a) => {
      const range = a.range as { startAt: string; endAtExclusive: string };
      return store.focusSessions.filter(
        (s) =>
          typeof s.startedAt === 'string' &&
          s.startedAt >= range.startAt &&
          s.startedAt < range.endAtExclusive
      );
    },
    get_focus_statistics: (a) => {
      const boundaries = (a.boundaries as Array<{ period: string; startAt: string; endAtExclusive: string }>) ?? [];
      let totalFocusedSeconds = 0;
      let completedCount = 0;
      let interruptedCount = 0;
      const points = boundaries.map((b) => {
        const inWindow = store.focusSessions.filter(
          (s) =>
            typeof s.startedAt === 'string' &&
            s.startedAt >= b.startAt &&
            s.startedAt < b.endAtExclusive
        );
        const focused = inWindow.reduce((sum, s) => sum + Number(s.focusedSeconds ?? 0), 0);
        const completed = inWindow.filter((s) => s.status === 'completed').length;
        const interrupted = inWindow.filter((s) => s.status === 'interrupted').length;
        totalFocusedSeconds += focused;
        completedCount += completed;
        interruptedCount += interrupted;
        return { period: b.period, focusedSeconds: focused, completedCount: completed, interruptedCount: interrupted };
      });
      const total = completedCount + interruptedCount;
      return {
        totalFocusedSeconds,
        completedCount,
        interruptedCount,
        completionRate: total === 0 ? 0 : completedCount / total,
        points
      };
    },
    // The background OS timer has no browser equivalent; these are no-ops so the
    // in-app countdown still runs off the JS state machine.
    get_pending_focus_completion: () => null,
    acknowledge_focus_completion: () => undefined,
    start_focus_timer: () => undefined,
    pause_focus_timer: () => undefined,
    resume_focus_timer: () => undefined,
    cancel_focus_timer: () => undefined,

    // Sandbox extensions
    list_extensions: () => store.extensions,
    install_extension: (a) => {
      const ext = {
        id: id('ext'),
        allowedHosts: [],
        minW: 1,
        minH: 1,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        ...(a.draft as Dict)
      };
      store.extensions.push(ext);
      persist();
      return ext;
    },
    uninstall_extension: (a) => {
      store.extensions = store.extensions.filter((e) => e.id !== a.id);
      persist();
    },
    proxy_fetch: async (a) => {
      const req = a.request as { url: string; method?: string; headers?: [string, string][]; body?: string };
      const res = await fetch(req.url, {
        method: req.method ?? 'GET',
        headers: req.headers,
        body: req.body
      });
      const text = await res.text();
      return {
        ok: res.ok,
        status: res.status,
        headers: [...res.headers.entries()] as [string, string][],
        text
      };
    },
    fetch_registry: async (a) => (await fetch(a.url as string)).text(),
    download_module: async (a) => (await fetch(a.url as string)).text(),

    // Kanban
    get_kanban_snapshot: () => store.kanban,
    create_kanban_lane: (a) => {
      const lane = {
        id: id('lane'),
        position: store.kanban.lanes.length,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        ...(a.draft as Dict)
      };
      store.kanban.lanes.push(lane);
      persist();
      return lane;
    },
    update_kanban_lane: (a) => {
      let updated: Dict | undefined;
      store.kanban.lanes = store.kanban.lanes.map((l) =>
        l.id === a.id ? (updated = { ...l, ...(a.draft as Dict), updatedAt: nowIso() }) : l
      );
      persist();
      return updated;
    },
    delete_kanban_lane: (a) => {
      store.kanban.lanes = store.kanban.lanes.filter((l) => l.id !== a.id);
      store.kanban.cards = store.kanban.cards.filter((c) => c.laneId !== a.id);
      persist();
    },
    reorder_kanban_lanes: (a) => {
      const order = a.orderedIds as string[];
      store.kanban.lanes = store.kanban.lanes.map((l) => ({
        ...l,
        position: order.indexOf(l.id as string)
      }));
      persist();
      return store.kanban.lanes;
    },
    create_kanban_card: (a) => {
      const draft = a.draft as Dict;
      const laneId = draft.laneId as string;
      const position = store.kanban.cards.filter((c) => c.laneId === laneId).length;
      const card = { id: id('card'), position, createdAt: nowIso(), updatedAt: nowIso(), ...draft };
      store.kanban.cards.push(card);
      persist();
      return card;
    },
    update_kanban_card: (a) => {
      let updated: Dict | undefined;
      store.kanban.cards = store.kanban.cards.map((c) =>
        c.id === a.id ? (updated = { ...c, ...(a.draft as Dict), updatedAt: nowIso() }) : c
      );
      persist();
      return updated;
    },
    delete_kanban_card: (a) => {
      store.kanban.cards = store.kanban.cards.filter((c) => c.id !== a.id);
      persist();
    },
    move_kanban_card: (a) => {
      const cardId = a.id as string;
      const targetLaneId = a.targetLaneId as string;
      const targetIndex = a.targetIndex as number;
      const card = store.kanban.cards.find((c) => c.id === cardId);
      if (!card) return;
      const rest = store.kanban.cards
        .filter((c) => c.laneId === targetLaneId && c.id !== cardId)
        .sort((x, y) => Number(x.position) - Number(y.position));
      rest.splice(targetIndex, 0, { ...card, laneId: targetLaneId });
      const repositioned = new Map(rest.map((c, index) => [c.id, index]));
      store.kanban.cards = store.kanban.cards.map((c) => {
        if (c.id === cardId) return { ...c, laneId: targetLaneId, position: repositioned.get(cardId) ?? 0, updatedAt: nowIso() };
        if (repositioned.has(c.id as string)) return { ...c, position: repositioned.get(c.id as string)! };
        return c;
      });
      persist();
    },
    create_kanban_priority: (a) => {
      const priority = {
        id: id('prio'),
        position: store.kanban.priorities.length,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        ...(a.draft as Dict)
      };
      store.kanban.priorities.push(priority);
      persist();
      return priority;
    },
    update_kanban_priority: (a) => {
      let updated: Dict | undefined;
      store.kanban.priorities = store.kanban.priorities.map((p) =>
        p.id === a.id ? (updated = { ...p, ...(a.draft as Dict), updatedAt: nowIso() }) : p
      );
      persist();
      return updated;
    },
    delete_kanban_priority: (a) => {
      store.kanban.priorities = store.kanban.priorities.filter((p) => p.id !== a.id);
      store.kanban.cards = store.kanban.cards.map((c) =>
        c.priorityId === a.id ? { ...c, priorityId: null } : c
      );
      persist();
    },
    reorder_kanban_priorities: (a) => {
      const order = a.orderedIds as string[];
      store.kanban.priorities = store.kanban.priorities.map((p) => ({
        ...p,
        position: order.indexOf(p.id as string)
      }));
      persist();
      return store.kanban.priorities;
    },
    create_kanban_tag: (a) => {
      const tag = { id: id('tag'), createdAt: nowIso(), updatedAt: nowIso(), ...(a.draft as Dict) };
      store.kanban.tags.push(tag);
      persist();
      return tag;
    },
    update_kanban_tag: (a) => {
      let updated: Dict | undefined;
      store.kanban.tags = store.kanban.tags.map((tg) =>
        tg.id === a.id ? (updated = { ...tg, ...(a.draft as Dict), updatedAt: nowIso() }) : tg
      );
      persist();
      return updated;
    },
    delete_kanban_tag: (a) => {
      store.kanban.tags = store.kanban.tags.filter((tg) => tg.id !== a.id);
      store.kanban.cards = store.kanban.cards.map((c) => ({
        ...c,
        tagIds: Array.isArray(c.tagIds) ? (c.tagIds as string[]).filter((t) => t !== a.id) : c.tagIds
      }));
      persist();
    },
    create_kanban_collaborator: (a) => {
      const collaborator = { id: id('collab'), createdAt: nowIso(), updatedAt: nowIso(), ...(a.draft as Dict) };
      store.kanban.collaborators.push(collaborator);
      persist();
      return collaborator;
    },
    update_kanban_collaborator: (a) => {
      let updated: Dict | undefined;
      store.kanban.collaborators = store.kanban.collaborators.map((c) =>
        c.id === a.id ? (updated = { ...c, ...(a.draft as Dict), updatedAt: nowIso() }) : c
      );
      persist();
      return updated;
    },
    delete_kanban_collaborator: (a) => {
      store.kanban.collaborators = store.kanban.collaborators.filter((c) => c.id !== a.id);
      store.kanban.cards = store.kanban.cards.map((c) => ({
        ...c,
        collaboratorIds: Array.isArray(c.collaboratorIds)
          ? (c.collaboratorIds as string[]).filter((id) => id !== a.id)
          : c.collaboratorIds
      }));
      persist();
    },

    // Window mode & shell — no desktop window to switch in the browser.
    enter_wallpaper_mode: () => 'ok',
    enter_foreground_mode: () => 'ok',

    // Open external links in a new browser tab; the desktop app defers to the OS.
    open_external: (a) => {
      const target = a.target as string;
      if (typeof window !== 'undefined' && /^(https?:|mailto:)/i.test(target)) {
        window.open(target, '_blank', 'noopener,noreferrer');
      }
    }
  };

  const invoke = async (command: string, args: Dict = {}) => {
    // The event plugin (`@tauri-apps/api/event` listen/emit) routes through
    // invoke. There is no OS event bus in the browser, so accept and ignore
    // these so `listen(...)` resolves to a no-op unlisten instead of throwing.
    if (command.startsWith('plugin:event|')) {
      return command.endsWith('|listen') ? Math.floor(Math.random() * 2 ** 32) : undefined;
    }
    const handler = handlers[command];
    if (!handler) {
      throw { code: 'system_error', message: `Unsupported command in browser fallback: ${command}` };
    }
    return handler(args);
  };

  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: {
      invoke,
      transformCallback: (callback: (payload: unknown) => void) => {
        const callbackId = Math.floor(Math.random() * 2 ** 32);
        Reflect.set(window, `_${callbackId}`, callback);
        return callbackId;
      }
    }
  });
}
