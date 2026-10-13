# 时间模块 Implementation Plan

> **For agentic workers:** 按任务逐项实施；实现前加载 test-driven-development，遇到失败加载 systematic-debugging，完成前加载 requesting-code-review。

**Goal:** 增加自适应纯展示多时区桌面时钟，以及设置内的时差对照、独立本地时间闹钟与 Nowly Bar 通知。

**Architecture:** React 时间组件只负责显示；设置通过 repository abstraction 持久化。Rust 独立调度器维护本地时间闹钟、实例去重、稍后提醒与离线汇总，通过既有 Bar snapshot 与事件更新呈现，不复用日历模型。

**Tech Stack:** React、TypeScript、手写 CSS、Intl、Tauri、Rust、chrono/chrono-tz、SQLite、Vitest、Playwright。

**Approved spec:** ../specs/2026-10-11-time-module-design.md。设计规格内容优先于早期布局草图；桌面没有业务标签页或闹钟列表。

---

## 文件结构与契约

新建 src/time/：time-model.ts（共享类型）、time-format.ts（格式化与换算）、clock-layout.ts（布局纯函数）、useTimeSnapshot.ts（共享节拍）、useTimeSettings.ts（资源读写）、TimeWidget.tsx、ClockFace.tsx、time.css、TimeSettingsDialog.tsx、WorldClockSettings.tsx、TimeComparisonPanel.tsx、AlarmSettingsPanel.tsx、AlarmEditor.tsx；每个逻辑/组件对应同名测试文件。

新建 src-tauri/src/time/：mod.rs、types.rs、store.rs、schedule.rs、scheduler.rs、commands.rs、tests.rs。类型只负责序列化，存储只负责数据库，schedule 负责纯时间规则，scheduler 负责事务与检查点。

修改现有：src/data/nowly-repository.ts、tauri-nowly-repository.ts、browser-tauri-shim.ts；src-tauri/src/db.rs、main.rs、status_island.rs；src/app/status-island-model.ts、layout/StatusIsland.tsx、layout/ModuleFrame.tsx、layout/ModuleGrid.tsx、App.tsx；src/quick-panel/useStatusIslandSnapshot.ts、StatusIslandApp.tsx；src/widgets/widget-registry.ts；src/settings/SettingsDialog.tsx；src/i18n/translations.ts；README.md、README.zh.md。仅在既有路由需要时修改 src/modals/ModalRoot.tsx。

公开契约采用以下形状（前后端 camelCase 一致）：

```typescript
export type ClockMode = 'digital' | 'analog' | 'mixed';
export type WorldClock = {
  id: string;
  timeZone: string; // 'local' 或有效 IANA ID
  label: string;
  mode: ClockMode;
  hourCycle: 'h12' | 'h23';
  showSeconds: boolean;
  showLabel: boolean;
  showDate: boolean;
  showDifference: boolean;
};
export type AlarmRepeat =
  | { kind: 'once'; date: string }
  | { kind: 'weekly'; weekdays: number[] }; // ISO 周一=1；每天/工作日是快捷配置
export type Alarm = {
  id: string;
  title: string;
  hour: number;
  minute: number;
  repeat: AlarmRepeat;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};
export type AlarmDraft = Omit<Alarm, 'id' | 'createdAt' | 'updatedAt'>;
export type TimeSettings = { clocks: WorldClock[] };
export type AlarmNotice = {
  id: string;
  kind: 'alarm' | 'missedSummary';
  title: string;
  dueAt: string;
  alarmId: string | null;
  count: number;
  rangeStart: string;
  rangeEnd: string;
};
```

Repository 新增 getTimeSettings、saveTimeSettings、listAlarms、createAlarm、updateAlarm、deleteAlarm。Bar 使用独立 acknowledge_alarm_notice / snooze_alarm_notice 命令；snapshot 新增 alarmNotices，旧测试夹具缺失字段按空数组兼容。所有时间参数注入可测试时钟，不在纯函数内读取系统时间。

