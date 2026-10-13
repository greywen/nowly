import { getLanguage, type Language } from '../i18n';

type TimeTranslationKey =
  | 'time.local'
  | 'time.title'
  | 'time.close'
  | 'time.loading'
  | 'time.loadError'
  | 'time.retry'
  | 'time.save'
  | 'time.saveError'
  | 'time.saved'
  | 'time.tabs.clocks'
  | 'time.tabs.focus'
  | 'time.display.switch'
  | 'time.appearance.title'
  | 'time.appearance.hint'
  | 'time.appearance.info'
  | 'time.appearance.differenceHint'
  | 'time.focus.defaultMinutes'
  | 'time.focus.minutesError'
  | 'time.focus.settingsHint'
  | 'time.focus.running'
  | 'time.focus.paused'
  | 'time.focus.showFocus'
  | 'time.focus.statistics'
  | 'time.tabs.alarms'
  | 'time.clocks.add'
  | 'time.clocks.delete'
  | 'time.clocks.moveUp'
  | 'time.clocks.moveDown'
  | 'time.clocks.label'
  | 'time.clocks.zone'
  | 'time.clocks.mode'
  | 'time.clocks.hourCycle'
  | 'time.clocks.seconds'
  | 'time.clocks.showLabel'
  | 'time.clocks.showDate'
  | 'time.clocks.showDifference'
  | 'time.mode.digital'
  | 'time.mode.analog'
  | 'time.mode.mixed'
  | 'time.hourCycle.h23'
  | 'time.hourCycle.h12'
  | 'time.alarms.add'
  | 'time.alarms.empty'
  | 'time.alarms.title'
  | 'time.alarms.hour'
  | 'time.alarms.minute'
  | 'time.alarms.once'
  | 'time.alarms.daily'
  | 'time.alarms.weekdays'
  | 'time.alarms.custom'
  | 'time.alarms.repeat'
  | 'time.alarms.date'
  | 'time.alarms.enabled'
  | 'time.alarms.enabledState'
  | 'time.alarms.disabledState'
  | 'time.alarms.editLabel'
  | 'time.alarms.deleteLabel'
  | 'time.alarms.save'
  | 'time.alarms.cancel'
  | 'time.alarms.delete'
  | 'time.alarms.confirmDelete'
  | 'time.alarms.minuteError'
  | 'time.alarms.hourError'
  | 'time.alarms.weekdaysError'
  | 'time.alarms.pastError'
  | 'time.alarms.next'
  | 'time.weekday.1'
  | 'time.weekday.2'
  | 'time.weekday.3'
  | 'time.weekday.4'
  | 'time.weekday.5'
  | 'time.weekday.6'
  | 'time.weekday.7';

