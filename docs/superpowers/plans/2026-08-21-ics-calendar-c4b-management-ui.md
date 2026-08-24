# 日历订阅 Part 4b｜订阅管理界面与只读详情实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:executing-plans 逐任务执行本计划。步骤用 `- [ ]` 复选框跟踪。

**Goal:** 补齐 Spec C 的最后一块前端：(1) 订阅事件的只读详情弹窗（`external-detail` 模态），回填 Part 4a 延后的 App.tsx 点击分流；(2) Settings 内的「日历订阅」管理界面（列表 + 增删改 + 手动刷新 + 状态显示），复用 `KanbanFieldManagerDialog` 的 tab/表单/列表/ConfirmDialog 骨架与 `ColorPicker`。

**Architecture:** 只读详情弹窗是一个纯展示的 `Dialog`（标题/时间/时区/地点/描述/来源名，无编辑、删除、关联任务）。订阅管理是独立 `SubscriptionManagerDialog`，从 `SettingsDialog` 里一个入口按钮打开（新增 `modal.type === 'calendar-subscriptions'`）；数据经 Part 1 的 `listCalendarSubscriptions`/`create`/`update`/`delete` 与 Part 3 的 `refreshCalendarSubscription` 走 IPC。刷新后监听 `calendar-subscriptions-updated` 事件触发日历重载（Part 3 已发事件）。

**Tech Stack:** React/TypeScript（Dialog、ConfirmDialog、ColorPicker、i18n）、Tauri event listen。

**前置：** 依赖 Part 1（订阅模型 + CRUD 仓储）、Part 3（`refreshCalendarSubscription` 命令 + `calendar-subscriptions-updated` 事件）、Part 4a（`subscription-model.ts`、`external-detail` 分流点）均已落地。

---

### Task 1: 只读详情弹窗 `ExternalEventDialog`

**Files:**
- Create: `src/calendar/ExternalEventDialog.tsx`
- Create: `src/calendar/ExternalEventDialog.test.tsx`
- Modify: `src/i18n/translations.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/calendar/ExternalEventDialog.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExternalEventDialog } from './ExternalEventDialog';
import type { CalendarEvent } from './calendar-model';

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'x1', title: '团队周会', startAt: '2026-08-10T18:00', endAt: '2026-08-10T19:00',
    allDay: false, category: 'personal', color: '#4FC9DA', linkedTaskId: null,
    note: '会议室 A\n请提前十分钟', reminders: [], createdAt: '', updatedAt: '',
    recurrence: null, startTz: 'Asia/Shanghai', endTz: 'Asia/Shanghai', rrule: null,
    seriesId: null, seriesStartAt: null, occurrenceStartAt: null, isOverridden: false,
    subscriptionId: 's1', ...overrides
  };
}

describe('ExternalEventDialog', () => {
  it('shows title, time, timezone, note and source name read-only', () => {
    render(<ExternalEventDialog event={event()} sourceName="家庭日历" onClose={vi.fn()} />);
    expect(screen.getByText('团队周会')).toBeInTheDocument();
    expect(screen.getByText(/会议室 A/)).toBeInTheDocument();
    expect(screen.getByText('家庭日历')).toBeInTheDocument();
    expect(screen.getByText('Asia/Shanghai')).toBeInTheDocument();
    // 只读：没有编辑/删除按钮。
    expect(screen.queryByRole('button', { name: /编辑|删除/ })).toBeNull();
  });

  it('renders all-day events without a time range', () => {
    render(
      <ExternalEventDialog
        event={event({ allDay: true, startTz: null, endTz: null })}
        sourceName="家庭日历"
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('团队周会')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /d/Codes/nowly && npx vitest run src/calendar/ExternalEventDialog.test.tsx`
Expected: FAIL —— 组件不存在。

- [ ] **Step 3: 实现组件 + i18n**

在 `src/i18n/translations.ts` 的 `zh` 与 `en` 字典各加（放 `calendar.*` 附近）：

