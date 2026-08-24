# 日历订阅 Part 4a｜外部事件读取与月历呈现实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:executing-plans 逐任务执行本计划。步骤用 `- [ ]` 复选框跟踪。

**Goal:** 打通订阅事件的读取与展示：后端 `list_external_events_in_range` 命令把 `external_events`（含订阅颜色）转成设备显示钟面并按范围过滤，前端 `CalendarEvent` 增 `subscriptionId` 字段、把外部事件合入月历渲染（实心竖条 + 来源徽标 + 每源固定色），点击外部事件走只读详情弹窗而非编辑。

**Architecture:** 外部事件在 Part 3 已预展开为具体实例存入 `external_events`（窗口 ±6 月、已封顶），读取命令直接读全部行（数据量小）、用 Spec A 的 `to_display_wall` 换算成设备钟面、在设备钟面下按请求范围过滤，附带来源订阅的固定色。前端把 `ExternalEvent` 映射为带 `subscriptionId` 的 `CalendarEvent`，与本地事件合入同一数组走现成的 `layoutWeekRows` 渲染；渲染时按 `subscriptionId !== null` 加来源徽标、点击时路由到只读详情而非 `event-edit`。

**Tech Stack:** Rust（rusqlite + Spec A timezone）、Tauri command、TypeScript/React（CalendarWidget、useEvents、DateDetailDialog、App 路由）。

---

### Task 1: `to_display_wall` 提升为 crate 可见

Part 4a 的读取命令要复用 events.rs 里的显示钟面换算。当前它是私有 `fn`。

**Files:**
- Modify: `src-tauri/src/events.rs:136`

- [ ] **Step 1: 改可见性**

把 `src-tauri/src/events.rs` 中：

```rust
fn to_display_wall(wall: &str, tz: &Option<String>) -> String {
```

改为：

```rust
pub(crate) fn to_display_wall(wall: &str, tz: &Option<String>) -> String {
```

- [ ] **Step 2: 构建确认无破坏**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: 成功（仅可见性变化）。

- [ ] **Step 3: 提交**

```bash
git add src-tauri/src/events.rs
git commit -m "refactor: expose to_display_wall to the crate for external events"
```

---

### Task 2: `ExternalEvent` 模型

**Files:**
- Modify: `src-tauri/src/models.rs`
- Test: `src-tauri/src/models.rs`（`mod tests`）

- [ ] **Step 1: 写失败测试**

在 `mod tests` 内追加（把 `ExternalEvent` 加进模块顶部 `use super::{...}`）：

```rust
    #[test]
    fn external_event_serializes_in_camel_case() {
        let ev = ExternalEvent {
            id: "x1".into(),
            subscription_id: "s1".into(),
            title: "会议".into(),
            start_at: "2026-08-10T18:00".into(),
            end_at: "2026-08-10T19:00".into(),
            start_tz: Some("Asia/Shanghai".into()),
            end_tz: Some("Asia/Shanghai".into()),
            all_day: false,
            location: Some("会议室".into()),
            description: None,
            color: "#4FC9DA".into(),
        };
        let value = serde_json::to_value(&ev).expect("serializes");
        let object = value.as_object().unwrap();
        assert_eq!(object.get("subscriptionId"), Some(&json!("s1")));
        assert_eq!(object.get("startTz"), Some(&json!("Asia/Shanghai")));
        assert_eq!(object.get("allDay"), Some(&Value::Bool(false)));
        for snake in ["subscription_id", "start_at", "start_tz", "all_day"] {
            assert!(!object.contains_key(snake), "{snake} 不应出现在契约里");
        }
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml external_event_serializes`
Expected: FAIL —— `ExternalEvent` 未定义。

- [ ] **Step 3: 实现**

