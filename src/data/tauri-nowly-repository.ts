import { invoke } from '@tauri-apps/api/core';
import type { NowlyRepository } from './nowly-repository';

export const tauriNowlyRepository: NowlyRepository = {
  listEventsInRange: (range) => invoke('list_events_in_range', { range }),
  createEvent: (draft) => invoke('create_event', { draft }),
  updateEvent: (id, draft) => invoke('update_event', { id, draft }),
  deleteEvent: (id) => invoke('delete_event', { id }),
  listTasks: () => invoke('list_tasks'),
  createTask: (draft) => invoke('create_task', { draft }),
  updateTask: (id, draft) => invoke('update_task', { id, draft }),
  deleteTask: (id) => invoke('delete_task', { id }),
  setTaskCompleted: (id, completed) => invoke('set_task_completed', { id, completed }),
  listNotes: () => invoke('list_notes'),
  createNote: (draft) => invoke('create_note', { draft }),
  updateNote: (id, draft) => invoke('update_note', { id, draft }),
  deleteNote: (id) => invoke('delete_note', { id }),
  getSettings: () => invoke('get_app_settings'),
  updateSettings: (settings) => invoke('update_app_settings', { settings })
};