```ts
    // zh
    'calendar.external.title': '订阅事件',
    'calendar.external.close': '关闭',
    'calendar.external.source': '来源',
    'calendar.external.location': '地点',
    'calendar.external.readonly': '订阅日历为只读，无法编辑。',
    'calendar.external.allDay': '全天',
```
```ts
    // en
    'calendar.external.title': 'Subscribed event',
    'calendar.external.close': 'Close',
    'calendar.external.source': 'Source',
    'calendar.external.location': 'Location',
    'calendar.external.readonly': 'Subscribed calendars are read-only.',
    'calendar.external.allDay': 'All day',
```

创建 `src/calendar/ExternalEventDialog.tsx`：

```tsx
import { X } from 'lucide-react';
import type { RefObject } from 'react';
import { Dialog } from '../components/Dialog';
import { t } from '../i18n';
import type { CalendarEvent } from './calendar-model';

type Props = {
  event: CalendarEvent;
  sourceName: string;
  onClose: () => void;
  isTopLayer?: boolean;
  restoreFocusRef?: RefObject<HTMLElement | null>;
};

// Format "YYYY-MM-DDTHH:MM" wall clock into a readable local string. The backend
// already converted to the device display timezone, so this is pure formatting.
function formatWall(wall: string, allDay: boolean): string {
  const [date, time] = wall.split('T');
  return allDay ? date : `${date} ${time ?? ''}`.trim();
}

export function ExternalEventDialog({ event, sourceName, onClose, isTopLayer = true, restoreFocusRef }: Props) {
  const time = event.allDay
    ? t('calendar.external.allDay')
    : `${formatWall(event.startAt, false)} – ${formatWall(event.endAt, false).split(' ')[1] ?? ''}`.trim();
  const location = event.note.split('\n')[0]?.trim() || '';
  return (
    <Dialog
      title={t('calendar.external.title')}
      ariaLabelledBy="external-event-title"
      isTopLayer={isTopLayer}
      restoreFocusRef={restoreFocusRef}
      onRequestClose={onClose}
      className="external-event-dialog"
      headerActions={
        <button className="good-icon-button" aria-label={t('calendar.external.close')} onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      }
    >
      <div className="external-event">
        <h3 className="external-event__title" style={{ color: event.color }}>{event.title}</h3>
        <p className="external-event__time">
          {time}
          {event.startTz ? <span className="external-event__tz">{event.startTz}</span> : null}
        </p>
        {location ? (
          <p className="external-event__row">
            <span className="external-event__label">{t('calendar.external.location')}</span>
            {location}
          </p>
        ) : null}
        {event.note ? <p className="external-event__note">{event.note}</p> : null}
        <p className="external-event__row">
          <span className="external-event__label">{t('calendar.external.source')}</span>
          {sourceName}
        </p>
        <p className="external-event__readonly">{t('calendar.external.readonly')}</p>
      </div>
    </Dialog>
  );
}
```

在 `src/app/styles.css` 末尾加最小样式（用 design token，无硬编码色）：

```css
.external-event { display: flex; flex-direction: column; gap: 10px; }
.external-event__title { margin: 0; font-size: 1.05rem; }
.external-event__time { margin: 0; color: var(--text-secondary); }
.external-event__tz { margin-left: 8px; color: var(--text-muted); font-size: 0.85rem; }
.external-event__row { margin: 0; }
.external-event__label { margin-right: 8px; color: var(--text-muted); }
.external-event__note { margin: 0; white-space: pre-wrap; color: var(--text-secondary); }
.external-event__readonly { margin: 4px 0 0; color: var(--text-muted); font-size: 0.85rem; }
```

- [ ] **Step 4: 跑测试确认通过 + 类型检查**

Run: `cd /d/Codes/nowly && npx vitest run src/calendar/ExternalEventDialog.test.tsx && npx tsc --noEmit`
Expected: PASS，`tsc` 无错误。

