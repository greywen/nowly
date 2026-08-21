# ICS 日历 · Spec A 实现计划 · Part 4：提醒时区适配与前端模型/渲染

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让提醒轮询在新的 per-event 时区模型下计算正确的触发时刻，并让前端 `CalendarEvent` 模型承载新的时区字段（`startTz`/`endTz`/`rrule`），使带时区事件按设备时区显示钟点、可在详情里标注来源时区。

**Architecture:** 本 Part 是 Spec A 的收尾。后端提醒层（`reminders.rs`）改为按事件时区把钟面换算成 UTC 瞬时点再比较；前端类型层（`calendar-model.ts`）新增三个字段并保持向后兼容。由于 Part 3b 的读取路径已把 `startAt`/`endAt` 下发为「设备时区显示钟面」，前端月历渲染无需改动——它读到的钟点已是正确的显示值；本 Part 前端改动集中在类型定义与详情标注。

**Tech Stack:** Rust、`chrono`/`chrono-tz`、`cargo test`；TypeScript、React、Vitest。

> 本计划是 Spec A（`docs/superpowers/specs/2026-08-21-ics-calendar-a-engine-storage-design.md`）四份实现计划的第四份，前置 Part 1–3b 必须已落地。总览与进度见 `docs/superpowers/specs/2026-08-21-ics-calendar-overview.md`。

---

## 前置约定（来自 Part 1–3b）

本 Part 依赖前三部分已经落地的成果，直接引用不再重复实现：

- `timezone::parse_tz`、`timezone::wall_to_utc`、`timezone::utc_to_wall`、`timezone::device_tz`、`timezone::format_utc`（Part 1）。
- `Event` 结构已含 `start_tz: Option<String>`、`end_tz: Option<String>`、`rrule: Option<String>` 字段（Part 3a）。
- `list_in_range` 下发的 `Event.start_at`/`end_at` 已是**设备时区显示钟面**，而 `Event.start_tz`/`end_tz` 是事件自身时区（Part 3b）。
- 提醒去重表 `reminder_dispatches` 与 `Event.reminders` 字段（既有提醒功能）不变。

关键语义：`list_in_range` 返回的 `start_at` 已经是设备时区钟面，因此提醒层若直接用它按设备时区解释瞬时点，对**带时区事件**与**浮动事件**都恰好正确——带时区事件已换算到设备钟面，浮动事件本就按设备时区解释。这一致性是本 Part 提醒改造的基础。

---

## 文件结构

- 修改：`src-tauri/src/reminders.rs` —— `due_reminders` 的到期判定改为在设备时区下把钟面换算成 UTC 瞬时点再比较，避免 DST 边界或跨时区事件的分钟数漂移。
- 修改：`src/calendar/calendar-model.ts` —— `CalendarEvent` 新增 `startTz`/`endTz`/`rrule` 三个字段。
- 修改：`src/calendar/DateDetailDialog.tsx` —— 详情弹窗对带时区事件标注来源时区。
- 修改：`src/data/tauri-nowly-repository.ts` 及其测试 —— 若映射层显式列举字段，则补齐新字段（否则仅补测试夹具）。

---

## Task 1：提醒到期判定改为按设备时区比较瞬时点

现有 `due_reminders` 把 `start_at` 与 `now` 都当作裸 `NaiveDateTime` 直接相减。在新模型下这仍然可用（因为 `start_at` 已是设备钟面、`now` 也取设备钟面），但为了让「提前 N 分钟」在 DST 边界两侧精确，应把两者都换算成 UTC 瞬时点再相减——跨越 DST 断层的「提前 30 分钟」用裸钟面相减会偏移一小时。

**Files:**
- Modify: `src-tauri/src/reminders.rs`

- [ ] **Step 1: 写失败测试（DST 边界前的提前量精确性）**

在 `reminders.rs` 的 `mod tests` 内加入。纽约 2026-03-08 春跳（02:00→03:00）。一个 03:15 开始、提前 30 分钟的提醒，其触发瞬时点应是 02:45 EST 之前的真实 UTC 时刻，而非裸钟面 02:45（该钟面不存在）：