## Task 1：类型、存储与 repository

- [ ] 为 time/types.rs 与 store.rs 写内存 SQLite 测试：配置 round-trip、默认一个本地数字时钟、至少一个时钟、非法时区、空星期、过去的一次性日期拒绝；闹钟 CRUD、排序与时间戳持久化。
- [ ] 运行 `cargo test --manifest-path src-tauri\Cargo.toml time::`，确认新增断言在实现前失败。
- [ ] 增量 migration 创建 time_settings 单行 JSON、alarms、alarm_dispatches、alarm_scheduler_state；沿用既有 MIGRATIONS 版本方式，不改旧 migration。实例唯一键使用 alarm ID + 规则生效版本 + 本地日期；稍后状态保存在原实例上，不能覆盖重复规则。
- [ ] 实现 store/types/commands，注册 main.rs handler；验证本地 timeZone 标识、IANA ID、模式、hourCycle、时分与日期、非空周集合和时钟列表。禁用/删除闹钟撤销其待触发稍后实例，编辑规则仅影响生效后的实例。
- [ ] 为 tauri repository 写 command/payload 映射测试，再补 browser shim 与所有实现该接口的测试工厂；配置加载失败不能覆盖默认保存。
- [ ] 运行上述 Rust 测试和 `npm test -- src\data\tauri-nowly-repository.test.ts src\data\browser-tauri-shim.test.ts`；预期通过。

## Task 2：时间计算与布局纯函数

- [ ] 创建 time-format.test.ts：UTC 同一瞬时点在 Asia/Shanghai、Europe/London、Asia/Kathmandu 的小时分钟正确；覆盖跨年、非整数偏移、DST、12 小时 AM/PM、非法 zone。
- [ ] 最小断言示例：

```typescript
import { expect, it } from 'vitest';
import { clockParts } from './time-format';
it('preserves quarter-hour offsets', () => {
  const parts = clockParts(new Date('2026-10-11T00:00:00Z'), 'Asia/Kathmandu');
  expect([parts.hour, parts.minute]).toEqual([5, 45]);
});
```

- [ ] 运行 `npm test -- src\time\time-format.test.ts src\time\clock-layout.test.ts`，确认失败。
- [ ] 实现 clockParts(now, zone) 返回 hour/minute/second/year/month/day；缓存 Intl formatter，不每秒构造；使用 Gregorian/h23 保证计算不受当前文案语言影响。显示层另用应用语言格式化。
- [ ] 布局函数输入 width/height/count/mode，输出列数、表盘尺寸、信息可见性与滚动需求；只用设计间距和合法字号。候选列数逐个评估，优先全部可读，再隐藏辅助信息；未满足最小可读空间则正文滚动，不裁切时钟。
- [ ] 表盘角度 hour=(hour%12+minute/60)*30、minute=(minute+second/60)*6、second=second*6；只在节拍改变时更新，无补间。
- [ ] 测试一/二/四/多时钟、矮宽与高窄尺寸、三种模式；运行 targeted tests 确认通过。

## Task 3：纯展示组件与模块接入

- [ ] TimeWidget.test.tsx 先断言默认数字模式无城市/日期/工具栏/Tab，纯指针无可见数字时间，混合两者存在；隐藏城市仍有读屏名称。
- [ ] useTimeSnapshot 测试 fake timer、visibilitychange、卸载清理；隐藏后不刷新，恢复立即从实际时刻取值，不按累计 tick 推算。
- [ ] 实现 ClockFace 作为内容图形（不是操作图标），使用 CSS 几何表盘与 Token，避免引入图标库或未经规范许可的 SVG 功能图标。ResizeObserver 结合容器查询计算可用正文尺寸。
- [ ] 注册可选 builtin 时间模块，默认建议 4×3、最小 2×2；不加入默认布局。App 接入 TimeWidget，移除仅移除布局记录，不删除闹钟或配置。
- [ ] ModuleFrame/Grid 增加可选 onConfigure：仅编辑模式显示标准设置图标按钮，未传时完全保持原行为。全局设置中也提供时间设置入口，模块移除后仍能管理闹钟。
- [ ] 运行 `npm test -- src\time src\app\layout\ModuleFrame.test.tsx src\app\layout\ModuleGrid.test.tsx src\widgets\useModuleLayout.test.tsx`；预期新旧测试全部通过。

