import { invoke } from '@tauri-apps/api/core';
import type { AssistantClient } from './types';

// No browser-side credentials, direct model traffic, or generated-code execution.
export const assistantClient: AssistantClient = {
  getConfig: () => invoke('assistant_get_config'),
  saveConfig: (config, apiKey, clearKey) => invoke('assistant_save_config', { config, apiKey, clearKey }),
  interpret: request => invoke('assistant_interpret', { request }),
  cancelRequest: requestId => invoke('assistant_cancel_request', { requestId }),
  revise: (planId, actions) => invoke('assistant_revise', { planId, actions }),
  cancelPlan: planId => invoke('assistant_cancel_plan', { planId }),
  execute: planId => invoke('assistant_execute', { planId }),
  undo: planId => invoke('assistant_undo', { planId }),
  history: () => invoke('assistant_history'),
  status: planId => invoke('assistant_status', { planId })
};
export function assistantError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return typeof error === 'string' ? error : '操作未能完成，请检查连接后重试。';
}