- [ ] **Step 5: 提交**

```bash
git add src/calendar/ExternalEventDialog.tsx src/calendar/ExternalEventDialog.test.tsx src/i18n/translations.ts src/app/styles.css
git commit -m "feat: read-only detail dialog for subscription events"
```

---

### Task 2: 模态状态 + App 路由接线（回填 4a 分流）

**Files:**
- Modify: `src/lib/modal-store.ts`
- Modify: `src/modals/ModalRoot.tsx`
- Modify: `src/app/App.tsx`

- [ ] **Step 1: 扩展 ModalState**

在 `src/lib/modal-store.ts` 的联合类型里，`{ type: 'settings'; ... }` 之后加：

```ts
  | { type: 'external-detail'; event: CalendarEvent; trigger: HTMLElement | null }
  | { type: 'calendar-subscriptions'; trigger: HTMLElement | null }
```

- [ ] **Step 2: ModalRoot 渲染分支**

在 `src/modals/ModalRoot.tsx` 顶部 import 加：

```ts
import { ExternalEventDialog } from '../calendar/ExternalEventDialog';
import { SubscriptionManagerDialog } from '../settings/SubscriptionManagerDialog';
```

`ModalRoot` 的 props（`Props` 类型）里加订阅数据与仓储方法透传（沿用现有 `settings`/`saveSettings` 的传递方式）：

```ts
  subscriptions: CalendarSubscription[];
  onSubscriptionsChanged(): void;
  createSubscription(draft: SubscriptionDraft): Promise<CalendarSubscription>;
  updateSubscription(id: string, draft: SubscriptionDraft): Promise<CalendarSubscription>;
  deleteSubscription(id: string): Promise<void>;
  refreshSubscription(id: string): Promise<void>;
```

> 对应 import：`import type { CalendarSubscription, SubscriptionDraft } from '../calendar/subscription-model';`

在 settings 渲染分支之后加：

```tsx
    {modal.type === 'external-detail' ? (
      <ExternalEventDialog
        event={modal.event}
        sourceName={subscriptions.find((s) => s.id === modal.event.subscriptionId)?.name ?? ''}
        restoreFocusRef={{ current: modal.trigger }}
        onClose={onClose}
      />
    ) : null}
    {modal.type === 'calendar-subscriptions' ? (
      <SubscriptionManagerDialog
        subscriptions={subscriptions}
        restoreFocusRef={{ current: modal.trigger }}
        onClose={onClose}
        onChanged={onSubscriptionsChanged}
        onCreate={createSubscription}
        onUpdate={updateSubscription}
        onDelete={deleteSubscription}
        onRefresh={refreshSubscription}
      />
    ) : null}
```

- [ ] **Step 3: App.tsx 回填分流 + 传参 + 数据加载**

在 `src/app/App.tsx`：

(a) `onOpenEvent`（第 163 行附近）落实 4a 的分流（4a 已给出，此处确认存在）：

```tsx
        onOpenEvent={(event) =>
          event.subscriptionId
            ? openModalInForeground({ type: 'external-detail', event, trigger: null })
            : openModalInForeground({ type: 'event-edit', event, trigger: null })
        }
```

(b) 加订阅状态与加载（沿用现有 `useState` + `useEffect` 载入模式）：

```tsx
  const [subscriptions, setSubscriptions] = useState<CalendarSubscription[]>([]);
  const loadSubscriptions = useCallback(() => {
    void repository.listCalendarSubscriptions().then(setSubscriptions).catch(() => setSubscriptions([]));
  }, [repository]);
  useEffect(() => { loadSubscriptions(); }, [loadSubscriptions]);
```

(c) 监听 Part 3 的刷新事件，刷新后重载订阅列表并触发日历重载（`reloadEvents` 为 `useEvents` 暴露的刷新函数，确认其名；若为 `reload`/`refresh` 按实际）：