## Task 4：设置、对照与编辑界面

- [ ] 先写组件测试：添加/删除/排序、至少一项限制、单时钟模式与辅助信息开关、保存失败保留草稿、加载失败重试、对照不改变真实时钟配置。
- [ ] 使用既有 Dialog/Tabs/Select/DatePicker/TimePicker；TimePicker 现有分钟步长为 5，闹钟需支持任意分钟，新增可选 minuteStep（默认仍为 5；闹钟传 1）及相应测试，不改变日历现有语义。
- [ ] WorldClockSettings 搜索 IANA zone，支持别名与每项配置。默认 showLabel/showDate/showDifference=false；纯指针隐藏时间读数，纯数字不渲染表盘。
- [ ] TimeComparisonPanel 对本地基准先解析瞬时点再换算；不可靠地解析模糊 DST 时间时给出明确提示并选择首次有效发生，不静默改变输入。
- [ ] AlarmEditor 支持标题、时分、一次性日期、每天/工作日/自选星期、启用；展示服务器计算的下次发生。重复列表的启停按钮用原生 input；删除先确认，失败不移除。
- [ ] 所有 UI 接入中英文翻译；遵守焦点陷阱、Esc 与归还。设置关闭不影响调度。
- [ ] 运行 `npm test -- src\time src\components\TimePicker.test.tsx src\settings\SettingsDialog.test.tsx`，预期通过。

## Task 5：Rust 时间规则与持久化调度

- [ ] schedule.rs 先测试 once/weekly、下一次发生、春季跳时/秋季重复、设备时区变化。scheduler.rs 测试启动检查点、刚新建不补算过去、短间隔准点、恢复汇总、再次重启不重复、回拨、事务回滚、稍后重启恢复。
- [ ] 执行 `cargo test --manifest-path src-tauri\Cargo.toml time::` 确认新失败，再实现。
- [ ] 定义纯 next_occurrence(alarm, after_utc, device_zone)；重复按当地日期遍历，跳时记录 missed、重复小时选择早一次。按本地日期实例唯一键保证时区切换或回拨不重复。
- [ ] 调度周期 1 秒；检查间隔不超过 5 秒走正常到期，否则视为恢复。处理 (checkpoint, now]；首次启动仅建检查点。长离线按周周期算次数与边界，不生成逐日无限数组。调度配置保存时记录 effectiveFrom，屏蔽生效前实例。
- [ ] 数据库事务写实例状态、检查点与持久化通知 outbox；事务提交后 invalidation。发送失败继续保留 outbox，不在锁内发送或操作原生窗口。
- [ ] acknowledge_notice(id) 幂等消费对应实例；snooze_notice(id, now) 仅对普通闹钟有效，保存 now+5min UTC，幂等调用不重复延长；汇总不提供稍后。禁用/删除使稍后撤销。
- [ ] 新建独立后台调度循环，启动先恢复后按秒检查，不改日程 20 秒轮询。一次性触发/错过后停用。使用 app/db 现有生命周期，避免额外进程与系统任务。
- [ ] 执行 targeted Rust tests；预期全部通过。

## Task 6：Nowly Bar 来源与交互

