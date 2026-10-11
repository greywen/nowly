import { t } from '../i18n';
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
export function assistantErrorSource(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return typeof error === 'string' ? error : 'assistant.text93';
}

export function assistantNotice(key: string, detail = ''): string { return JSON.stringify({ assistantNotice: key, detail }); }
export function translateAssistantNotice(source: string): string {
  if (source.startsWith('assistant.')) return t(source);
  try {
    const parsed = JSON.parse(source);
    if (parsed && typeof parsed === 'object' && typeof parsed.assistantNotice === 'string') return t(parsed.assistantNotice) + (parsed.detail ? ' ' + translateAssistantNotice(parsed.detail) : '');
  } catch { /* Native errors are plain text. */ }
  return source;
}
export function assistantError(error: unknown): string { return translateAssistantNotice(assistantErrorSource(error)); }
