import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Select } from '../components/Select';
import { useTranslation } from '../i18n';
import { holdKeyLabel } from '../voice/voice-model';
import {
  MODEL_PROGRESS_EVENT, formatMegabytes, holdPart, holdSpec, voiceSettingsClient,
  type VoiceModelProgress, type VoiceModelStatus, type VoiceSettings, type VoiceSettingsClient
} from '../voice/voice-settings';
import { normalizeShortcut } from './ShortcutRecorder';
import './shortcut-settings.css';
import './voice-settings.css';

type Props = {
  /** Global shortcuts already bound; a hold key with a regular key must not reuse one. */
  takenShortcuts?: readonly string[];
  /** Each new value scrolls the group into view and focuses it, for the Bar's 「去设置」. */
  focusRequest?: number;
  client?: VoiceSettingsClient;
  /** Reports whether hold to talk is on and its model installed, once both are known. */
  onStatusChange?(ready: boolean): void;
};

function errorField(reason: unknown) {
  return typeof reason === 'object' && reason !== null && 'field' in reason ? String(reason.field) : '';
}

export function VoiceSettingsPanel({ takenShortcuts = [], focusRequest, client = voiceSettingsClient, onStatusChange }: Props) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<VoiceSettings | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [devices, setDevices] = useState<string[]>([]);
  const [model, setModel] = useState<VoiceModelStatus | null>(null);
  const [progress, setProgress] = useState<VoiceModelProgress | null>(null);
  const [error, setError] = useState('');
  const [modelError, setModelError] = useState('');
  const [task, setTask] = useState<'download' | 'delete' | null>(null);
  const [modelChecked, setModelChecked] = useState(false);
  const group = useRef<HTMLFieldSetElement>(null);
  const ready = settings !== null;
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const report = useRef(onStatusChange);
  report.current = onStatusChange;

  useEffect(() => {
    let alive = true;
    void client.get().then(value => { if (alive) setSettings(value); })
      .catch(() => { if (alive) setUnavailable(true); });
    void client.devices().then(value => { if (alive) setDevices(value); }).catch(() => {});
    void client.modelStatus().then(value => { if (alive) setModel(value); }).catch(() => {})
      .finally(() => { if (alive) setModelChecked(true); });
    const stop = listen<VoiceModelProgress>(MODEL_PROGRESS_EVENT, event => { if (alive) setProgress(event.payload); })
      .catch(() => null);
    return () => { alive = false; void stop.then(remove => remove?.()); };
  }, [client]);

  const voiceReady = unavailable ? false : settings === null || !modelChecked ? null : settings.enabled && Boolean(model?.installed);
  useEffect(() => { if (voiceReady !== null) report.current?.(voiceReady); }, [voiceReady]);

  useEffect(() => {
    if (focusRequest === undefined || !ready) return;
    group.current?.scrollIntoView?.({ block: 'start' });
    group.current?.focus({ preventScroll: true });
  }, [focusRequest, ready]);

  function update(patch: Partial<VoiceSettings>) {
    if (!settings) return;
    const previous = settings;
    const next = { ...settings, ...patch };
    setSettings(next);
    setError('');
    // Saves run in order so a quick toggle-then-select cannot land out of order.
    saving.current = saving.current.then(() => client.save(next)).then(
      saved => setSettings(current => current === next ? saved : current),
      reason => {
        setSettings(current => current === next ? previous : current);
        setError(errorField(reason) === 'holdKey' ? t('settings.voiceHoldKeyRejected') : t('settings.voiceSaveError'));
      });
  }

  async function download() {
    setTask('download'); setModelError(''); setProgress(null);
    try { setModel(await client.download()); }
    catch (reason) {
      // Cancelling reports a conflict; that is the user's choice, not a failure.
      if (!(typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === 'conflict')) setModelError(t('settings.voiceModelDownloadError'));
    }
    finally { setTask(null); setProgress(null); }
  }

  async function remove() {
    setTask('delete'); setModelError('');
    try { setModel(await client.deleteModel()); }
    catch { setModelError(t('settings.voiceModelDeleteError')); }
    finally { setTask(null); }
  }

  if (unavailable) return <p className="voice-settings__note" role="status">{t('settings.voiceUnavailable')}</p>;
  const downloading = task === 'download';
  const percent = progress && progress.total > 0 ? Math.min(100, Math.floor(progress.done / progress.total * 100)) : 0;
  const deviceOptions = [
    { value: '', label: t('settings.voiceDeviceDefault') },
    ...devices.map(name => ({ value: name, label: name })),
    ...(settings?.device && !devices.includes(settings.device) ? [{ value: settings.device, label: t('settings.voiceDeviceMissing', { name: settings.device }) }] : [])
  ];

  return <fieldset ref={group} id="settings-ai-voice" tabIndex={-1} className="settings-section voice-settings" aria-busy={!ready}>
    <legend>{t('settings.voiceTitle')}</legend>
    <label className="form-check form-check-custom form-check-solid">
      <input className="form-check-input" type="checkbox" checked={settings?.enabled ?? false} disabled={!ready}
        onChange={event => update({ enabled: event.target.checked })} />
      <span className="form-check-label">{t('settings.voiceEnabled')}</span>
    </label>
    <HoldKeyRecorder value={settings?.holdKey ?? ''} disabled={!settings?.enabled} takenShortcuts={takenShortcuts}
      recording={recording => void client.recording(recording).catch(() => {})}
      onChange={holdKey => update({ holdKey })} />
    <div className="voice-settings__grid">
      <Select id="settings-voice-device" label={t('settings.voiceDevice')} value={settings?.device ?? ''} options={deviceOptions}
        disabled={!settings?.enabled} onChange={value => update({ device: value || null })} />
      <Select id="settings-voice-language" label={t('settings.voiceLanguage')} value={settings?.language ?? 'auto'} disabled={!settings?.enabled}
        options={[
          { value: 'auto', label: t('settings.voiceLanguageAuto') },
          { value: 'zh', label: t('settings.voiceLanguageZh') },
          { value: 'en', label: t('settings.voiceLanguageEn') }
        ]}
        onChange={value => update({ language: value as VoiceSettings['language'] })} />
    </div>
    {error && <p className="dialog-error" role="alert">{error}</p>}
    <div className="voice-settings__model">
      <div className="voice-settings__model-text">
        <span className="voice-settings__model-name">{t('settings.voiceModel')}</span>
        <span className="voice-settings__note" role="status">
          {downloading ? t('settings.voiceModelDownloading', { percent })
            : model?.installed ? t('settings.voiceModelInstalled', { size: formatMegabytes(model.totalBytes) })
            : model ? t('settings.voiceModelMissing', { size: formatMegabytes(model.totalBytes) })
            : t('settings.voiceModelChecking')}
        </span>
      </div>
      {downloading
        ? <button type="button" className="good-button" onClick={() => void client.cancelDownload().catch(() => {})}>{t('common.cancel')}</button>
        : model?.installed
          ? <button type="button" className="good-button" disabled={task !== null} onClick={() => void remove()}>{t('settings.voiceModelDelete')}</button>
          : <button type="button" className="good-button good-button--primary" disabled={task !== null || !model} onClick={() => void download()}>{t('settings.voiceModelDownload')}</button>}
    </div>
    {downloading && <div className="voice-settings__progress" role="progressbar" aria-label={t('settings.voiceModel')}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <span style={{ width: `${percent}%` }} />
    </div>}
    {modelError && <p className="dialog-error" role="alert">{modelError}</p>}
    <p className="settings-section__note">{t('settings.voicePrivacy')}</p>
  </fieldset>;
}

