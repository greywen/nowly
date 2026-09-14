import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import type { NowlyRepository } from './nowly-repository';

function invalidating<T>(operation: Promise<T>): Promise<T> {
  return operation.then(result => {
    void emit('status-island-invalidated').catch(() => undefined);
    return result;
  });
}

export const tauriNowlyRepository: NowlyRepository = {
  listEventsInRange: (range) => invoke('list_events_in_range', { range }),
  createEvent: (draft) => invalidating(invoke('create_event', { draft })),
  updateEvent: (target, draft, scope) => invalidating(invoke('update_event', { target, draft, scope })),
  deleteEvent: (target, scope) => invalidating(invoke('delete_event', { target, scope })),
  listCalendarSubscriptions: () => invoke('list_calendar_subscriptions'),
  createCalendarSubscription: (draft) => invalidating(invoke('create_calendar_subscription', { draft })),
  updateCalendarSubscription: (id, draft) => invalidating(invoke('update_calendar_subscription', { id, draft })),
  deleteCalendarSubscription: (id) => invalidating(invoke('delete_calendar_subscription', { id })),
  refreshCalendarSubscription: (id) => invalidating(invoke('refresh_calendar_subscription', { id })),
  startOAuthLogin: (provider) => invoke('start_oauth_login', { provider }),
  listOAuthAccounts: () => invoke('list_oauth_accounts'),
  disconnectOAuthAccount: (id) => invoke('disconnect_oauth_account', { id }),
  listRemoteCalendars: (accountId) => invoke('list_remote_calendars', { accountId }),
  subscribeRemoteCalendar: (accountId, remoteCalendarId, name, color, refreshIntervalMinutes) =>
    invoke('subscribe_remote_calendar', {
      accountId,
      remoteCalendarId,
      name,
      color,
      refreshIntervalMinutes
    }),
  updateSubscriptionDisplay: (id, name, color, refreshIntervalMinutes) =>
    invoke('update_subscription_display', { id, name, color, refreshIntervalMinutes }),
  listExternalEventsInRange: (range) => invoke('list_external_events_in_range', { range }),
  createRemoteEvent: (subscriptionId, draft) => invalidating(invoke('create_remote_event', { subscriptionId, draft })),
  updateRemoteEvent: (subscriptionId, remoteEventId, draft, descriptionChanged) =>
    invalidating(invoke('update_remote_event', { subscriptionId, remoteEventId, draft, descriptionChanged })),
  deleteRemoteEvent: (subscriptionId, remoteEventId) =>
    invalidating(invoke('delete_remote_event', { subscriptionId, remoteEventId })),
  listTasks: () => invoke('list_tasks'),
  createTask: (draft) => invalidating(invoke('create_task', { draft })),
  updateTask: (id, draft) => invalidating(invoke('update_task', { id, draft })),
  deleteTask: (id) => invalidating(invoke('delete_task', { id })),
  setTaskCompleted: (id, completed) => invalidating(invoke('set_task_completed', { id, completed })),
  getTaskWorkspaceSnapshot: () => invoke('get_task_workspace_snapshot'),
  createWorkspaceTask: (originView, draft) => invalidating(invoke('create_task', { originView, draft })),
  updateWorkspaceTask: (id, draft) => invalidating(invoke('update_task', { id, draft })),
  deleteWorkspaceTask: (id) => invalidating(invoke('delete_task', { id })),
  setWorkspaceTaskCompleted: (id, completed) => invalidating(invoke('set_task_completed', { id, completed })),
  moveTaskToLane: (id, laneId, targetIndex) => invalidating(invoke('move_task_to_lane', { id, laneId, targetIndex })),
  moveTaskToPriority: (id, priority) => invalidating(invoke('move_task_to_priority', { id, priority })),
  moveTaskToDate: (id, dueDate) => invalidating(invoke('move_task_to_date', { id, dueDate })),
  setTaskViewMemberships: (id, views) => invalidating(invoke('set_task_view_memberships', { id, views })),
  setTaskViewLinking: (enabled) => invoke('set_task_view_linking', { enabled }),
  createTaskLane: (draft) => invoke('create_task_lane', { draft }),
  updateTaskLane: (id, draft) => invoke('update_task_lane', { id, draft }),
  deleteTaskLane: (id, replacementLaneId = null) =>
    invoke('delete_task_lane', { id, replacementLaneId }),
  reorderTaskLanes: (orderedIds) => invoke('reorder_task_lanes', { orderedIds }),
  setDefaultTaskLane: (id) => invoke('set_default_task_lane', { id }),
  setCompletionTaskLane: (id) => invoke('set_completion_task_lane', { id }),
  createTaskTag: (draft) => invoke('create_task_tag', { draft }),
  updateTaskTag: (id, draft) => invoke('update_task_tag', { id, draft }),
  archiveTaskTag: (id, archived) => invoke('archive_task_tag', { id, archived }),
  deleteTaskTag: (id) => invoke('delete_task_tag', { id }),
  createTaskCollaborator: (draft) => invoke('create_task_collaborator', { draft }),
  updateTaskCollaborator: (id, draft) => invoke('update_task_collaborator', { id, draft }),
  archiveTaskCollaborator: (id, archived) => invoke('archive_task_collaborator', { id, archived }),
  deleteTaskCollaborator: (id) => invoke('delete_task_collaborator', { id }),
  setTaskViewPreferences: (preferences) => invoke('set_task_view_preferences', { preferences }),
  listNotes: () => invoke('list_notes'),
  createNote: (draft) => invoke('create_note', { draft }),
  updateNote: (id, draft) => invoke('update_note', { id, draft }),
  deleteNote: (id) => invoke('delete_note', { id }),
  // `bytes` must be a plain number array: a Uint8Array nested inside an invoke
  // payload is JSON-serialised as `{"0":1,...}`, which serde cannot read back
  // into a `Vec<u8>`. The reply is likewise a number array.
  saveAttachment: (fileName, bytes) =>
    invoke('save_attachment', { fileName, bytes: Array.from(bytes) }),
  readAttachment: (id) =>
    invoke<number[]>('read_attachment', { id }).then((bytes) => new Uint8Array(bytes)),
  listAttachments: (ids) => invoke('list_attachments', { ids }),
  openAttachment: (id) => invoke('open_attachment', { id }),
  getSettings: () => invoke('get_app_settings'),
  checkForUpdate: () => invoke('check_for_update'),
  updateSettings: (settings) => invoke('update_app_settings', { settings }),
  listMonitors: () => invoke('list_monitors'),
  listDevModules: () => invoke('list_dev_modules'),
  devModulesDir: () => invoke('dev_modules_dir_path'),
  listModuleLayout: () => invoke('list_module_layout'),
  saveModuleLayout: (layout) => invoke('save_module_layout', { layout }),
  getModuleState: (moduleId) => invoke('get_module_state', { moduleId }),
  setModuleState: (moduleId, state) => invoke('set_module_state', { moduleId, state }),
  createFocusSession: (session) => invoke('create_focus_session', { session }),
  listFocusSessions: (range) => invoke('list_focus_sessions', { range }),
  getFocusStatistics: (boundaries) => invoke('get_focus_statistics', { boundaries }),
  listExtensions: () => invoke('list_extensions'),
  installExtension: (draft) => invoke('install_extension', { draft }),
  uninstallExtension: (id) => invoke('uninstall_extension', { id }),
  proxyFetch: (request) => invoke('proxy_fetch', { request }),
  fetchRegistry: (url) => invoke('fetch_registry', { url }),
  downloadModule: (url) => invoke('download_module', { url }),
  getKanbanSnapshot: () => invoke('get_kanban_snapshot'),
  createKanbanLane: (draft) => invoke('create_kanban_lane', { draft }),
  updateKanbanLane: (id, draft) => invoke('update_kanban_lane', { id, draft }),
  deleteKanbanLane: (id) => invoke('delete_kanban_lane', { id }),
  reorderKanbanLanes: (orderedIds) => invoke('reorder_kanban_lanes', { orderedIds }),
  createKanbanCard: (draft) => invoke('create_kanban_card', { draft }),
  updateKanbanCard: (id, draft) => invoke('update_kanban_card', { id, draft }),
  deleteKanbanCard: (id) => invoke('delete_kanban_card', { id }),
  moveKanbanCard: (id, targetLaneId, targetIndex) =>
    invoke('move_kanban_card', { id, targetLaneId, targetIndex }),
  createKanbanPriority: (draft) => invoke('create_kanban_priority', { draft }),
  updateKanbanPriority: (id, draft) => invoke('update_kanban_priority', { id, draft }),
  deleteKanbanPriority: (id) => invoke('delete_kanban_priority', { id }),
  reorderKanbanPriorities: (orderedIds) => invoke('reorder_kanban_priorities', { orderedIds }),
  createKanbanTag: (draft) => invoke('create_kanban_tag', { draft }),
  updateKanbanTag: (id, draft) => invoke('update_kanban_tag', { id, draft }),
  deleteKanbanTag: (id) => invoke('delete_kanban_tag', { id }),
  createKanbanCollaborator: (draft) => invoke('create_kanban_collaborator', { draft }),
  updateKanbanCollaborator: (id, draft) => invoke('update_kanban_collaborator', { id, draft }),
  deleteKanbanCollaborator: (id) => invoke('delete_kanban_collaborator', { id })
};