```rust
    #[test]
    fn timed_reminder_offset_is_exact_across_a_dst_gap() {
        // 纽约春跳日，事件 03:15 EDT 开始，绑定 America/New_York，提前 30 分钟。
        // 03:15 EDT = 07:15Z；提前 30 分钟的触发瞬时点 = 06:45Z。
        // 该瞬时点在设备(此处按 UTC 测试)下不应因裸钟面 02:45 不存在而错乱。
        let ev = Event {
            start_at: "2026-03-08T03:15".into(),
            end_at: "2026-03-08T04:15".into(),
            start_tz: Some("America/New_York".into()),
            end_tz: Some("America/New_York".into()),
            reminders: vec![30],
            ..event("2026-03-08T03:15", vec![30])
        };
        // now = 06:45Z 对应设备(UTC)钟面 06:45。到点应触发。
        let due = due_reminders_utc(&[ev.clone()], dt("2026-03-08T06:45"), Duration::minutes(GRACE_MINUTES), chrono_tz::Tz::UTC);
        assert_eq!(due.len(), 1, "触发瞬时点必须按事件时区精确换算");
    }
```

> 说明：本测试引入一个按 UTC 设备时区显式测试的新入口 `due_reminders_utc`，把「设备时区」作为参数注入，使测试不依赖运行环境的真实时区。`event(..)` 夹具与 `dt(..)` 已存在于该测试模块。

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml reminders::tests::timed_reminder_offset_is_exact_across_a_dst_gap`
Expected: 编译失败，`cannot find function due_reminders_utc`，且 `Event` 初始化字段 `start_tz`/`end_tz` 若夹具未含会提示缺字段（Part 3a 已加字段，夹具需补）。

- [ ] **Step 3: 更新 event 夹具补齐时区字段**

在 `mod tests` 的 `event` 辅助函数里，为返回的 `Event` 补上两个字段（默认浮动）：

```rust
    fn event(start_at: &str, reminders: Vec<i64>) -> Event {
        Event {
            id: "e1".into(),
            title: "评审".into(),
            start_at: start_at.into(),
            end_at: start_at.into(),
            all_day: false,
            category: "work".into(),
            color: "#4FC9DA".into(),
            linked_task_id: None,
            note: String::new(),
            reminders,
            created_at: "t".into(),
            updated_at: "t".into(),
            recurrence: None,
            start_tz: None,
            end_tz: None,
            rrule: None,
            series_id: None,
            series_start_at: None,
            occurrence_start_at: None,
            is_overridden: false,
        }
    }
```

> 若 Part 3a 已移除 `Event.recurrence` 字段并以 `rrule` 取代，则此处删去 `recurrence: None,` 一行、保留 `rrule: None,`。以 Part 3a 落地后的实际 `Event` 定义为准。

- [ ] **Step 4: 实现按设备时区换算的到期判定**

在 `reminders.rs` 顶部 `use` 区加入对时区层的引用：

```rust
use crate::timezone;
use chrono_tz::Tz;
```

把现有 `due_reminders` 改写为在给定设备时区下把钟面换算成 UTC 瞬时点再比较，并保留一个取真实设备时区的薄封装：

```rust
/// 把一条事件实例的显示钟面（`start_at`，已是设备时区钟面）在设备时区下换算成 UTC 瞬时点。
/// 事件自身是否带时区不影响这里——`start_at` 已由读取路径统一成设备钟面。
fn instant_of(start_at: &str, device: Tz) -> Option<chrono::DateTime<chrono::Utc>> {
    let wall = NaiveDateTime::parse_from_str(start_at, LOCAL_MINUTE_FORMAT).ok()?;
    Some(timezone::wall_to_utc(wall, device))
}

/// 在指定设备时区下挑出到期提醒。触发判定在 UTC 瞬时点上进行，
/// 使「提前 N 分钟」在 DST 边界两侧精确。
pub fn due_reminders_utc(
    events: &[Event],
    now_wall: NaiveDateTime,
    grace: Duration,
    device: Tz,
) -> Vec<DueReminder> {
    let now = timezone::wall_to_utc(now_wall, device);
    let mut due = Vec::new();
    for event in events {
        if event.reminders.is_empty() {
            continue;
        }
        let Some(start) = instant_of(&event.start_at, device) else {
            continue;
        };
        for &offset in &event.reminders {
            if offset < 0 {
                continue;
            }
            let fire_time = start - Duration::minutes(offset);
            if fire_time <= now && now < start + grace {
                let (event_id, occurrence_start_at) = dispatch_identity(event);
                due.push(DueReminder {
                    event_id,
                    occurrence_start_at,
                    offset_minutes: offset,
                    title: event.title.clone(),
                    start_at: event.start_at.clone(),
                    all_day: event.all_day,
                });
            }
        }
    }
    due
}