```tsx
  useEffect(() => {
    const removers: Array<() => void> = [];
    void listen('calendar-subscriptions-updated', () => { loadSubscriptions(); reloadEvents(); })
      .then((remove) => removers.push(remove));
    return () => removers.forEach((r) => r());
  }, [loadSubscriptions, reloadEvents]);
```

(d) 给 `<ModalRoot>` 传新 props：

```tsx
        subscriptions={subscriptions}
        onSubscriptionsChanged={loadSubscriptions}
        createSubscription={repository.createCalendarSubscription}
        updateSubscription={repository.updateCalendarSubscription}
        deleteSubscription={repository.deleteCalendarSubscription}
        refreshSubscription={repository.refreshCalendarSubscription}
```

> `refreshCalendarSubscription` 仓储方法须在 Part 3 或此处补：`src/data/nowly-repository.ts` 接口加 `refreshCalendarSubscription: (id: string) => Promise<void>;`，`tauri-nowly-repository.ts` 加 `refreshCalendarSubscription: (id) => invoke('refresh_calendar_subscription', { id }),`。执行前 `grep -n refreshCalendarSubscription src/data/*.ts` 确认；缺则补齐。

- [ ] **Step 4: 类型检查 + 现有测试回归**

Run: `cd /d/Codes/nowly && npx tsc --noEmit && npx vitest run src/modals/ModalRoot.test.tsx`
Expected: `tsc` 无错误；`ModalRoot.test.tsx` 若因新增必填 props 报错，给其测试渲染补默认 props（空数组 + `vi.fn()`）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/modal-store.ts src/modals/ModalRoot.tsx src/app/App.tsx src/data/nowly-repository.ts src/data/tauri-nowly-repository.ts src/modals/ModalRoot.test.tsx
git commit -m "feat: route subscription events to read-only detail and wire manager modal"
```

---

### Task 3: 订阅管理弹窗 `SubscriptionManagerDialog`

列表 + 表单（名称 / URL / 颜色 / 刷新间隔）+ 手动刷新 + 状态徽标 + 删除确认。最多 3 个源（达上限禁用新增）。

**Files:**
- Create: `src/settings/SubscriptionManagerDialog.tsx`
- Create: `src/settings/SubscriptionManagerDialog.test.tsx`
- Modify: `src/i18n/translations.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/settings/SubscriptionManagerDialog.test.tsx`：

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SubscriptionManagerDialog } from './SubscriptionManagerDialog';
import type { CalendarSubscription } from '../calendar/subscription-model';

function sub(overrides: Partial<CalendarSubscription> = {}): CalendarSubscription {
  return {
    id: 's1', name: '家庭', url: 'https://example.com/a.ics', color: '#4FC9DA',
    refreshIntervalMinutes: 15, lastSyncedAt: null, lastStatus: null, lastError: null,
    createdAt: '', updatedAt: '', ...overrides
  };
}

function props(overrides = {}) {
  return {
    subscriptions: [sub()], onClose: vi.fn(), onChanged: vi.fn(),
    onCreate: vi.fn().mockResolvedValue(sub()), onUpdate: vi.fn().mockResolvedValue(sub()),
    onDelete: vi.fn().mockResolvedValue(undefined), onRefresh: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

describe('SubscriptionManagerDialog', () => {
  it('lists existing subscriptions', () => {
    render(<SubscriptionManagerDialog {...props()} />);
    expect(screen.getByText('家庭')).toBeInTheDocument();
  });

  it('creates a subscription from the form', async () => {
    const p = props({ subscriptions: [] });
    render(<SubscriptionManagerDialog {...p} />);
    fireEvent.change(screen.getByLabelText(/名称/), { target: { value: '工作' } });
    fireEvent.change(screen.getByLabelText(/链接|URL/), { target: { value: 'https://x.com/b.ics' } });
    fireEvent.click(screen.getByRole('button', { name: /添加|保存/ }));
    await waitFor(() => expect(p.onCreate).toHaveBeenCalled());
    expect(p.onChanged).toHaveBeenCalled();
  });

  it('disables add when three sources exist', () => {
    render(<SubscriptionManagerDialog {...props({ subscriptions: [sub({id:'a'}), sub({id:'b'}), sub({id:'c'})] })} />);
    expect(screen.getByRole('button', { name: /添加|保存/ })).toBeDisabled();
  });

  it('refreshes a subscription', async () => {
    const p = props();
    render(<SubscriptionManagerDialog {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /刷新/ }));
    await waitFor(() => expect(p.onRefresh).toHaveBeenCalledWith('s1'));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /d/Codes/nowly && npx vitest run src/settings/SubscriptionManagerDialog.test.tsx`
