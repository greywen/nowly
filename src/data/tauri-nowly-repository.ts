import { invoke } from '@tauri-apps/api/core';
import type { NowlyRepository } from './nowly-repository';

export const tauriNowlyRepository: NowlyRepository = {
  listEvents: () => invoke('list_events'),
  listTasks: () => invoke('list_tasks'),
  listNotes: () => invoke('list_notes'),
  getSettings: () => invoke('get_app_settings')
};
