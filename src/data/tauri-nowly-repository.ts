import { invoke } from '@tauri-apps/api/core';
import type { NowlyRepository } from './nowly-repository';

export const tauriNowlyRepository: NowlyRepository = {
  listEventsInRange: (range) => invoke('list_events_in_range', { range }),
  createEvent: (draft) => invoke('create_event', { draft }),
  updateEvent: (id, draft) => invoke('update_event', { id, draft }),
  deleteEvent: (id) => invoke('delete_event', { id }),
  listTasks: () => invoke('list_tasks'),
  listNotes: () => invoke('list_notes'),
  getSettings: () => invoke('get_app_settings')
};
