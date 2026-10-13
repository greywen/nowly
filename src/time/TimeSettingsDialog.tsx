import { type RefObject, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../i18n';
import { X } from '../components/icons';
import { Dialog } from '../components/Dialog';
import { TabPanel, Tabs, type TabItem } from '../components/Tabs';
import { autosaveText } from './time-autosave-translations';
import { TimeComparisonPanel } from './TimeComparisonPanel';
import { AlarmSettingsPanel } from './AlarmSettingsPanel';
import { useTimeSettings } from './useTimeSettings';
import { WorldClockSettings } from './WorldClockSettings';
import { tt } from './time-translations';
import './time.css';

type TimeTab = 'clocks' | 'compare' | 'alarms';

type Props = {
  onClose: () => void;
  trigger?: HTMLElement | null;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  createAlarm?: boolean;
};

export function TimeSettingsDialog({ onClose, trigger, restoreFocusRef, createAlarm = false }: Props) {
  useTranslation();
  const focusRestore = useMemo(() => restoreFocusRef ?? (trigger ? { current: trigger } : undefined), [restoreFocusRef, trigger]);
  const { state, load, save, retry, flush, writeError, saveStatus } = useTimeSettings();
  useEffect(() => () => flush(), [flush]);
  const draft = state.data;
  const [tab, setTab] = useState<TimeTab>(createAlarm ? 'alarms' : 'clocks');
  const [alarmCount, setAlarmCount] = useState(0);
  const settingsReady = state.status === 'ready';

  const tabs: TabItem<TimeTab>[] = [
    { id: 'clocks', label: tt('time.tabs.clocks') },
    { id: 'compare', label: tt('time.tabs.compare') },
    { id: 'alarms', label: `${tt('time.tabs.alarms')}(${alarmCount})` }
  ];

  return (
    <Dialog
      title={tt('time.title')}
      ariaLabelledBy="time-settings-title"
      restoreFocusRef={focusRestore}
      onRequestClose={onClose}
      className="time-settings-dialog"
      headerActions={
        <button type="button" className="good-icon-button" aria-label={tt('time.close')} onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      }
      footer={
        tab === 'clocks' ? (
          <div className="time-dialog-footer">
            <span role="status" aria-live="polite" className={writeError ? 'time-error' : 'time-muted'}>
              {writeError ? `${autosaveText('error')}: ${writeError}` : saveStatus === 'saving' ? autosaveText('saving') : saveStatus === 'saved' ? tt('time.saved') : autosaveText('idle')}
            </span>
            {writeError ? <button type="button" className="time-action-button" onClick={retry}>{tt('time.retry')}</button> : null}
          </div>
        ) : null
      }
    >
      <div className="time-settings" data-testid="time-settings-dialog">
        {state.status === 'loading' ? <p className="time-muted">{tt('time.loading')}</p> : null}
        {state.status === 'error' ? (
          <div className="time-load-error">
            <p className="time-error">{state.error || tt('time.loadError')}</p>
            <button type="button" className="time-action-button" onClick={() => void load()}>{tt('time.retry')}</button>
          </div>
        ) : null}
        <Tabs idPrefix="time-settings" label={tt('time.title')} items={tabs} value={tab} onChange={setTab} />
        <TabPanel idPrefix="time-settings" tabId="clocks" active={tab === 'clocks'}>
          {settingsReady ? <WorldClockSettings settings={draft} onChange={save} /> : null}
        </TabPanel>
        <TabPanel idPrefix="time-settings" tabId="compare" active={tab === 'compare'}>
          {settingsReady ? <TimeComparisonPanel settings={draft} /> : null}
        </TabPanel>
        <TabPanel idPrefix="time-settings" tabId="alarms" active={tab === 'alarms'}>
          <AlarmSettingsPanel onCountChange={setAlarmCount} createAlarm={createAlarm} />
        </TabPanel>
      </div>
    </Dialog>
  );
}
