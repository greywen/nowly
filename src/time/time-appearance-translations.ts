import { getLanguage, type Language } from '../i18n';

type AppearanceKey = 'appearance' | 'details' | 'layout' | 'layout.horizontal' | 'layout.stacked' | 'layout.date' | 'fontMode' | 'fontMode.auto' | 'fontMode.manual' | 'fontSize' | 'newClock' | 'invalidZone';

const translations: Record<Language, Record<AppearanceKey, string>> = {
  zh: {
    appearance: '外观',
    details: '详细设置',
    layout: '布局',
    'layout.horizontal': '横向时间',
    'layout.stacked': '上下排列',
    'layout.date': '时间与日期',
    fontMode: '字号模式',
    'fontMode.auto': '自动适应',
    'fontMode.manual': '手动字号',
    fontSize: '字号（32–160px）',
    newClock: '新时钟',
    invalidZone: '不支持的时区'
  },
  en: {
    appearance: 'Appearance',
    details: 'Details',
    layout: 'Layout',
    'layout.horizontal': 'Horizontal',
    'layout.stacked': 'Stacked',
    'layout.date': 'Time and date',
    fontMode: 'Font size mode',
    'fontMode.auto': 'Auto fit',
    'fontMode.manual': 'Manual',
    fontSize: 'Font size (32–160px)',
    newClock: 'New clock',
    invalidZone: 'Unsupported time zone'
  }
};

export function appearanceText(key: AppearanceKey) {
  return translations[getLanguage()][key];
}
