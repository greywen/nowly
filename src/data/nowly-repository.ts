import type {
  CalendarEvent,
  EditScope,
  EventDraft,
  EventRange,
  EventTarget
} from '../calendar/calendar-model';
import type { CalendarSubscription, ExternalEvent, SubscriptionDraft } from '../calendar/subscription-model';
import type {
  KanbanCard,
  KanbanCardDraft,
  KanbanCollaborator,
  KanbanCollaboratorDraft,
  KanbanLane,
  KanbanLaneDraft,
  KanbanPriority,
  KanbanPriorityDraft,
  KanbanSnapshot,
  KanbanTag,
  KanbanTagDraft
} from '../kanban/kanban-model';
import type { MatrixTask, TaskDraft } from '../matrix/matrix-model';
import type { Note, NoteDraft } from '../notes/notes-model';
import type { HexColor } from '../lib/color';

export type AppSettings = {
  wallpaperEnabled: boolean;
  launchAtLogin: boolean;
  targetMonitorId: string | null;
  density: 'compact' | 'balanced' | 'comfortable';
  weekStart: 'monday' | 'sunday';
  dateFormat: 'localized' | 'iso';
  showWeekends: boolean;
  recentColors?: HexColor[];
};

export type ModuleLayoutEntry = { id: string; x: number; y: number; w: number; h: number };

export type FocusSession = {
  id: string;
  plannedSeconds: number;
  focusedSeconds: number;
  status: 'completed' | 'interrupted';
  startedAt: string;
  endedAt: string;
  createdAt: string;
};

export type FocusRange = { startAt: string; endAtExclusive: string };
export type FocusPeriodBoundary = FocusRange & { period: string };
export type FocusStatisticsPoint = {
  period: string;
  focusedSeconds: number;
  completedCount: number;
  interruptedCount: number;
};
export type FocusStatistics = {
  totalFocusedSeconds: number;
  completedCount: number;
  interruptedCount: number;
  completionRate: number;
  points: FocusStatisticsPoint[];
};

// A permission a sandbox extension may declare. Kept in lockstep with the
// backend allow-list so the installer and host agree on the capability surface.
export type SandboxPermission = 'state' | 'today' | 'network';

export type SandboxExtension = {
  id: string;
  name: string;
  description: string;
  source: string;
  permissions: SandboxPermission[];
  // Hosts the module may reach through `host.fetch`. Non-empty only when the
  // `network` permission was granted.
  allowedHosts: string[];
  minW: number;
  minH: number;
  defaultW: number;
  defaultH: number;
  createdAt: string;
  updatedAt: string;
};

export type SandboxExtensionDraft = {
  name: string;
  description: string;
  source: string;
  permissions: SandboxPermission[];
  allowedHosts: string[];
  defaultW: number;
  defaultH: number;
};

// A single proxied network request made on behalf of a sandboxed module. The
// `allowedHosts` list is forwarded so the Rust proxy can re-check it as the
// real trust boundary.
export type ProxyFetchRequest = {
  url: string;
  method?: 'GET' | 'POST';
  headers?: [string, string][];
  body?: string;
  allowedHosts: string[];
};

export type ProxyFetchResponse = {
  ok: boolean;
  status: number;
  headers: [string, string][];
  text: string;
};

export type MonitorInfo = { id:string; name:string; isPrimary:boolean; positionX:number; positionY:number; width:number; height:number; scaleFactor:number };

export type RepositoryError = {
  code: 'validation_error' | 'not_found' | 'conflict' | 'database_error' | 'system_error';
  message: string;
  field?: string;
};