type RecorderProps = {
  value: string;
  disabled: boolean;
  takenShortcuts: readonly string[];
  recording(recording: boolean): void;
  onChange(value: string): void;
};

/**
 * Records a hold: every key pressed together counts, and the combination is
 * taken when the first of them is released, so modifier-only holds such as
 * Ctrl+Win can be recorded.
 */
function HoldKeyRecorder({ value, disabled, takenShortcuts, recording, onChange }: RecorderProps) {
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const [active, setActive] = useState(false);
  const held = useRef(new Set<string>());
  const peak = useRef(new Set<string>());
  const report = useRef(recording);
  report.current = recording;
  // While recording, neither the current hold nor the global shortcuts may fire.
  useEffect(() => {
    if (!active) return;
    report.current(true);
    void invoke('screenshot_shortcut_recording', { recording: true }).catch(() => {});
    return () => {
      report.current(false);
      void invoke('screenshot_shortcut_recording', { recording: false }).catch(() => {});
    };
  }, [active]);

  function reset() { held.current.clear(); peak.current.clear(); }
  function down(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();
    if (event.key === 'Tab' && held.current.size === 0) return;
    event.preventDefault();
    if (event.key === 'Escape') { reset(); setError(''); event.currentTarget.blur(); return; }
    if (event.repeat) return;
    const part = holdPart(event);
    if (!part) { setError(t('settings.voiceHoldKeyInvalid')); return; }
    held.current.add(part);
    peak.current.add(part);
  }
  function up(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();
    if (peak.current.size === 0) return;
    event.preventDefault();
    const spec = holdSpec(peak.current);
    reset();
    if (!spec) { setError(t('settings.voiceHoldKeyInvalid')); return; }
    if (takenShortcuts.some(other => normalizeShortcut(other) === spec)) { setError(t('settings.shortcutDuplicate')); return; }
    setError('');
    if (spec !== value) onChange(spec);
  }

  return <div className="shortcut-recorder">
    <label htmlFor="settings-voice-hold-key">{t('settings.voiceHoldKey')}</label>
    <input id="settings-voice-hold-key" readOnly value={holdKeyLabel(value)} disabled={disabled}
      onFocus={() => { reset(); setActive(true); }} onBlur={() => { reset(); setActive(false); }}
      onKeyDown={down} onKeyUp={up} aria-invalid={!!error} aria-describedby={error ? 'settings-voice-hold-key-error' : active ? 'settings-voice-hold-key-hint' : undefined} />
    {error
      ? <p id="settings-voice-hold-key-error" className="dialog-error" role="alert">{error}</p>
      : active && <p id="settings-voice-hold-key-hint" className="voice-settings__note shortcut-recorder__hint" role="status">{t('settings.voiceHoldKeyHint')}</p>}
  </div>;
}