/// 取真实设备时区的到期判定入口，供 `poll_due` 使用。
pub fn due_reminders(events: &[Event], now_wall: NaiveDateTime, grace: Duration) -> Vec<DueReminder> {
    due_reminders_utc(events, now_wall, grace, timezone::device_tz())
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml reminders::tests`
Expected: PASS。新增的 DST 测试通过，既有的 `fires_exactly_when_the_offset_is_reached` 等测试在 UTC/无 DST 场景下行为不变（裸钟面相减与 UTC 相减在无 DST 时等价）。

> 若既有测试在真实设备时区（非 UTC）下运行导致偏移，改用 `due_reminders_utc(.., Tz::UTC)` 显式注入 UTC，使这些行为测试与运行环境时区解耦。相应地把这些既有测试调用改为显式传 `Tz::UTC`。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/src/reminders.rs
git commit -m "feat: compute reminder fire times in UTC per device timezone"
```

---

## Task 2：前端 CalendarEvent 新增时区与 rrule 字段

**Files:**
- Modify: `src/calendar/calendar-model.ts`
- Test: `src/calendar/calendar-view.test.ts`（若已有 CalendarEvent 构造夹具）

- [ ] **Step 1: 写失败测试（类型字段存在且可选）**

在 `src/calendar/calendar-view.test.ts` 末尾加入一个纯类型/构造断言（用运行时对象验证字段被携带）：

```ts
import { describe, it, expect } from 'vitest';
import type { CalendarEvent } from './calendar-model';

describe('CalendarEvent timezone fields', () => {
  it('carries startTz, endTz and rrule (nullable)', () => {
    const tzBound: CalendarEvent = {
      id: 'e1',
      title: '跨时区会议',
      startAt: '2026-08-03T10:00',
      endAt: '2026-08-03T11:00',
      allDay: false,
      category: 'work',
      color: '#4FC9DA',
      linkedTaskId: null,
      note: '',
      reminders: [],
      createdAt: 't',
      updatedAt: 't',
      recurrence: null,
      startTz: 'Asia/Shanghai',
      endTz: 'Asia/Shanghai',
      rrule: null,
      seriesId: null,
      seriesStartAt: null,
      occurrenceStartAt: null,
      isOverridden: false
    };
    expect(tzBound.startTz).toBe('Asia/Shanghai');

    const floating: CalendarEvent = { ...tzBound, startTz: null, endTz: null };
    expect(floating.startTz).toBeNull();
  });
});
```

> 若 Part 3a 已在前端把 `recurrence` 字段替换为 `rrule`，删去上面的 `recurrence: null,` 一行。以 Part 3a 落地后的 `CalendarEvent` 为准。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/calendar/calendar-view.test.ts`
Expected: 类型错误，`startTz`/`endTz`/`rrule` 不存在于 `CalendarEvent`。

- [ ] **Step 3: 在 CalendarEvent 加入字段**

打开 `src/calendar/calendar-model.ts`，在 `CalendarEvent` 类型定义中，于 `note` 与 `createdAt` 之间（或紧邻既有可空字段处）加入三个字段：

```ts
  // 事件自身的具名 IANA 时区；浮动/全天事件为 null。用于详情标注，不参与月历钟点渲染
  // （startAt/endAt 已是设备时区显示钟面）。
  startTz: string | null;
  endTz: string | null;
  // 标准 RFC 5545 RRULE 串；单次事件为 null。供详情展示与 Spec B 编辑 UI 使用。
  rrule: string | null;
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/calendar/calendar-view.test.ts`
Expected: PASS。

- [ ] **Step 5: 修复因新增必填字段而失败的其它构造点**

新增的是必填字段，既有测试与 `sample-data.ts` 中构造 `CalendarEvent` 的地方会报缺字段。

Run: `npx vitest run`
Expected: 若干文件报 `startTz`/`endTz`/`rrule` 缺失。逐个在这些构造点补上 `startTz: null, endTz: null, rrule: null`（本地样例默认浮动、非重复）。典型涉及：`src/lib/sample-data.ts`、`src/calendar/useEvents.test.tsx`、`src/modals/EventModal.test.tsx` 等。补齐后重跑至全绿。

- [ ] **Step 6: 提交**

```bash
git add src/calendar/calendar-model.ts src/calendar/calendar-view.test.ts src/lib/sample-data.ts
git commit -m "feat: add startTz, endTz, rrule fields to CalendarEvent"
```

---

## Task 3：详情弹窗标注来源时区

带时区事件在只读详情里标注其来源时区（如「(Asia/Shanghai)」），让用户理解该事件锚定在别的时区。浮动/全天事件不标注。

**Files:**
- Modify: `src/calendar/DateDetailDialog.tsx`
- Test: `src/calendar/DateDetailDialog.test.tsx`

- [ ] **Step 1: 写失败测试**

在 `src/calendar/DateDetailDialog.test.tsx` 内加入。断言带 `startTz` 的事件在弹窗中出现其时区文本，浮动事件不出现：

```tsx
  it('shows the source timezone for a tz-bound event', () => {
    const event: CalendarEvent = {
      ...baseEvent,
      startAt: '2026-08-03T10:00',
      endAt: '2026-08-03T11:00',
      startTz: 'Asia/Shanghai',
      endTz: 'Asia/Shanghai'
    };
    render(<DateDetailDialog date="2026-08-03" events={[event]} {...noopHandlers} />);
    expect(screen.getByText(/Asia\/Shanghai/)).toBeInTheDocument();
  });

  it('does not show a timezone for a floating event', () => {
    const event: CalendarEvent = {
      ...baseEvent,
      startAt: '2026-08-03T10:00',
      endAt: '2026-08-03T11:00',
      startTz: null,
      endTz: null
    };
    render(<DateDetailDialog date="2026-08-03" events={[event]} {...noopHandlers} />);
    expect(screen.queryByText(/Asia\/Shanghai/)).not.toBeInTheDocument();
  });
```

> `baseEvent` 与 `noopHandlers` 按该测试文件既有夹具命名调整；若文件用不同的渲染包装（如自带 provider），沿用其既有模式。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/calendar/DateDetailDialog.test.tsx`
Expected: 第一个测试 FAIL（时区文本未渲染）。

- [ ] **Step 3: 在详情项渲染时区标注**

打开 `src/calendar/DateDetailDialog.tsx`，找到渲染单条事件时间的位置（`event.startAt.slice(11, 16)` 附近）。在时间文本之后，当 `event.startTz` 非空时追加一段时区标注：

```tsx
                  <span className="date-detail-dialog__time">
                    {event.allDay ? t('calendar.allDay') : event.startAt.slice(11, 16)}
                  </span>
                  {event.startTz ? (
                    <span className="date-detail-dialog__tz">({event.startTz})</span>
                  ) : null}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/calendar/DateDetailDialog.test.tsx`
Expected: PASS（两个新测试均通过）。

- [ ] **Step 5: 为时区标注补最小样式（无动效，遵循 design.md）**

在 `src/app/styles.css` 中该弹窗样式附近，加入一条弱化的元信息样式（复用规范中的 `text-muted` 语义色、Caption 字号）：

```css
.date-detail-dialog__tz {
  margin-left: 8px;
  font-size: 0.85rem;
  color: #968e7e;
}
```

- [ ] **Step 6: 提交**

```bash
git add src/calendar/DateDetailDialog.tsx src/calendar/DateDetailDialog.test.tsx src/app/styles.css
git commit -m "feat: annotate source timezone in event detail dialog"
```

---

## Task 4：仓储映射层补齐新字段

若 `tauri-nowly-repository.ts` 的事件映射是显式逐字段拷贝，则需补齐 `startTz`/`endTz`/`rrule`；若是整体透传（`return raw as CalendarEvent`），则只需补测试夹具。

**Files:**
- Modify: `src/data/tauri-nowly-repository.ts`（视实现而定）
- Test: `src/data/tauri-nowly-repository.test.ts`

- [ ] **Step 1: 判定映射方式**

Run: `grep -n "startAt" src/data/tauri-nowly-repository.ts`
Expected: 观察 `listEventsInRange`/`createEvent` 的返回是否逐字段构造。

- [ ] **Step 2a: 若逐字段构造 —— 写失败测试并补字段**

在 `src/data/tauri-nowly-repository.test.ts` 中，为事件映射测试的期望对象补上 `startTz`/`endTz`/`rrule`，并在 mock 的 IPC 返回里带上这三个字段。运行确认失败：

Run: `npx vitest run src/data/tauri-nowly-repository.test.ts`
Expected: FAIL（映射结果缺字段）。

然后在 `tauri-nowly-repository.ts` 的事件映射处补上：

```ts
    startTz: raw.startTz ?? null,
    endTz: raw.endTz ?? null,
    rrule: raw.rrule ?? null,
```

- [ ] **Step 2b: 若整体透传 —— 仅补测试夹具**

在测试的 mock IPC 返回对象里补上 `startTz`/`endTz`/`rrule` 三个字段，确保夹具与新契约一致。

- [ ] **Step 3: 运行测试确认通过**

Run: `npx vitest run src/data/tauri-nowly-repository.test.ts`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add src/data/tauri-nowly-repository.ts src/data/tauri-nowly-repository.test.ts
git commit -m "feat: carry timezone fields through the repository mapping"
```

---

## Task 5：Part 4 收尾校验与全量回归

**Files:** 无（仅校验）

- [ ] **Step 1: 全量 Rust 测试通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全部通过，含改造后的 `reminders::tests` 与 Part 1–3b 的全部测试。

- [ ] **Step 2: 全量前端测试通过**

Run: `npx vitest run`
Expected: 全部通过。所有 `CalendarEvent` 构造点已补齐新字段。

- [ ] **Step 3: 前端类型检查与构建**

Run: `npm run build`
Expected: `tsc` 无类型错误，`vite build` 成功。

- [ ] **Step 4: 端到端冒烟（若环境可运行）**

Run: `npx playwright test`
Expected: 通过，或在无法运行 Tauri 后端的 CI 环境中按既有约定跳过。至少确认日历模块的既有 e2e 不因字段变更而回归失败。

- [ ] **Step 5: 更新总览进度**

在 `docs/superpowers/specs/2026-08-21-ics-calendar-overview.md` 的 Spec A 进度表中，把 `A7 | 提醒触发时刻按时区计算`、`A8 | 前端 CalendarEvent 模型与渲染适配`、`A9 | 测试全绿` 三项从 ⬜ 改为 ✅。至此 Spec A 全部里程碑完成，可在表头或备注标注「Spec A 完成」。提交：

```bash
git add docs/superpowers/specs/2026-08-21-ics-calendar-overview.md
git commit -m "docs: mark Spec A reminders and frontend milestones complete"
```

---

## Self-Review（对照 Spec A 与本 Part 目标）

- **Spec 覆盖**：本 Part 对应 Spec A 的「提醒」与「前端」两节。提醒触发时刻按事件/设备时区在 UTC 瞬时点上计算（覆盖 DST 边界精确性）；前端 `CalendarEvent` 新增 `startTz`/`endTz`/`rrule`，详情弹窗标注来源时区。范围查询、schema、RRULE 引擎属 Part 1–3b。✅
- **占位符扫描**：无 TBD/TODO。凡「视 Part 3a 实际定义而定」处均给出二选一的明确指令（含/不含 `recurrence` 字段两种情况），非留白。✅
- **类型一致性**：`due_reminders_utc(events, now_wall, grace, device) -> Vec<DueReminder>`、`due_reminders` 薄封装、`instant_of(&str, Tz) -> Option<DateTime<Utc>>`；前端 `startTz`/`endTz`/`rrule: string | null` 三字段在类型、夹具、映射、详情渲染四处命名一致。✅
- **与前序 Part 衔接**：依赖 Part 1 的 `timezone::*`、Part 3a 的 `Event`/`CalendarEvent` 新字段、Part 3b 的「`start_at` 已是设备钟面」不变量。提醒层正因该不变量才能对带时区与浮动事件统一处理。✅

---

## Spec A 全景回顾（四份计划完成后）

- **Part 1** 依赖 + 时区换算层（`timezone.rs`，纯函数，DST 边界）。
- **Part 2** RRULE 引擎（`rrule_engine.rs`，包 `rrule` crate，窗口内展开，含 RDATE/EXDATE）。
- **Part 3a** schema 清空重建 + `Event`/`EventDraft` 新字段 + `Recurrence`↔RRULE 串桥接。
- **Part 3b** 读写路径与两路范围查询（浮动走钟面、带时区走 UTC 缓存，展开经 Part 2 引擎）。
- **Part 4** 提醒时区适配 + 前端模型/渲染。

Spec A 落地后，Nowly 的日历数据模型与 RFC 5545 同构，`rrule` 串无损存储、往返、展开，带时区事件按设备时区正确显示，DST 边界正确。Spec B（完整 RRULE 编辑 UI）与 Spec C（日历订阅）即可在此地基上分别立计划实施。