export type NowlyRepository = {
  listEventsInRange(range: EventRange): Promise<CalendarEvent[]>;
  createEvent(draft: EventDraft): Promise<CalendarEvent>;
  updateEvent(target: EventTarget, draft: EventDraft, scope: EditScope): Promise<void>;
  deleteEvent(target: EventTarget, scope: EditScope): Promise<void>;
  listCalendarSubscriptions: () => Promise<CalendarSubscription[]>;
  createCalendarSubscription: (draft: SubscriptionDraft) => Promise<CalendarSubscription>;
  updateCalendarSubscription: (id: string, draft: SubscriptionDraft) => Promise<CalendarSubscription>;
  deleteCalendarSubscription: (id: string) => Promise<void>;
  listExternalEventsInRange: (range: EventRange) => Promise<ExternalEvent[]>;
  listTasks(): Promise<MatrixTask[]>;
  createTask(draft: TaskDraft): Promise<MatrixTask>;
  updateTask(id: string, draft: TaskDraft): Promise<MatrixTask>;
  deleteTask(id: string): Promise<void>;
  setTaskCompleted(id: string, completed: boolean): Promise<MatrixTask>;
  listNotes(): Promise<Note[]>;
  createNote(draft: NoteDraft): Promise<Note>;
  updateNote(id: string, draft: NoteDraft): Promise<Note>;
  deleteNote(id: string): Promise<void>;
  getSettings(): Promise<AppSettings>;
  updateSettings(settings: AppSettings): Promise<AppSettings>;
  listMonitors(): Promise<MonitorInfo[]>;
  listModuleLayout(): Promise<ModuleLayoutEntry[]>;
  saveModuleLayout(layout: ModuleLayoutEntry[]): Promise<ModuleLayoutEntry[]>;
  getModuleState(moduleId: string): Promise<string | null>;
  setModuleState(moduleId: string, state: string): Promise<void>;
  createFocusSession(session: FocusSession): Promise<FocusSession>;
  listFocusSessions(range: FocusRange): Promise<FocusSession[]>;
  getFocusStatistics(boundaries: FocusPeriodBoundary[]): Promise<FocusStatistics>;
  listExtensions(): Promise<SandboxExtension[]>;
  installExtension(draft: SandboxExtensionDraft): Promise<SandboxExtension>;
  uninstallExtension(id: string): Promise<void>;
  // Proxy a module network request through the trusted backend.
  proxyFetch(request: ProxyFetchRequest): Promise<ProxyFetchResponse>;
  // Fetch the raw text of the module market registry index.
  fetchRegistry(url: string): Promise<string>;
  // Download the raw source of a single module from the market.
  downloadModule(url: string): Promise<string>;
  getKanbanSnapshot(): Promise<KanbanSnapshot>;
  createKanbanLane(draft: KanbanLaneDraft): Promise<KanbanLane>;
  updateKanbanLane(id: string, draft: KanbanLaneDraft): Promise<KanbanLane>;
  deleteKanbanLane(id: string): Promise<void>;
  reorderKanbanLanes(orderedIds: string[]): Promise<KanbanLane[]>;
  createKanbanCard(draft: KanbanCardDraft): Promise<KanbanCard>;
  updateKanbanCard(id: string, draft: KanbanCardDraft): Promise<KanbanCard>;
  deleteKanbanCard(id: string): Promise<void>;
  moveKanbanCard(id: string, targetLaneId: string, targetIndex: number): Promise<void>;
  createKanbanPriority(draft: KanbanPriorityDraft): Promise<KanbanPriority>;
  updateKanbanPriority(id: string, draft: KanbanPriorityDraft): Promise<KanbanPriority>;
  deleteKanbanPriority(id: string): Promise<void>;
  reorderKanbanPriorities(orderedIds: string[]): Promise<KanbanPriority[]>;
  createKanbanTag(draft: KanbanTagDraft): Promise<KanbanTag>;
  updateKanbanTag(id: string, draft: KanbanTagDraft): Promise<KanbanTag>;
  deleteKanbanTag(id: string): Promise<void>;
  createKanbanCollaborator(draft: KanbanCollaboratorDraft): Promise<KanbanCollaborator>;
  updateKanbanCollaborator(id: string, draft: KanbanCollaboratorDraft): Promise<KanbanCollaborator>;
  deleteKanbanCollaborator(id: string): Promise<void>;
};