在 `src-tauri/src/models.rs` 的 `CalendarSubscription` 结构之后加入：

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalEvent {
    pub id: String,
    pub subscription_id: String,
    pub title: String,
    /// 设备显示时区下的钟面起止（后端已换算），"%Y-%m-%dT%H:%M"。
    pub start_at: String,
    pub end_at: String,
    /// 来源事件的具名时区；浮动/全天为 None。供只读详情标注。
    pub start_tz: Option<String>,
    pub end_tz: Option<String>,
    pub all_day: bool,
    pub location: Option<String>,
    pub description: Option<String>,
    /// 来源订阅的固定色（hex）。
    pub color: String,
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml external_event_serializes`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/models.rs
git commit -m "feat: add ExternalEvent model"
```

---

### Task 3: `list_external_events_in_range` 命令

读全部 `external_events`（JOIN 订阅取颜色），把 `start_at`/`end_at`（来源系列时区钟面）经 `to_display_wall` 换算成设备钟面，再在设备钟面下按 `[range.start, range.end)` 过滤（与事件重叠即入选）。

**Files:**
- Modify: `src-tauri/src/subscriptions.rs`（读函数 + 命令）
- Modify: `src-tauri/src/main.rs`（注册命令）
- Test: `src-tauri/src/subscriptions.rs`

- [ ] **Step 1: 写失败测试**

在 `subscriptions.rs` 的 `mod tests` 内追加（`memory_db` 已在 Task 4/Part1 定义可复用；若本文件内尚无 `EventRange` 引入，测试内用字面构造）：

```rust
    use crate::models::EventRange;

    fn insert_external(
        connection: &Connection,
        sub: &str,
        id: &str,
        start_at: &str,
        end_at: &str,
        start_tz: Option<&str>,
    ) {
        connection
            .execute(
                "INSERT INTO external_events
                    (id,subscription_id,start_at,end_at,start_tz,end_tz,all_day,title,last_synced_at)
                 VALUES (?1,?2,?3,?4,?5,?5,0,'会议','t')",
                rusqlite::params![id, sub, start_at, end_at, start_tz],
            )
            .unwrap();
    }

    #[test]
    fn list_external_in_range_filters_and_attaches_color() {
        let mut connection = memory_db();
        // 订阅 s1 固定色。
        let s1 = create(&mut connection, draft()).unwrap();
        // 浮动事件：8/10 在窗口内，9/20 在窗口外。
        insert_external(&connection, &s1.id, "a", "2026-08-10T10:00", "2026-08-10T11:00", None);
        insert_external(&connection, &s1.id, "b", "2026-09-20T10:00", "2026-09-20T11:00", None);

        let range = EventRange {
            start_at: "2026-08-01T00:00".into(),
            end_at_exclusive: "2026-09-01T00:00".into(),
        };
        let events = list_external_in_range(&connection, &range).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].id, "a");
        assert_eq!(events[0].color, s1.color);
        assert_eq!(events[0].subscription_id, s1.id);
    }

    #[test]
    fn list_external_in_range_converts_tz_to_device_wall() {
        // 该测试断言换算发生：带时区事件的 start_at 会被 to_display_wall 处理。
        // 设备时区不确定，这里只验证「带 TZID 的事件仍能按其换算后的钟面参与过滤」，
        // 用一个足够宽的范围确保命中，且颜色/来源正确。
        let mut connection = memory_db();
        let s1 = create(&mut connection, draft()).unwrap();
        insert_external(
            &connection,
            &s1.id,
            "t",
            "2026-08-10T10:00",
            "2026-08-10T11:00",
            Some("Asia/Shanghai"),
        );
        let range = EventRange {
            start_at: "2026-08-01T00:00".into(),
            end_at_exclusive: "2026-09-01T00:00".into(),
        };
        let events = list_external_in_range(&connection, &range).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].start_tz.as_deref(), Some("Asia/Shanghai"));
    }
```

> 注：`draft()` 已在 Part 1 Task 3 的 `mod tests` 内定义；本 Task 复用。若因 Part 1/4a 测试合并导致重复 `use`，去重即可。

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml list_external_in_range`
Expected: FAIL —— `list_external_in_range` 未定义。

- [ ] **Step 3: 实现**

在 `subscriptions.rs` 顶部 `use` 区加入（若尚未有）：

```rust
use crate::models::{CalendarSubscription, ExternalEvent, EventRange, SubscriptionDraft};
```

> 把原有 `use crate::models::{CalendarSubscription, SubscriptionDraft};` 合并为上面一行。

在 `delete` 函数之后、`#[tauri::command]` 区之前加入：

```rust
/// 读取与 `[range.start, range.end_at_exclusive)`（设备钟面）重叠的外部事件，
/// 附带来源订阅的固定色。start_at/end_at 已换算成设备显示钟面。
pub fn list_external_in_range(
    connection: &Connection,
    range: &EventRange,
) -> Result<Vec<ExternalEvent>, CommandError> {
    let sql = "SELECT e.id, e.subscription_id, e.title, e.start_at, e.end_at,
                      e.start_tz, e.end_tz, e.all_day, e.location, e.description, s.color
               FROM external_events e
               JOIN calendar_subscriptions s ON s.id = e.subscription_id";
    let mut statement = connection.prepare(sql).map_err(CommandError::database)?;
    let rows = statement
        .query_map([], |row| {
            let start_tz: Option<String> = row.get(5)?;
            let end_tz: Option<String> = row.get(6)?;
            let start_raw: String = row.get(3)?;
            let end_raw: String = row.get(4)?;
            Ok(ExternalEvent {
                id: row.get(0)?,
                subscription_id: row.get(1)?,
                title: row.get(2)?,
                start_at: crate::events::to_display_wall(&start_raw, &start_tz),
                end_at: crate::events::to_display_wall(&end_raw, &end_tz),
                start_tz,
                end_tz,
                all_day: row.get::<_, i64>(7)? == 1,
                location: row.get(8)?,
                description: row.get(9)?,
                color: row.get(10)?,
            })
        })
        .map_err(CommandError::database)?;

    let mut out = Vec::new();
    for row in rows {
        let event = row.map_err(CommandError::database)?;
        // 设备钟面下与范围重叠：event.start < range.end 且 event.end > range.start。
        // 全天/单点用 start 落在范围内近似（end==start 时用 >= start 判断）。
        let overlaps = event.start_at < range.end_at_exclusive
            && (event.end_at > range.start_at || event.end_at == event.start_at && event.start_at >= range.start_at);
        if overlaps {
            out.push(event);
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn list_external_events_in_range(
    db: State<'_, AppDb>,
    range: EventRange,
) -> Result<Vec<ExternalEvent>, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    list_external_in_range(&connection, &range)
}
```

在 `src-tauri/src/main.rs` 的 `generate_handler!` 列表里，`subscription_sync::refresh_calendar_subscription,` 之后加：

```rust
            subscriptions::list_external_events_in_range,
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml subscriptions:: && cargo build --manifest-path src-tauri/Cargo.toml`
Expected: PASS，构建成功。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/subscriptions.rs src-tauri/src/main.rs
git commit -m "feat: list external events in range with source color"
```

---

### Task 4: 前端 `CalendarEvent` 增 `subscriptionId` + 外部事件映射

**Files:**
- Modify: `src/calendar/subscription-model.ts`（加 `ExternalEvent` 类型 + `externalToCalendarEvent`）
- Modify: `src/calendar/calendar-model.ts`（`CalendarEvent` 加 `subscriptionId`）
- Test: `src/calendar/subscription-model.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

创建 `src/calendar/subscription-model.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { externalToCalendarEvent, type ExternalEvent } from './subscription-model';

describe('externalToCalendarEvent', () => {
  const external: ExternalEvent = {
    id: 'x1',
    subscriptionId: 's1',
    title: '团队周会',
    startAt: '2026-08-10T18:00',
    endAt: '2026-08-10T19:00',
    startTz: 'Asia/Shanghai',
    endTz: 'Asia/Shanghai',
    allDay: false,
    location: '会议室',
    description: '议程',
    color: '#4FC9DA'
  };

  it('maps an external event into a read-only CalendarEvent', () => {
    const event = externalToCalendarEvent(external);
    expect(event.id).toBe('x1');
    expect(event.subscriptionId).toBe('s1');
    expect(event.title).toBe('团队周会');
    expect(event.startAt).toBe('2026-08-10T18:00');
    expect(event.color).toBe('#4FC9DA');
    // 只读事件不参与重复/关联/提醒逻辑。
    expect(event.recurrence).toBeNull();
    expect(event.linkedTaskId).toBeNull();
    expect(event.reminders).toEqual([]);
    // note 承载地点/描述，供只读详情展示。
    expect(event.note).toContain('会议室');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /d/Codes/nowly && npx vitest run src/calendar/subscription-model.test.ts`
Expected: FAIL —— `externalToCalendarEvent`/`ExternalEvent` 未导出。

- [ ] **Step 3: 实现**

在 `src/calendar/calendar-model.ts` 的 `CalendarEvent` 类型内，`isOverridden: boolean;` 之前加入：

```ts
  // Non-null when this event comes from a read-only calendar subscription; the
  // value is the source subscription id. Local events are always null.
  subscriptionId: string | null;
```

在 `src/calendar/subscription-model.ts` 末尾加入：

```ts
import type { CalendarEvent, EventCategory } from './calendar-model';

export type ExternalEvent = {
  id: string;
  subscriptionId: string;
  title: string;
  startAt: string;
  endAt: string;
  startTz: string | null;
  endTz: string | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
  color: HexColor;
};

// External subscription events reuse the calendar rendering pipeline, so map
// each into a read-only CalendarEvent. They carry no recurrence/link/reminder
// semantics; `note` holds location + description for the read-only detail popup.
export function externalToCalendarEvent(external: ExternalEvent): CalendarEvent {
  const noteParts = [external.location, external.description].filter(
    (part): part is string => !!part && part.length > 0
  );
  return {
    id: external.id,
    title: external.title,
    startAt: external.startAt,
    endAt: external.endAt,
    allDay: external.allDay,
    // Subscription events have a fixed source color, not a category color; use a
    // neutral category so category-based styling never fights the source color.
    category: 'personal' as EventCategory,
    color: external.color,
    linkedTaskId: null,
    note: noteParts.join('\n'),
    reminders: [],
    createdAt: '',
    updatedAt: '',
    recurrence: null,
    startTz: external.startTz,
    endTz: external.endTz,
    rrule: null,
    seriesId: null,
    seriesStartAt: null,
    occurrenceStartAt: null,
    isOverridden: false,
    subscriptionId: external.subscriptionId
  };
}
```

在 `src/calendar/calendar-model.ts` 内所有构造 `CalendarEvent` 的地方无需改（本地事件由后端返回，且后端 `Event` 也要加 `subscription_id: None` 序列化——见 Step 3b）。

- [ ] **Step 3b: 后端 `Event` 增 `subscription_id`（恒为 None）**

前端 `CalendarEvent` 现有非可选 `subscriptionId`，本地事件经 IPC 返回的 `Event` 必须带该键。修改 `src-tauri/src/models.rs` 的 `Event` 结构，在 `is_overridden` 字段之后加：

```rust
    /// 本地事件恒为 None；仅订阅来源的 ExternalEvent 才有值。为保持前端
    /// CalendarEvent 契约统一，本地事件也序列化出显式 null。
    #[serde(default)]
    pub subscription_id: Option<String>,
```

在 `src-tauri/src/events.rs` 的 `event_from_series_row` 里，`Event { ... is_overridden: false, }` 构造末尾加 `subscription_id: None,`。同时 `models.rs` 测试 `fn event()` 的构造末尾加 `subscription_id: None,`。执行时 `grep -n "is_overridden: false" src-tauri/src/events.rs src-tauri/src/models.rs` 找到全部构造点补齐。

- [ ] **Step 4: 跑测试确认通过 + 类型检查 + 后端构建**

Run: `cd /d/Codes/nowly && npx vitest run src/calendar/subscription-model.test.ts && npx tsc --noEmit`
Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: 前端 PASS、`tsc` 报若干「构造 CalendarEvent 缺 subscriptionId」错误 —— 逐一在测试/示例数据构造处补 `subscriptionId: null`（`grep -rn "occurrenceStartAt: null" src` 附近的工厂与固定装置）。补齐后 `tsc` 与 `cargo build` 均通过。

具体需补 `subscriptionId: null` 的前端构造点（与 Spec A Part 4 同批文件）：
- `src/lib/sample-data.ts`
- `src/lib/recurrence.test.ts`、`src/calendar/useEvents.test.tsx`、`src/lib/event-draft.test.ts`
- `src/matrix/TaskRow.test.tsx`、`src/modals/TaskModal.test.tsx`、`src/modals/EventModal.test.tsx`
- `src/calendar/DateDetailDialog.test.tsx`、`src/calendar/calendar-view.test.ts`

- [ ] **Step 5: 提交**

```bash
git add src/calendar/subscription-model.ts src/calendar/subscription-model.test.ts src/calendar/calendar-model.ts src-tauri/src/models.rs src-tauri/src/events.rs src/lib/sample-data.ts src/lib/recurrence.test.ts src/calendar/useEvents.test.tsx src/lib/event-draft.test.ts src/matrix/TaskRow.test.tsx src/modals/TaskModal.test.tsx src/modals/EventModal.test.tsx src/calendar/DateDetailDialog.test.tsx src/calendar/calendar-view.test.ts
git commit -m "feat: add subscriptionId to CalendarEvent and external event mapping"
```

---

### Task 5: 仓储读取外部事件 + `useEvents` 合并

**Files:**
- Modify: `src/data/nowly-repository.ts`、`src/data/tauri-nowly-repository.ts`
- Modify: `src/calendar/useEvents.ts`
- Test: `src/data/tauri-nowly-repository.test.ts`、`src/calendar/useEvents.test.tsx`

- [ ] **Step 1: 写失败测试（仓储契约）**

在 `src/data/tauri-nowly-repository.test.ts` 第一个 `it` 内，订阅调用区加：

```ts
    await tauriNowlyRepository.listExternalEventsInRange(range);
```

断言区加：

```ts
    expect(invokeMock.mock.calls).toContainEqual(['list_external_events_in_range', { range }]);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /d/Codes/nowly && npx vitest run src/data/tauri-nowly-repository.test.ts`
Expected: FAIL —— `listExternalEventsInRange` 不存在。

- [ ] **Step 3: 实现仓储 + 合并**

在 `src/data/nowly-repository.ts` 顶部 import 补 `ExternalEvent`：

```ts
import type { CalendarSubscription, ExternalEvent, SubscriptionDraft } from '../calendar/subscription-model';
```

`NowlyRepository` 接口内（订阅 CRUD 之后）加：

```ts
  listExternalEventsInRange: (range: EventRange) => Promise<ExternalEvent[]>;
```

`src/data/tauri-nowly-repository.ts` 对象内（订阅 CRUD 之后）加：

```ts
  listExternalEventsInRange: (range) => invoke('list_external_events_in_range', { range }),
```

在 `src/calendar/useEvents.ts` 的 `loadEvents` 内，把本地事件与外部事件**并行读取并合并**。替换 `loadEvents` 的 `try` 块：

```ts
      try {
        const targetRange = rangeFor(target.view, target.anchor, weekStart);
        const [local, external] = await Promise.all([
          repository.listEventsInRange(targetRange),
          repository.listExternalEventsInRange(targetRange).catch(() => [])
        ]);
        const merged = [...local, ...external.map(externalToCalendarEvent)];
        if (requestId === requestIdRef.current) setEvents({ status: 'ready', data: merged });
      } catch (error) {
        if (requestId === requestIdRef.current) {
          setEvents({ status: 'error', data: [], message: messageFrom(error) });
        }
      }
```

并在 `useEvents.ts` 顶部 import 补：

```ts
import { externalToCalendarEvent } from './subscription-model';
```

> 外部事件读取失败用 `.catch(() => [])` 降级为空，确保订阅问题不影响本地日程展示（符合 spec「不弹全局报错」）。

- [ ] **Step 4: 写 useEvents 合并测试**

在 `src/calendar/useEvents.test.tsx` 内新增一个用例（复用其现有 render/mock 模式；若该文件用 `createRepository` 工厂，给 `listExternalEventsInRange` 传返回一个外部事件的 mock）：

```tsx
  it('merges external subscription events into the calendar data', async () => {
    const external = [{
      id: 'x1', subscriptionId: 's1', title: '订阅会议',
      startAt: '2026-08-10T18:00', endAt: '2026-08-10T19:00',
      startTz: null, endTz: null, allDay: false,
      location: null, description: null, color: '#4FC9DA'
    }];
    const repository = makeRepository({
      listEventsInRange: vi.fn().mockResolvedValue([]),
      listExternalEventsInRange: vi.fn().mockResolvedValue(external)
    });
    const { result } = renderUseEvents(repository);
    await waitFor(() => expect(result.current.events.status).toBe('ready'));
    expect(result.current.events.data).toHaveLength(1);
    expect(result.current.events.data[0].subscriptionId).toBe('s1');
  });
```

> `makeRepository`/`renderUseEvents` 的确切名称取该测试文件现有辅助（执行前 `grep -n "function.*[Rr]epository\|renderHook\|render(" src/calendar/useEvents.test.tsx` 对齐）。若该文件的其它用例未 mock `listExternalEventsInRange`，给其共享 mock 仓储补一个默认 `listExternalEventsInRange: vi.fn().mockResolvedValue([])`，避免 `undefined` 调用。

- [ ] **Step 5: 跑测试确认通过 + 类型检查**

Run: `cd /d/Codes/nowly && npx vitest run src/data/tauri-nowly-repository.test.ts src/calendar/useEvents.test.tsx && npx tsc --noEmit`
Expected: PASS，`tsc` 无错误。

- [ ] **Step 6: 提交**

```bash
git add src/data/nowly-repository.ts src/data/tauri-nowly-repository.ts src/data/tauri-nowly-repository.test.ts src/calendar/useEvents.ts src/calendar/useEvents.test.tsx
git commit -m "feat: read and merge external subscription events into calendar"
```

---

### Task 6: 月历来源徽标 + 只读点击路由

**Files:**
- Modify: `src/calendar/CalendarWidget.tsx`（渲染徽标 + 屏蔽外部事件拖拽）
- Modify: `src/app/App.tsx`（外部事件点击路由到只读详情）
- Modify: `src/app/styles.css`（徽标样式）
- Test: `src/calendar/CalendarWidget.test.tsx`

- [ ] **Step 1: 写失败测试**

在 `src/calendar/CalendarWidget.test.tsx` 内新增用例（复用其现有渲染辅助，传入一个 `subscriptionId` 非空的事件）：

```tsx
  it('marks external subscription events with a source badge', () => {
    const external = makeEvent({
      id: 'x1', title: '订阅会议', subscriptionId: 's1',
      startAt: '2026-08-10T10:00', endAt: '2026-08-10T11:00'
    });
    renderCalendar({ events: [external] });
    // 徽标以 aria-label 标记来源，便于无障碍与测试定位。
    expect(screen.getByLabelText('订阅日历')).toBeInTheDocument();
  });
```

> `makeEvent`/`renderCalendar` 用该测试文件现有工厂名（执行前 `grep -n "function make\|render(" src/calendar/CalendarWidget.test.tsx` 对齐）；确保工厂默认 `subscriptionId: null`。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /d/Codes/nowly && npx vitest run src/calendar/CalendarWidget.test.tsx`
Expected: FAIL —— 无 `订阅日历` 标签。

- [ ] **Step 3: 实现徽标 + i18n**

在 `src/i18n/translations.ts` 的 `zh` 与 `en` 字典各加一键（放日历相关键附近）：

```ts
    // zh
    'calendar.externalBadge': '订阅日历',
```
```ts
    // en
    'calendar.externalBadge': 'Subscribed calendar',
```

在 `src/calendar/CalendarWidget.tsx` 里，找到渲染事件标题的两处 `<span className="event__title">{repeatMark(event)}{event.title}</span>`（`renderSegmentBar` 与 `renderCellEvent` 内），在 `{event.title}` 之后插入徽标：

```tsx
        <span className="event__title">{repeatMark(event)}{event.title}</span>
        {event.subscriptionId ? (
          <span className="event__source-badge" aria-label={t('calendar.externalBadge')} />
        ) : null}
```

> `t` 已在该文件 import（`repeatMark` 等已用 `t`）；若无则从 `../i18n` 引入 `t`。

若 `CalendarWidget` 内已有拖拽/缩放启用判断（如 `onMoveEvent && ...`），对 `event.subscriptionId !== null` 的事件禁用拖拽把手：在 `renderSegmentBar`/`renderCellEvent` 的 pointer-down 绑定处加保护——若存在 `startMove`/`beginDrag` 之类回调，包一层 `if (event.subscriptionId) return;`。执行前 `grep -n "onPointerDown\|startMove\|beginDrag\|movable" src/calendar/CalendarWidget.tsx` 定位；无把手则跳过。

- [ ] **Step 3b: 外部事件点击走只读详情**

在 `src/app/App.tsx` 的 `onOpenEvent`（第 163 行附近）改为按来源分流：

```tsx
        onOpenEvent={(event) =>
          event.subscriptionId
            ? openModalInForeground({ type: 'external-detail', event, trigger: null })
            : openModalInForeground({ type: 'event-edit', event, trigger: null })
        }
```

`external-detail` 模态在 Part 4b 落地（只读详情弹窗）。本 Task 先只加分流；若 Part 4b 尚未实现该模态，临时回退为复用现有只读展示或 `event-edit`——但推荐直接按顺序先做 4b 再回填此分流。**执行顺序建议：Task 6 的 Step 3b 延后到 Part 4b Task「只读详情弹窗」落地后再接。** 本 Task 提交时可仅含徽标 + 拖拽屏蔽。

- [ ] **Step 3c: 徽标样式**

在 `src/app/styles.css` 里，`.event__title` 规则附近加：

```css
.event__source-badge {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.55;
  vertical-align: middle;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /d/Codes/nowly && npx vitest run src/calendar/CalendarWidget.test.tsx && npx tsc --noEmit`
Expected: PASS，`tsc` 无错误（`external-detail` 若引发类型错误，暂缓 Step 3b 到 4b）。

- [ ] **Step 5: 提交**

```bash
git add src/calendar/CalendarWidget.tsx src/calendar/CalendarWidget.test.tsx src/app/styles.css src/i18n/translations.ts
git commit -m "feat: source badge for external subscription events in month view"
```

---

## 自检（写完计划后对照 spec）

**Spec 覆盖：**
- 订阅事件在月历上的呈现：实心竖条 + 来源徽标 → Task 6（复用现成竖条渲染 + 加徽标）✅
- 颜色取订阅源固定色 → Task 3（读取 JOIN 颜色）+ Task 4（映射进 color）✅
- 时区映射（带 TZID 显示为设备时区）→ Task 3（`to_display_wall`）✅
- 订阅事件只读（点击不进编辑）→ Task 6 Step 3b（分流到 `external-detail`，详情弹窗在 4b）✅
- 展开窗口读取（±6 月已在 Part 3 写入，本 Part 只读并按可视范围过滤）✅

**本 Part 不覆盖（Part 4b）：**
- 只读详情弹窗组件（`external-detail` 模态）
- Settings「日历订阅」管理界面（tab + 列表 + 增删改 + 手动刷新 + 状态）

**类型一致性：** `ExternalEvent`（Rust camelCase ↔ TS）字段一致；`CalendarEvent.subscriptionId` 前后端一致（后端 `Event.subscription_id` 恒 None）；命令 `list_external_events_in_range` 参数 `{ range }`、返回 `ExternalEvent[]`；`externalToCalendarEvent` 产出的 `CalendarEvent` 满足全字段。`to_display_wall` 已在 Task 1 提升为 `pub(crate)`。
