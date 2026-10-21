import { t } from '../i18n';

type AppearanceKey = 'appearance' | 'details' | 'layout' | 'layout.horizontal' | 'layout.stacked' | 'layout.date' | 'fontMode' | 'fontMode.auto' | 'fontMode.manual' | 'fontSize' | 'newClock' | 'invalidZone';

export function appearanceText(key: AppearanceKey) {
  return t(`time.appearance.${key}`);
}
