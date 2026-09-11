import type {
  CalendarEvent,
  EditScope,
  EventDraft,
  EventRange,
  EventTarget
} from '../calendar/calendar-model';
import type { CalendarSubscription, ExternalEvent, OAuthAccount, RemoteCalendar, SubscriptionDraft } from '../calendar/subscription-model';
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
import type { Attachment } from '../lib/attachment';
import type { Note, NoteDraft } from '../notes/notes-model';
import type {
  Task as WorkspaceTask,
  TaskCollaborator,
  TaskCollaboratorDraft,
  TaskDraft as WorkspaceTaskDraft,
  TaskLane,
  TaskLaneDraft,
  TaskTag,
  TaskTagDraft,
  TaskView,
  TaskViewPreferences,
  TaskWorkspaceSnapshot
} from '../tasks/task-model';
import type { HexColor } from '../lib/color';
import type { IconStyle } from '../components/icon-style';

export type AppSettings = {
  wallpaperEnabled: boolean;
  launchAtLogin: boolean;
  targetMonitorId: string | null;
  density: 'compact' | 'balanced' | 'comfortable';
  weekStart: 'monday' | 'sunday';
  dateFormat: 'localized' | 'iso';
  showWeekends: boolean;
  // Icon drawing style shared by every icon in the app.
  iconStyle: IconStyle;
  // Hide the topbar while running as the desktop wallpaper. Defaults on, so the
  // wallpaper reads as a clean dashboard; the topbar returns the moment the app
  // is brought back to the foreground.
  hideTopbarInWallpaper: boolean;
  quickPanelEnabled?: boolean;
  quickPanelShortcut?: string;
  recentColors?: HexColor[];
};

export type ModuleLayoutEntry = { id: string; x: number; y: number; w: number; h: number };

// A work-in-progress module file discovered under the app's dev-modules/
// directory. The desktop backend reads %APPDATA%/com.nowly.app/dev-modules/*.js
// at runtime so the in-app workbench (preview channel A) can render drafts that an
// AI tool wrote to a machine-stable path. `source` is the raw file text; the
// full path stays on the backend.
export type DevModuleFile = { name: string; source: string };

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