Expected: FAIL —— 组件不存在。

- [ ] **Step 3: 实现组件 + i18n**

在 `src/i18n/translations.ts` 的 `zh`/`en` 各加：

```ts
    // zh
    'subscription.title': '日历订阅',
    'subscription.close': '关闭',
    'subscription.name': '名称',
    'subscription.url': '链接（.ics / webcal）',
    'subscription.color': '颜色',
    'subscription.interval': '刷新间隔（分钟）',
    'subscription.add': '添加订阅',
    'subscription.save': '保存修改',
    'subscription.cancel': '取消编辑',
    'subscription.empty': '还没有订阅。最多可添加 3 个日历源。',
    'subscription.limit': '已达 3 个订阅上限。',
    'subscription.refresh': '刷新',
    'subscription.edit': '编辑{name}',
    'subscription.delete': '删除{name}',
    'subscription.deleteTitle': '删除“{name}”？',
    'subscription.deleteBody': '删除后该来源的所有事件会从日历移除，本地日程不受影响。',
    'subscription.statusOk': '上次同步成功',
    'subscription.statusFailed': '同步失败',
    'subscription.statusNever': '尚未同步',
    'subscription.errorName': '请输入名称。',
    'subscription.errorUrl': '请输入 https 或 webcal 链接。',
```
```ts
    // en
    'subscription.title': 'Calendar subscriptions',
    'subscription.close': 'Close',
    'subscription.name': 'Name',
    'subscription.url': 'Link (.ics / webcal)',
    'subscription.color': 'Color',
    'subscription.interval': 'Refresh interval (min)',
    'subscription.add': 'Add subscription',
    'subscription.save': 'Save changes',
    'subscription.cancel': 'Cancel edit',
    'subscription.empty': 'No subscriptions yet. Up to 3 calendar sources.',
    'subscription.limit': 'Reached the limit of 3 subscriptions.',
    'subscription.refresh': 'Refresh',
    'subscription.edit': 'Edit {name}',
    'subscription.delete': 'Delete {name}',
    'subscription.deleteTitle': 'Delete "{name}"?',
    'subscription.deleteBody': 'Removing a source deletes its events from the calendar. Local events are unaffected.',
    'subscription.statusOk': 'Last sync succeeded',
    'subscription.statusFailed': 'Sync failed',
    'subscription.statusNever': 'Not synced yet',
    'subscription.errorName': 'Please enter a name.',
    'subscription.errorUrl': 'Please enter an https or webcal link.',
```

创建 `src/settings/SubscriptionManagerDialog.tsx`：