- [ ] status-island-model.test.ts 先增加 alarm/missedSummary 源、优先级、确认不消费日程、摘要已读不重放、旧 snapshot 兼容测试。
- [ ] 扩展 Rust snapshot 与前端类型，默认 alarmNotices=[]；提醒 subject/panelContext 增加 alarm 与 missedSummary。优先级沿用现有规则，闹钟不抢占已展开面板上下文；没有活跃面板时进入提醒入口。
- [ ] Bar 展示标题、到期本地时间；普通闹钟可确认/稍后，汇总显示总次数与范围并仅确认。提交中防重复，失败保留通知并重试。
- [ ] 现有 primary_identity 兼容闹钟身份，避免点击后仍被绑定到日历；不把闹钟 ID 交给日历跳转命令，不改变菜单/AI/历史状态机。
- [ ] 时间调度 invalidation 触发 snapshot 刷新，不依赖主窗口存在；App 前台与独立 Bar 使用同一持久化实例状态。
- [ ] 执行 `npm test -- src\app\status-island-model.test.ts src\app\layout\StatusIsland.test.tsx src\quick-panel\useStatusIslandSnapshot.test.tsx src\quick-panel\StatusIslandApp.test.tsx` 与 `cargo test --manifest-path src-tauri\Cargo.toml status_island`。

## Task 7：端到端自适应与回归

- [ ] 新建 tests/nowly-time.spec.ts，沿用现有 browser shim 数据准备，覆盖模块添加/缩放/移除、设置入口、重载配置、三种模式、城市全部隐藏、时差对照、闹钟 CRUD 与 Bar 模拟交互。
- [ ] 尺寸断言用 boundingClientRect 验证每个数字与表盘都在自身可见容器内，时钟间不重叠；包含 2×2、4×3、更宽更矮、多时区、三种密度；只允许正文滚动，不允许页面滚动。
- [ ] 验证上午/下午可区分，读屏名称保留时区，不对每秒时间设置 aria-live。
- [ ] 执行 `npm run e2e -- tests\nowly-time.spec.ts tests\nowly-module-layout.spec.ts tests\screen-status-island.spec.ts tests\nowly-bar-menu.spec.ts`；复用已有 Playwright webServer，不另装工具。
- [ ] 执行 `npm run build`，若已有 VS Code build task 则优先用该 task；只有失败显示缺依赖时才安装。
- [ ] Windows Tauri 真机验证最小化/托盘到点、关闭设置继续运行、移除模块继续运行、休眠恢复汇总、重启去重、稍后恢复、AI 打开时不抢占。无法执行的原生场景明确标记未验证，不用浏览器结果声称通过。

## Task 8：文档、评审与交付

- [ ] 更新 README.md/README.zh.md：纯展示模式、所有辅助信息默认隐藏、自适应、设置入口、闹钟生命周期、托盘运行要求、错过汇总与无铃声边界。
- [ ] 检查 git diff、现有用户修改不覆盖；确认没有布局草图或日志进入提交，没有新增无关依赖、设计 token 或动效。
- [ ] 加载 requesting-code-review，按实际变更规模进行评审；只修与当前功能相关的问题，重新运行最小覆盖测试。
- [ ] 每个完成的任务可独立提交；提交必须 `<type>: <short description>`，添加 `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`。用户未要求提交时实施结束保留工作区修改，不擅自提交源码。
- [ ] 最终报告明确功能、运行命令结果、原生验证结果与剩余限制；所有必需测试通过且持久化结果验证后才标记实现完成。

## 顺序与并行边界

Task 1 是 Task 3/4/5 的契约前提；Task 2 是 Task 3/4 的计算前提；Task 5 是 Task 6 原生提醒前提；Task 7 依赖 3/4/6；Task 8 依赖 7。类型与存储稳定后，可并行开发前端时钟/设置与 Rust 规则调度，但 main.rs、repository、Bar 集成由同一集成任务修改，避免文件冲突。

## 计划自审

已覆盖用户确认的三种纯展示形式、隐藏位置信息、自适应、多时区、设置内工具、本地重复闹钟、Bar、离线汇总、稍后、无铃声、持久化与回归。修正了项目中没有常规模块菜单的假设：使用编辑态设置按钮并补全局设置入口。明确分钟选择步长适配、提醒身份协议与原生验收，不将浏览器测试当作 Windows 原生验证。
