import { X } from 'lucide-react';
import { type RefObject, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { Select } from '../components/Select';
import { TabPanel, Tabs, type TabItem } from '../components/Tabs';
import { SubscriptionManagerPanel } from './SubscriptionManagerPanel';
import type { CalendarSubscription, SubscriptionDraft } from './subscription-model';
import type { AppSettings } from '../data/nowly-repository';
import { t } from '../i18n';

export type CalendarSettings = Pick<AppSettings, 'weekStart' | 'dateFormat' | 'showWeekends'>;

type CalendarSettingsTab = 'basic' | 'subscriptions';

type Props = {
  settings: CalendarSettings;
  onChange: (settings: CalendarSettings) => void;
  onClose: () => void;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  subscriptions: CalendarSubscription[];
  onSubscriptionsChanged: () => void;
  createSubscription: (draft: SubscriptionDraft) => Promise<CalendarSubscription>;
  updateSubscription: (id: string, draft: SubscriptionDraft) => Promise<CalendarSubscription>;
  deleteSubscription: (id: string) => Promise<void>;
  refreshSubscription: (id: string) => Promise<void>;
};

// Calendar-scoped preferences and calendar sources share one dialog, split into
// the same underline tabs the app settings use. Basic changes persist through
// onChange immediately; there is no separate save step.
export function CalendarSettingsDialog({
  settings,
  onChange,
  onClose,
  restoreFocusRef,
  subscriptions,
  onSubscriptionsChanged,
  createSubscription,
  updateSubscription,
  deleteSubscription,
  refreshSubscription
}: Props) {
  const [tab, setTab] = useState<CalendarSettingsTab>('basic');
  const [overlayOpen, setOverlayOpen] = useState(false);

  const tabs: TabItem<CalendarSettingsTab>[] = [
    { id: 'basic', label: t('calendarSettings.basic') },
    { id: 'subscriptions', label: t('subscription.title'), count: subscriptions.length }
  ];

  return (
    <Dialog
      title={t('calendarSettings.label')}
      ariaLabelledBy="calendar-settings-title"
      isTopLayer={!overlayOpen}
      restoreFocusRef={restoreFocusRef}
      onRequestClose={onClose}
      className="calendar-settings-dialog"
      headerActions={
        <button type="button" className="good-icon-button" aria-label={t('common.close')} onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      }
    >
      <div className="calendar-settings">
        <Tabs
          idPrefix="calendar-settings"
          label={t('calendarSettings.label')}
          items={tabs}
          value={tab}
          onChange={setTab}
        />
        <TabPanel idPrefix="calendar-settings" tabId="basic" active={tab === 'basic'}>
          <div className="calendar-settings__grid">
            <Select
              id="calendar-week-start"
              label={t('calendarSettings.weekStart')}
              value={settings.weekStart}
              options={[{ value: 'monday', label: t('calendarSettings.monday') }, { value: 'sunday', label: t('calendarSettings.sunday') }]}
              onChange={(value) => onChange({ ...settings, weekStart: value as AppSettings['weekStart'] })}
            />
            <Select
              id="calendar-date-format"
              label={t('calendarSettings.dateFormat')}
              value={settings.dateFormat}
              options={[{ value: 'localized', label: t('calendarSettings.localized') }, { value: 'iso', label: t('calendarSettings.iso') }]}
              onChange={(value) => onChange({ ...settings, dateFormat: value as AppSettings['dateFormat'] })}
            />
          </div>
          <div className="calendar-settings__checks">
            <label className="form-check form-check-custom form-check-solid">
              <input
                className="form-check-input"
                type="checkbox"
                checked={settings.showWeekends}
                onChange={(event) => onChange({ ...settings, showWeekends: event.target.checked })}
              />
              <span className="form-check-label">{t('calendarSettings.showWeekends')}</span>
            </label>
          </div>
        </TabPanel>
        <TabPanel idPrefix="calendar-settings" tabId="subscriptions" active={tab === 'subscriptions'}>
          <SubscriptionManagerPanel
            subscriptions={subscriptions}
            onChanged={onSubscriptionsChanged}
            onCreate={createSubscription}
            onUpdate={updateSubscription}
            onDelete={deleteSubscription}
            onRefresh={refreshSubscription}
            onOverlayOpenChange={setOverlayOpen}
          />
        </TabPanel>
      </div>
    </Dialog>
  );
}