export const timeTranslations: Record<Language, Record<TimeTranslationKey, string>> = {
  zh: {
    'time.local': '本地',
    'time.title': '时间设置',
    'time.close': '关闭',
    'time.loading': '正在加载时间设置…',
    'time.loadError': '时间设置加载失败',
    'time.retry': '重试',
    'time.save': '保存时间设置',
    'time.saveError': '保存失败',
    'time.saved': '已保存',
    'time.tabs.clocks': '世界时钟',
    'time.tabs.focus': '专注时段',
    'time.display.switch': '切换显示内容',
    'time.appearance.title': '全局显示设置',
    'time.appearance.hint': '以下设置统一应用于所有世界时钟。',
    'time.appearance.info': '附加信息',
    'time.appearance.differenceHint': '时差以电脑本地时区为基准；容器不足时数字字号自动缩小。',
    'time.focus.defaultMinutes': '默认时长（1–720 分钟）',
    'time.focus.minutesError': '请输入 1–720 的整数分钟。',
    'time.focus.settingsHint': '默认时长用于下一次专注，不改变正在运行的时段。开始、暂停与结束在模块正文操作。',
    'time.focus.running': '专注中 · {remaining}',
    'time.focus.paused': '专注已暂停 · {remaining}',
    'time.focus.showFocus': '显示专注时段',
    'time.focus.statistics': '专注统计',
    'time.tabs.alarms': '闹钟',
    'time.clocks.add': '添加时钟',
    'time.clocks.delete': '删除 {label}',
    'time.clocks.moveUp': '上移 {label}',
    'time.clocks.moveDown': '下移 {label}',
    'time.clocks.label': '显示名称',
    'time.clocks.zone': '时区',
    'time.clocks.mode': '显示模式',
    'time.clocks.hourCycle': '小时制',
    'time.clocks.seconds': '显示秒',
    'time.clocks.showLabel': '显示城市',
    'time.clocks.showDate': '显示日期',
    'time.clocks.showDifference': '显示时差',
    'time.mode.digital': '纯时间',
    'time.mode.analog': '纯指针',
    'time.mode.mixed': '混合',
    'time.hourCycle.h23': '24 小时',
    'time.hourCycle.h12': '12 小时',
    'time.alarms.add': '添加闹钟',
    'time.alarms.empty': '还没有闹钟',
    'time.alarms.title': '标题',
    'time.alarms.hour': '小时',
    'time.alarms.minute': '分钟',
    'time.alarms.once': '一次',
    'time.alarms.daily': '每天',
    'time.alarms.weekdays': '工作日',
    'time.alarms.custom': '自选星期',
    'time.alarms.repeat': '重复',
    'time.alarms.date': '日期',
    'time.alarms.enabled': '启用',
    'time.alarms.enabledState': '已启用',
    'time.alarms.disabledState': '已停用',
    'time.alarms.editLabel': '编辑 {title}',
    'time.alarms.deleteLabel': '删除 {title}',
    'time.alarms.save': '保存闹钟',
    'time.alarms.cancel': '取消',
    'time.alarms.delete': '删除',
    'time.alarms.confirmDelete': '确认删除这个闹钟？',
    'time.alarms.minuteError': '分钟必须是 0 到 59',
    'time.alarms.hourError': '小时必须是 0 到 23',
    'time.alarms.weekdaysError': '自选星期不能为空',
    'time.alarms.pastError': '一次性闹钟不能早于当前时间',
    'time.alarms.next': '下次：{value}',
    'time.weekday.1': '周一',
    'time.weekday.2': '周二',
    'time.weekday.3': '周三',
    'time.weekday.4': '周四',
    'time.weekday.5': '周五',
    'time.weekday.6': '周六',
    'time.weekday.7': '周日'
  },
  en: {
    'time.local': 'Local',
    'time.title': 'Time settings',
    'time.close': 'Close',
    'time.loading': 'Loading time settings…',
    'time.loadError': 'Failed to load time settings',
    'time.retry': 'Retry',
    'time.save': 'Save time settings',
    'time.saveError': 'Save failed',
    'time.saved': 'Saved',
    'time.tabs.clocks': 'World clocks',
    'time.tabs.focus': 'Focus sessions',
    'time.display.switch': 'Switch display',
    'time.appearance.title': 'Global display settings',
    'time.appearance.hint': 'These settings apply to all world clocks.',
    'time.appearance.info': 'Additional information',
    'time.appearance.differenceHint': 'Differences use the computer’s local time zone. Digits shrink to fit smaller containers.',
    'time.focus.defaultMinutes': 'Default duration (1–720 minutes)',
    'time.focus.minutesError': 'Enter a whole number from 1 to 720 minutes.',
    'time.focus.settingsHint': 'The default applies to the next session, not a running session. Start, pause and end sessions in the module.',
    'time.focus.running': 'Focusing · {remaining}',
    'time.focus.paused': 'Focus paused · {remaining}',
    'time.focus.showFocus': 'Show focus',
    'time.focus.statistics': 'Focus statistics',
    'time.tabs.alarms': 'Alarms',
    'time.clocks.add': 'Add clock',
    'time.clocks.delete': 'Delete {label}',
    'time.clocks.moveUp': 'Move {label} up',
    'time.clocks.moveDown': 'Move {label} down',
    'time.clocks.label': 'Display name',
    'time.clocks.zone': 'Time zone',
    'time.clocks.mode': 'Display mode',
    'time.clocks.hourCycle': 'Hour cycle',
    'time.clocks.seconds': 'Show seconds',
    'time.clocks.showLabel': 'Show city',
    'time.clocks.showDate': 'Show date',
    'time.clocks.showDifference': 'Show difference',
    'time.mode.digital': 'Digital',
    'time.mode.analog': 'Analog',
    'time.mode.mixed': 'Mixed',
    'time.hourCycle.h23': '24-hour',
    'time.hourCycle.h12': '12-hour',
    'time.alarms.add': 'Add alarm',
    'time.alarms.empty': 'No alarms yet',
    'time.alarms.title': 'Title',
    'time.alarms.hour': 'Hour',
    'time.alarms.minute': 'Minute',
    'time.alarms.once': 'Once',
    'time.alarms.daily': 'Daily',
    'time.alarms.weekdays': 'Weekdays',
    'time.alarms.custom': 'Custom days',
    'time.alarms.repeat': 'Repeat',
    'time.alarms.date': 'Date',
    'time.alarms.enabled': 'Enabled',
    'time.alarms.enabledState': 'Enabled',
    'time.alarms.disabledState': 'Disabled',
    'time.alarms.editLabel': 'Edit {title}',
    'time.alarms.deleteLabel': 'Delete {title}',
    'time.alarms.save': 'Save alarm',
    'time.alarms.cancel': 'Cancel',
    'time.alarms.delete': 'Delete',
    'time.alarms.confirmDelete': 'Delete this alarm?',
    'time.alarms.minuteError': 'Minute must be between 0 and 59',
    'time.alarms.hourError': 'Hour must be between 0 and 23',
    'time.alarms.weekdaysError': 'Choose at least one weekday',
    'time.alarms.pastError': 'One-time alarms cannot be in the past',
    'time.alarms.next': 'Next: {value}',
    'time.weekday.1': 'Mon',
    'time.weekday.2': 'Tue',
    'time.weekday.3': 'Wed',
    'time.weekday.4': 'Thu',
    'time.weekday.5': 'Fri',
    'time.weekday.6': 'Sat',
    'time.weekday.7': 'Sun'
  }
};

export function tt(key: TimeTranslationKey, values: Record<string, string | number> = {}) {
  const table = timeTranslations[getLanguage()] ?? timeTranslations.en;
  return Object.entries(values).reduce(
    (text, [name, value]) => text.split(`{${name}}`).join(String(value)),
    table[key] ?? timeTranslations.en[key] ?? key
  );
}

export function timeLocalLabel() {
  return tt('time.local');
}