```tsx
import { RefreshCw, X } from 'lucide-react';
import { type RefObject, useState } from 'react';
import { ColorPicker } from '../components/ColorPicker';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Dialog } from '../components/Dialog';
import type { CalendarSubscription, SubscriptionDraft } from '../calendar/subscription-model';
import type { HexColor } from '../lib/color';
import { t } from '../i18n';

const MAX_SOURCES = 3;
const DEFAULT_COLOR = '#4FC9DA' as HexColor;

type Props = {
  subscriptions: CalendarSubscription[];
  onClose: () => void;
  onChanged: () => void;
  onCreate: (draft: SubscriptionDraft) => Promise<CalendarSubscription>;
  onUpdate: (id: string, draft: SubscriptionDraft) => Promise<CalendarSubscription>;
  onDelete: (id: string) => Promise<void>;
  onRefresh: (id: string) => Promise<void>;
  isTopLayer?: boolean;
  restoreFocusRef?: RefObject<HTMLElement | null>;
};

function errorMessage(error: unknown) {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? (error as { message: string }).message
    : '';
}

export function SubscriptionManagerDialog({
  subscriptions, onClose, onChanged, onCreate, onUpdate, onDelete, onRefresh,
  isTopLayer = true, restoreFocusRef
}: Props) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [color, setColor] = useState<HexColor>(DEFAULT_COLOR);
  const [interval, setInterval] = useState(15);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const atLimit = subscriptions.length >= MAX_SOURCES && !editingId;

  function resetForm() {
    setName(''); setUrl(''); setColor(DEFAULT_COLOR); setInterval(15);
    setEditingId(null); setFormError('');
  }
  function beginEdit(item: CalendarSubscription) {
    setEditingId(item.id); setName(item.name); setUrl(item.url);
    setColor(item.color); setInterval(item.refreshIntervalMinutes); setFormError('');
  }
  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) { setFormError(t('subscription.errorName')); return; }
    if (!/^(https:\/\/|webcal:\/\/)/i.test(url.trim())) { setFormError(t('subscription.errorUrl')); return; }
    setBusy(true); setFormError('');
    const draft: SubscriptionDraft = { name: trimmed, url: url.trim(), color, refreshIntervalMinutes: interval };
    try {
      if (editingId) await onUpdate(editingId, draft);
      else await onCreate(draft);
      resetForm(); onChanged();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally { setBusy(false); }
  }
  async function confirmRemoval() {
    if (!confirmDelete) return;
    setBusy(true);
    try { await onDelete(confirmDelete.id); setConfirmDelete(null); onChanged(); }
    catch (error) { setFormError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function refresh(id: string) {
    setBusy(true);
    try { await onRefresh(id); onChanged(); }
    finally { setBusy(false); }
  }

  function statusText(item: CalendarSubscription): string {
    if (item.lastStatus === 'ok') return t('subscription.statusOk');
    if (item.lastStatus === 'failed') return item.lastError || t('subscription.statusFailed');
    return t('subscription.statusNever');
  }

  return (
    <>
      <Dialog
        title={t('subscription.title')}
        ariaLabelledBy="subscription-title"
        isTopLayer={isTopLayer && !confirmDelete}
        restoreFocusRef={restoreFocusRef}
        onRequestClose={busy ? () => undefined : onClose}
        className="subscription-dialog"
        headerActions={
          <button className="good-icon-button" aria-label={t('subscription.close')} disabled={busy} onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        }
      >
        <form className="subscription-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <label className="good-field">
            <span>{t('subscription.name')}</span>
            <input className="good-input" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
          </label>
          <label className="good-field">
            <span>{t('subscription.url')}</span>
            <input className="good-input" value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy} />
          </label>
          <div className="good-field">
            <span>{t('subscription.color')}</span>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <label className="good-field">
            <span>{t('subscription.interval')}</span>
            <input
              className="good-input" type="number" min={1} max={30} value={interval}
              onChange={(e) => setInterval(Math.max(1, Math.min(30, Number(e.target.value) || 15)))}
              disabled={busy}
            />
          </label>
          {formError ? <div role="alert" className="dialog-error">{formError}</div> : null}
          {atLimit ? <div className="subscription-form__hint">{t('subscription.limit')}</div> : null}
          <div className="subscription-form__actions">
            {editingId ? (
              <button type="button" className="good-button" disabled={busy} onClick={resetForm}>
                {t('subscription.cancel')}
              </button>
            ) : null}
            <button type="submit" className="good-button good-button--primary" disabled={busy || atLimit}>
              {editingId ? t('subscription.save') : t('subscription.add')}
            </button>
          </div>
        </form>

        <ul className="subscription-list">
          {subscriptions.length === 0 ? (
            <li className="subscription-list__empty">{t('subscription.empty')}</li>
          ) : (
            subscriptions.map((item) => (
              <li key={item.id} className="subscription-list__row">
                <span className="subscription-list__dot" style={{ background: item.color }} aria-hidden="true" />
                <span className="subscription-list__name">{item.name}</span>
                <span className={`subscription-list__status is-${item.lastStatus ?? 'never'}`}>{statusText(item)}</span>
                <span className="subscription-list__tools">
                  <button className="good-icon-button" aria-label={t('subscription.refresh')} disabled={busy} onClick={() => void refresh(item.id)}>
                    <RefreshCw aria-hidden="true" />
                  </button>
                  <button className="good-icon-button" aria-label={t('subscription.edit', { name: item.name })} disabled={busy} onClick={() => beginEdit(item)}>
                    ✎
                  </button>
                  <button className="good-icon-button" aria-label={t('subscription.delete', { name: item.name })} disabled={busy} onClick={() => setConfirmDelete({ id: item.id, name: item.name })}>
                    ✕
                  </button>
                </span>
              </li>
            ))
          )}
        </ul>
      </Dialog>

      {confirmDelete ? (
        <ConfirmDialog
          title={t('subscription.deleteTitle', { name: confirmDelete.name })}
          body={t('subscription.deleteBody')}
          confirmLabel={t('subscription.delete', { name: confirmDelete.name })}
          busy={busy}
          onConfirm={() => void confirmRemoval()}
          onCancel={() => setConfirmDelete(null)}
        />
      ) : null}
    </>
  );
}
```

