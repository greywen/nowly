import { invoke } from '@tauri-apps/api/core';

export type VoiceLanguage = 'auto' | 'zh' | 'en';
export type VoiceSettings = { enabled: boolean; holdKey: string; device: string | null; language: VoiceLanguage };
export type VoiceModelStatus = { installed: boolean; totalBytes: number };
export type VoiceModelProgress = { done: number; total: number };

export const MODEL_PROGRESS_EVENT = 'voice-model-progress';

export const voiceSettingsClient = {
  get: () => invoke<VoiceSettings>('voice_get_settings'),
  save: (settings: VoiceSettings) => invoke<VoiceSettings>('voice_save_settings', { settings }),
  devices: () => invoke<string[]>('voice_input_devices'),
  modelStatus: () => invoke<VoiceModelStatus>('voice_model_status'),
  download: () => invoke<VoiceModelStatus>('voice_model_download'),
  cancelDownload: () => invoke<void>('voice_model_cancel'),
  deleteModel: () => invoke<VoiceModelStatus>('voice_model_delete'),
  recording: (recording: boolean) => invoke<void>('voice_recording_hold_key', { recording })
};
export type VoiceSettingsClient = typeof voiceSettingsClient;

const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Super'] as const;
const MODIFIER_KEYS: Record<string, (typeof MODIFIERS)[number]> = { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Super', OS: 'Super' };

/** The hold-key name of a keyboard event's key, or null for keys a hold cannot use. */
export function holdPart(event: { key: string; code: string }): string | null {
  const modifier = MODIFIER_KEYS[event.key];
  if (modifier) return modifier;
  if (event.code === 'Space') return 'Space';
  const letter = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(event.code);
  if (letter) return letter[1] ?? letter[2];
  return /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(event.code) ? event.code : null;
}

/**
 * Mirrors `HoldSpec::parse`: two or more modifiers, modifiers plus one key,
 * or a lone function key. Returns the canonical text or null.
 */
export function holdSpec(parts: Iterable<string>): string | null {
  const mods = new Set<string>();
  const keys: string[] = [];
  for (const part of parts) (MODIFIERS as readonly string[]).includes(part) ? mods.add(part) : keys.push(part);
  if (keys.length > 1) return null;
  const key = keys[0];
  const valid = key ? mods.size > 0 || /^F\d+$/.test(key) : mods.size >= 2;
  return valid ? [...MODIFIERS.filter(mod => mods.has(mod)), ...(key ? [key] : [])].join('+') : null;
}

export function formatMegabytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;
}