// The result of a software update check against the public GitHub releases.
// `latestVersion`, `releaseNotes`, and `publishedAt` are absent when GitHub
// could not be reached; the dialog then just shows the current version.
export type UpdateInfo = {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseNotes: string | null;
  releaseUrl: string;
  publishedAt: string | null;
};

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
  refreshCalendarSubscription: (id: string) => Promise<void>;
  // OAuth 日历（Google / Outlook·Teams）。
  startOAuthLogin: (provider: 'google' | 'microsoft') => Promise<OAuthAccount>;
  listOAuthAccounts: () => Promise<OAuthAccount[]>;
  disconnectOAuthAccount: (id: string) => Promise<void>;
  listRemoteCalendars: (accountId: string) => Promise<RemoteCalendar[]>;
  subscribeRemoteCalendar: (
    accountId: string,
    remoteCalendarId: string,
    name: string,
    color: string,
    refreshIntervalMinutes: number
  ) => Promise<CalendarSubscription>;
  updateSubscriptionDisplay: (
    id: string,
    name: string,
    color: string,
    refreshIntervalMinutes: number
  ) => Promise<CalendarSubscription>;
  listExternalEventsInRange: (range: EventRange) => Promise<ExternalEvent[]>;
  createRemoteEvent?(subscriptionId: string, draft: EventDraft): Promise<void>;
  updateRemoteEvent?(
    subscriptionId: string,
    remoteEventId: string,
    draft: EventDraft,
    descriptionChanged: boolean
  ): Promise<void>;
  deleteRemoteEvent?(subscriptionId: string, remoteEventId: string): Promise<void>;
  listTasks(): Promise<MatrixTask[]>;
  createTask(draft: TaskDraft): Promise<MatrixTask>;
  updateTask(id: string, draft: TaskDraft): Promise<MatrixTask>;
  deleteTask(id: string): Promise<void>;
  setTaskCompleted(id: string, completed: boolean): Promise<MatrixTask>;
  // Unified task workspace. Optional during the frontend migration so focused
  // feature-test repositories that still exercise the legacy adapters remain
  // lightweight; the desktop repository implements the complete contract.
  getTaskWorkspaceSnapshot?(): Promise<TaskWorkspaceSnapshot>;
  createWorkspaceTask?(originView: TaskView, draft: WorkspaceTaskDraft): Promise<WorkspaceTask>;
  updateWorkspaceTask?(id: string, draft: WorkspaceTaskDraft): Promise<WorkspaceTask>;
  deleteWorkspaceTask?(id: string): Promise<void>;
  setWorkspaceTaskCompleted?(id: string, completed: boolean): Promise<WorkspaceTask>;
  moveTaskToLane?(id: string, laneId: string, targetIndex: number): Promise<WorkspaceTask>;
  moveTaskToPriority?(id: string, priority: WorkspaceTask['priority']): Promise<WorkspaceTask>;
  moveTaskToDate?(id: string, dueDate: string | null): Promise<WorkspaceTask>;
  setTaskViewMemberships?(id: string, views: TaskView[]): Promise<WorkspaceTask>;
  setTaskViewLinking?(enabled: boolean): Promise<TaskWorkspaceSnapshot>;
  createTaskLane?(draft: TaskLaneDraft): Promise<TaskLane>;
  updateTaskLane?(id: string, draft: TaskLaneDraft): Promise<TaskLane>;
  deleteTaskLane?(id: string, replacementLaneId?: string | null): Promise<TaskWorkspaceSnapshot>;
  reorderTaskLanes?(orderedIds: string[]): Promise<TaskLane[]>;
  setDefaultTaskLane?(id: string): Promise<TaskWorkspaceSnapshot>;
  setCompletionTaskLane?(id: string): Promise<TaskWorkspaceSnapshot>;
  createTaskTag?(draft: TaskTagDraft): Promise<TaskTag>;
  updateTaskTag?(id: string, draft: TaskTagDraft): Promise<TaskTag>;
  archiveTaskTag?(id: string, archived: boolean): Promise<TaskTag>;
  deleteTaskTag?(id: string): Promise<void>;
  createTaskCollaborator?(draft: TaskCollaboratorDraft): Promise<TaskCollaborator>;
  updateTaskCollaborator?(id: string, draft: TaskCollaboratorDraft): Promise<TaskCollaborator>;
  archiveTaskCollaborator?(id: string, archived: boolean): Promise<TaskCollaborator>;
  deleteTaskCollaborator?(id: string): Promise<void>;
  setTaskViewPreferences?(preferences: TaskViewPreferences): Promise<TaskWorkspaceSnapshot>;
  listNotes(): Promise<Note[]>;
  createNote(draft: NoteDraft): Promise<Note>;
  updateNote(id: string, draft: NoteDraft): Promise<Note>;
  deleteNote(id: string): Promise<void>;
  // Rich text attachments. Optional so lightweight test doubles need not
  // implement them; the editor degrades to text-only when they are absent.
  //
  // Files are written to `<app-data>/attachments/` and referenced from stored
  // Markdown as `attachment:<id>`. There is no delete method on purpose:
  // removing an image from the text is just a text edit, and the backend
  // reclaims unreferenced files at startup, so cancelling a dialog can never
  // orphan a file that the content still points at.
  saveAttachment?(fileName: string, bytes: Uint8Array): Promise<Attachment>;
  readAttachment?(id: string): Promise<Uint8Array>;
  listAttachments?(ids: string[]): Promise<Attachment[]>;
  /**
   * Hand one attachment to the OS to open in its default application.
   *
   * The desktop backend opens the stored file in place, so an edit saved from
   * that application stays with the note. Rejects for a file type the OS would
   * execute rather than open.
   */
  openAttachment?(id: string): Promise<void>;
  getSettings(): Promise<AppSettings>;
  // Check GitHub for a newer release. Optional so lightweight test doubles and
  // the browser dev shim need not implement it.
  checkForUpdate?(): Promise<UpdateInfo>;
  updateSettings(settings: AppSettings): Promise<AppSettings>;
  listMonitors(): Promise<MonitorInfo[]>;
  listModuleLayout(): Promise<ModuleLayoutEntry[]>;
  saveModuleLayout(layout: ModuleLayoutEntry[]): Promise<ModuleLayoutEntry[]>;
  // List the draft module files under the app's dev-modules/ directory. Optional
  // so lightweight test doubles need not implement it; the workbench treats a
  // missing method as "no drafts".
  listDevModules?(): Promise<DevModuleFile[]>;
  // Absolute path of the app-data dev-modules/ directory, resolved on the
  // backend (OS-specific) and shown in the workbench empty state. Optional for
  // the same reason as listDevModules.
  devModulesDir?(): Promise<string>;
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