> `ConfirmDialog` 的确切 props（`body`/`confirmLabel`/`busy`/`onConfirm`/`onCancel`）执行前对照 `src/components/ConfirmDialog.tsx` 校正；`ColorPicker` 的 props（`value`/`onChange` 或需 `recentColors`）对照 `src/components/ColorPicker.tsx` 校正。图标按钮的 `✎`/`✕` 可换成 lucide 的 `Pencil`/`Trash2`（与 KanbanFieldManagerDialog 保持一致）。

在 `src/app/styles.css` 末尾加最小样式：

```css
.subscription-form { display: flex; flex-direction: column; gap: 12px; }
.subscription-form__actions { display: flex; justify-content: flex-end; gap: 8px; }
.subscription-form__hint { color: var(--text-muted); font-size: 0.85rem; }
.subscription-list { list-style: none; margin: 16px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.subscription-list__empty { color: var(--text-muted); }
.subscription-list__row { display: flex; align-items: center; gap: 10px; }
.subscription-list__dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
.subscription-list__name { font-weight: 500; }
.subscription-list__status { margin-left: auto; color: var(--text-muted); font-size: 0.85rem; }
.subscription-list__status.is-failed { color: var(--danger, #c0563b); }
.subscription-list__tools { display: flex; gap: 4px; }
```

- [ ] **Step 4: 跑测试确认通过 + 类型检查**

Run: `cd /d/Codes/nowly && npx vitest run src/settings/SubscriptionManagerDialog.test.tsx && npx tsc --noEmit`
Expected: PASS，`tsc` 无错误。

- [ ] **Step 5: 提交**

```bash
git add src/settings/SubscriptionManagerDialog.tsx src/settings/SubscriptionManagerDialog.test.tsx src/i18n/translations.ts src/app/styles.css
git commit -m "feat: calendar subscription manager dialog"
```

---

### Task 4: Settings 入口按钮

在 `SettingsDialog` 加一个「日历订阅」入口，点击打开 `calendar-subscriptions` 模态。

**Files:**
- Modify: `src/settings/SettingsDialog.tsx`
- Modify: `src/i18n/translations.ts`

- [ ] **Step 1: 加 i18n**

```ts
    // zh
    'settings.calendarSubscriptions': '日历订阅',
    'settings.manageSubscriptions': '管理订阅',
```
```ts
    // en
    'settings.calendarSubscriptions': 'Calendar subscriptions',
    'settings.manageSubscriptions': 'Manage subscriptions',
```

- [ ] **Step 2: SettingsDialog 加入口 + prop**

`SettingsDialog` 的 `Props` 加 `onOpenSubscriptions?():void;`；在「桌面与启动」`section` 之后加：

```tsx
   <section><h3>{t('settings.calendarSubscriptions')}</h3>
    <button type="button" className="good-button" onClick={()=>props.onOpenSubscriptions?.()}>{t('settings.manageSubscriptions')}</button>
   </section>
```

> 因 `SettingsDialog` 用解构参数，把 `onOpenSubscriptions` 加进解构：`export function SettingsDialog({settings,monitors=[],onClose,onSave,onOpenSubscriptions}:Props)`，并在上面 JSX 用 `onOpenSubscriptions?.()`。

- [ ] **Step 3: ModalRoot / App 接线入口**

在 `ModalRoot.tsx` 的 settings 分支给 `SettingsDialog` 传：

```tsx
    {modal.type === 'settings' ? <SettingsDialog settings={settings} monitors={monitors} onClose={onClose} onSave={saveSettings} onOpenSubscriptions={() => onChangeModal({ type:'calendar-subscriptions', trigger:null })} /> : null}
```

- [ ] **Step 4: 类型检查 + 回归**

Run: `cd /d/Codes/nowly && npx tsc --noEmit && npx vitest run src/settings src/modals/ModalRoot.test.tsx`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/settings/SettingsDialog.tsx src/modals/ModalRoot.tsx src/i18n/translations.ts
git commit -m "feat: open subscription manager from settings"
```

---

### Task 5: 全量回归 + 里程碑更新

- [ ] **Step 1: 后端 + 前端全量**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Run: `cd /d/Codes/nowly && npx vitest run && npx tsc --noEmit && npm run build`
Expected: 全绿，构建成功。修任何回归。

- [ ] **Step 2: 更新 overview 里程碑**

把 `docs/superpowers/specs/2026-08-21-ics-calendar-overview.md` 中 C1–C8 相关条目标 ✅，追加「Spec C 完成」说明（订阅存储/解析/调度/前端全部落地，e2e 需 Tauri 后端按约定跳过）。

Run: `git add -f docs/superpowers/specs/2026-08-21-ics-calendar-overview.md docs/superpowers/plans/2026-08-21-ics-calendar-c4b-management-ui.md`
Run: `git commit -m "docs: mark Spec C subscription milestones complete"`

---

## 自检（对照 spec）

- 只读详情弹窗（标题/时间/时区/地点/描述/来源，无编辑删除关联）→ Task 1 ✅
- 点击订阅事件走只读而非编辑 → Task 2（App 分流）✅
- Settings「日历订阅」管理界面（列表 + 增删改 + 手动刷新 + 状态）→ Task 3 + Task 4 ✅
- 最多 3 个源 → Task 3（`atLimit` 禁用新增）✅
- 每源固定色（ColorPicker）→ Task 3 ✅
- 删除来源移除其事件（后端 cascade + 前端确认文案）→ Task 3 ConfirmDialog + Part 1 外键级联 ✅
- 刷新失败保留上次数据 + 状态标记 → Task 3 状态徽标 + Part 3 `mark_synced` ✅
- 刷新后日历自动更新 → Task 2（监听 `calendar-subscriptions-updated`）✅

**类型一致性：** `CalendarSubscription`/`SubscriptionDraft`（Part 1）、`ExternalEvent`/`externalToCalendarEvent`（Part 4a）、`refreshCalendarSubscription`（Part 3 命令）契约一致；模态 `external-detail`/`calendar-subscriptions` 与 App/ModalRoot 传参一致。
