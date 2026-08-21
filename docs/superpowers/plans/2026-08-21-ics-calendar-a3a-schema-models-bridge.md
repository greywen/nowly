# ICS 日历 · Spec A 实现计划 · Part 3a：schema 清空重建、模型与 RRULE 桥接

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用一个新迁移清空并重建 `events` / `event_exceptions` / `reminder_dispatches` 三表为 ICS 时间模型（新增时区列、UTC 缓存列、标准 RRULE 串列、rdate/exdate 列），扩展 `Event`/`EventDraft` 模型字段，并建立「前端简单重复结构 `Recurrence` ↔ 标准 RRULE 串」的双向桥接。

**Architecture:** 本 Part 只改数据的**形状**（schema + 模型 + 桥接纯函数），不改读写业务逻辑（那是 Part 3b）。迁移是不可逆的清空重建。桥接层 `rrule_bridge.rs` 是纯函数模块，把前端仍在使用的简单 `Recurrence` 结构翻译成标准 RRULE 串存库，并尽力反向翻译供前端编辑；无法用简单模型表达的复杂 RRULE 反向翻译返回 `None`，前端据此只读展示。

**Tech Stack:** Rust、`rusqlite`、`rrule` 0.14、Part 1 的 `timezone`、Part 2 的 `rrule_engine`、`cargo test`。

> 本计划是 Spec A 四份实现计划的第三份（3a）。前置：Part 1（时区层）、Part 2（RRULE 引擎）必须已落地。后续：Part 3b（读写与范围查询）、Part 4（提醒适配 + 前端）。总览见 `docs/superpowers/specs/2026-08-21-ics-calendar-overview.md`。

---

## 文件结构

- 修改：`src-tauri/src/db.rs` —— 新增 `migration_15_ics_rebuild`：DROP 三表、按新 schema 重建、置空 `tasks.linked_event_id`。
- 修改：`src-tauri/src/models.rs` —— `Event` 与 `EventDraft` 新增 `start_tz`/`end_tz` 字段；`Event` 新增 `rrule`（`Option<String>`）下发字段。保留 `recurrence: Option<Recurrence>` 作为前端契约。
- 创建：`src-tauri/src/rrule_bridge.rs` —— 纯函数：`recurrence_to_rrule(&Recurrence) -> String`、`rrule_to_recurrence(&str) -> Option<Recurrence>`。
- 修改：`src-tauri/src/main.rs` —— 注册 `mod rrule_bridge;`。

### 新 events 表列（重建后）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | 不变 |
| `title` | TEXT | 不变 |
| `start_at` / `end_at` | TEXT | 钟面时间（事件自身时区），`%Y-%m-%dT%H:%M`，全天为 `%Y-%m-%d` |
| `start_tz` / `end_tz` | TEXT | 具名 IANA 时区；`NULL`=浮动/全天 |
| `start_utc` / `end_utc` | TEXT | UTC 缓存 `%Y-%m-%dT%H:%MZ`，仅带时区事件有值 |
| `all_day` | INTEGER | 不变（0/1） |
| `category` / `color` / `note` | TEXT | 不变 |
| `linked_task_id` | TEXT | 不变 |
| `reminders` | TEXT | 提醒偏移 JSON，默认 `'[]'`（沿用 Part 14 语义） |
| `created_at` / `updated_at` | TEXT | 不变 |
| `rrule` | TEXT | 标准 RFC 5545 RRULE 串（不含 `RRULE:` 前缀），`NULL`=单次 |
| `recurrence_final_at` | TEXT | 归一化算出的绝对上界，供范围预筛；`NULL`=无限/单次 |
| `rdate` | TEXT | JSON 数组，附加发生时刻（钟面串）；`NULL`/`'[]'`=无 |
| `exdate` | TEXT | JSON 数组，排除发生时刻（钟面串）；`NULL`/`'[]'`=无 |

`event_exceptions` 与 `reminder_dispatches` 结构与现有一致（见 migration_13/14），仅随三表一起重建。

---

## Task 1：新迁移——清空重建三表

**Files:**
- Modify: `src-tauri/src/db.rs`

- [ ] **Step 1: 写失败测试（迁移后新列存在、旧列消失、linked_event_id 置空）**

在 `db.rs` 的 `#[cfg(test)] mod tests` 内加入：

```rust
    #[test]
    fn migration_15_rebuilds_events_with_ics_columns() {
        let mut connection = Connection::open_in_memory().expect("memory db opens");
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .expect("foreign keys on");
        migrate(&mut connection).expect("migration succeeds");

        // 版本序列包含 15。
        let versions: Vec<i64> = connection
            .prepare("SELECT version FROM schema_migrations ORDER BY version")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(versions, vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

        // 新列存在。
        let columns: Vec<String> = connection
            .prepare("PRAGMA table_info(events)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        for expected in [
            "start_tz", "end_tz", "start_utc", "end_utc", "rrule", "rdate", "exdate",
            "recurrence_final_at",
        ] {
            assert!(columns.iter().any(|c| c == expected), "缺少列 {expected}");
        }
        // 旧的分列重复模型已移除。
        for gone in ["recurrence_freq", "recurrence_interval", "recurrence_by_day", "recurrence_count", "recurrence_until"] {
            assert!(!columns.iter().any(|c| c == gone), "旧列 {gone} 应已移除");
        }
    }

    #[test]
    fn migration_15_nulls_linked_event_id() {
        let mut connection = Connection::open_in_memory().expect("memory db opens");
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .expect("foreign keys on");
        // 迁移到 14 之前无法直接控制；此处迁移全程后插入任务带链接，再断言迁移逻辑对存量的处理。
        migrate(&mut connection).expect("migration succeeds");
        connection
            .execute(
                "INSERT INTO tasks(id,title,quadrant,priority,completed,note,created_at,updated_at,linked_event_id)
                 VALUES ('t1','任务','important_urgent',1,0,'','t','t',NULL)",
                [],
            )
            .expect("task inserts");
        // 存量清空逻辑已在迁移中执行；这里验证迁移不会因 tasks 里的链接列而失败，且列可为 NULL。
        let linked: Option<String> = connection
            .query_row("SELECT linked_event_id FROM tasks WHERE id='t1'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(linked, None);
    }
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml db::tests::migration_15_rebuilds_events_with_ics_columns`
Expected: FAIL —— 版本序列断言失败（当前最高 14），或新列不存在。

- [ ] **Step 3: 在 MIGRATIONS 注册第 15 项**

在 `db.rs` 的 `const MIGRATIONS` 数组里，`(14, migration_14_reminders),` 之后加入：

```rust
    (15, migration_15_ics_rebuild),
```

- [ ] **Step 4: 实现 migration_15_ics_rebuild**

在 `migration_14_reminders` 函数下方加入。**注意 DROP 顺序**：先删有外键指向 events 的子表，再删 events。

```rust
// ICS 彻底革新：清空并重建 events / event_exceptions / reminder_dispatches 为 RFC 5545
// 时间模型。带时区列、UTC 缓存列、标准 RRULE 串、rdate/exdate。这是不可逆的破坏性迁移：
// 所有既有日程、改期、提醒记录被清空（已与需求方确认采用彻底革新、不保留旧数据）。
// tasks 表保留，但其 linked_event_id 指向的事件已被清空，一并置 NULL 以免悬空引用。
fn migration_15_ics_rebuild(transaction: &Transaction<'_>) -> Result<()> {
    transaction.execute_batch(
        "DROP TABLE IF EXISTS reminder_dispatches;
         DROP TABLE IF EXISTS event_exceptions;
         DROP TABLE IF EXISTS events;
         UPDATE tasks SET linked_event_id = NULL;

         CREATE TABLE events (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            start_at TEXT NOT NULL,
            end_at TEXT NOT NULL,
            start_tz TEXT,
            end_tz TEXT,
            start_utc TEXT,
            end_utc TEXT,
            all_day INTEGER NOT NULL CHECK (all_day IN (0, 1)),
            category TEXT NOT NULL,
            color TEXT NOT NULL,
            linked_task_id TEXT,
            note TEXT NOT NULL DEFAULT '',
            reminders TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            rrule TEXT,
            recurrence_final_at TEXT,
            rdate TEXT,
            exdate TEXT
         );

         CREATE INDEX idx_events_range ON events(start_at, end_at);
         CREATE INDEX idx_events_start_utc ON events(start_utc) WHERE start_utc IS NOT NULL;
         CREATE INDEX idx_events_recurrence_active
            ON events(recurrence_final_at) WHERE rrule IS NOT NULL;
         CREATE UNIQUE INDEX idx_events_linked_task
            ON events(linked_task_id) WHERE linked_task_id IS NOT NULL;

         CREATE TABLE event_exceptions (
            id TEXT PRIMARY KEY,
            series_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
            occurrence_start_at TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('excluded','overridden')),
            title TEXT,
            start_at TEXT,
            end_at TEXT,
            all_day INTEGER,
            category TEXT,
            color TEXT,
            note TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
         );
         CREATE UNIQUE INDEX idx_event_exceptions_slot
            ON event_exceptions(series_id, occurrence_start_at);
         CREATE INDEX idx_event_exceptions_moved
            ON event_exceptions(series_id, start_at);

         CREATE TABLE reminder_dispatches (
            event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
            occurrence_start_at TEXT NOT NULL,
            offset_minutes INTEGER NOT NULL,
            dispatched_at TEXT NOT NULL,
            PRIMARY KEY (event_id, occurrence_start_at, offset_minutes)
         );",
    )
}
```

- [ ] **Step 5: 更新既有迁移测试里的版本序列断言**

`db.rs` 里已有三处断言 `vec![1, 2, ..., 14]` 的测试（迁移全程、外键、幂等）。把这三处都改为 `vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]`。用 grep 定位：

Run: `grep -n "12, 13, 14\]" src-tauri/src/db.rs`
把每处结尾的 `14]` 改为 `14, 15]`。

- [ ] **Step 6: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml db::tests`
Expected: PASS —— 含新增两个 migration_15 测试，及更新后的版本序列断言。

> 注意：`migration_13_adds_recurrence_columns_and_exception_table` 与 `migration_14_adds_reminders_column_and_dispatch_table` 这两个既有测试断言的是**迁移 13/14 之后**的中间状态。由于迁移 15 现在会 DROP 并重建这些表，这两个测试若断言的是「migrate 全程跑完后」的状态，需要改为只跑到对应版本，或改断言最终 schema。**实际处理**：把这两个测试中「插入数据后验证」的部分调整为验证迁移 15 后的最终列集合；若测试原本用 `migrate()`（跑全程），其插入的行会因 DROP 被清空——将这两个测试标注为验证「迁移函数本身可执行」并断言最终 schema，删除对中间态数据留存的断言。

- [ ] **Step 7: 提交**

```bash
git add src-tauri/src/db.rs
git commit -m "feat: rebuild events schema for ICS time model (migration 15)"
```

---

## Task 2：扩展 Event 模型字段

**Files:**
- Modify: `src-tauri/src/models.rs`

- [ ] **Step 1: 写失败测试（Event 带 startTz/endTz/rrule 序列化）**

在 `models.rs` 的 `mod tests` 内加入：

```rust
    #[test]
    fn event_serializes_timezone_and_rrule_fields() {
        let value = serde_json::to_value(event()).expect("event serializes");
        let object = value.as_object().expect("object");
        // 浮动事件三字段为 null。
        assert_eq!(object.get("startTz"), Some(&Value::Null));
        assert_eq!(object.get("endTz"), Some(&Value::Null));
        assert_eq!(object.get("rrule"), Some(&Value::Null));
        // snake_case 不泄漏。
        for snake in ["start_tz", "end_tz"] {
            assert!(!object.contains_key(snake));
        }
    }
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml models::tests::event_serializes_timezone_and_rrule_fields`
Expected: FAIL —— `event()` 构造缺少新字段导致编译失败，或字段不存在。

- [ ] **Step 3: 给 Event 结构加字段**

在 `models.rs` 的 `struct Event` 中，`pub end_at: String,` 之后加入：

```rust
    /// 事件自身的具名 IANA 时区；浮动/全天为 None。
    pub start_tz: Option<String>,
    pub end_tz: Option<String>,
```

在 `pub recurrence: Option<Recurrence>,` 之后加入：

```rust
    /// 标准 RFC 5545 RRULE 串（不含 `RRULE:` 前缀），供前端只读展示与 Spec B 使用。
    /// 单次事件为 None。
    pub rrule: Option<String>,
```

- [ ] **Step 4: 给 EventDraft 结构加字段**

在 `models.rs` 的 `struct EventDraft` 中，`pub end_at: String,` 之后加入：

```rust
    #[serde(default)]
    pub start_tz: Option<String>,
    #[serde(default)]
    pub end_tz: Option<String>,
```

- [ ] **Step 5: 修复 models.rs 测试里的 event() 构造器**

`models.rs` 的 `mod tests` 里 `fn event()` 构造 `Event`。在 `end_at: "...".into(),` 之后加入：

```rust
            start_tz: None,
            end_tz: None,
```

在 `recurrence: None,` 之后加入：

```rust
            rrule: None,
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml models::tests`
Expected: PASS。

> 此步会让 `events.rs` 里所有构造 `Event`/`EventDraft` 的地方编译失败（缺字段）。这是预期的——Part 3b 会逐一修复读写路径。本 Task 只在 `models.rs` 内自洽（该文件的测试构造器已补全）。若 `cargo test` 因 `events.rs` 编译失败而无法运行 models 测试，先用 `cargo test --manifest-path src-tauri/Cargo.toml --lib models::` 无法绕过整包编译——因此本 Task 的「通过」以 **Part 3b 完成后整包编译通过** 为准；此处仅确认 models.rs 自身语法与字段正确。**执行提示**：本 Task 与 Part 3b Task 1 连续执行，中间不要求整包可编译。

- [ ] **Step 7: 提交**

```bash
git add src-tauri/src/models.rs
git commit -m "feat: add timezone and rrule fields to Event and EventDraft"
```

---

## Task 3：RRULE 桥接——Recurrence → RRULE 串

前端仍用简单 `Recurrence`（freq/interval/byDay/end）编辑。写库前翻译成标准 RRULE 串。

**Files:**
- Create: `src-tauri/src/rrule_bridge.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: 注册空模块**

创建 `src-tauri/src/rrule_bridge.rs`：

```rust
//! 前端简单重复结构 `Recurrence` 与标准 RFC 5545 RRULE 串之间的双向桥接。
//! 写库时把 `Recurrence` 翻译成 RRULE 串；读出时尽力反向翻译供前端编辑，
//! 无法用简单模型表达的复杂 RRULE 反向返回 None，前端据此只读展示。

use crate::recurrence::{Freq, Recurrence, RecurrenceEnd};
```

在 `src-tauri/src/main.rs` 的模块声明区加入 `mod rrule_bridge;`。

- [ ] **Step 2: 写失败测试**

在 `rrule_bridge.rs` 末尾加入：

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::recurrence::{Freq, Recurrence, RecurrenceEnd};

    fn weekly_mo_count() -> Recurrence {
        Recurrence {
            freq: Freq::Weekly,
            interval: 2,
            by_day: vec!["MO".into(), "WE".into()],
            end: RecurrenceEnd::Count { count: 5 },
        }
    }

    #[test]
    fn weekly_with_bydays_and_count() {
        assert_eq!(
            recurrence_to_rrule(&weekly_mo_count()),
            "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=5"
        );
    }

    #[test]
    fn daily_never_omits_interval_one_and_end() {
        let rule = Recurrence {
            freq: Freq::Daily,
            interval: 1,
            by_day: vec![],
            end: RecurrenceEnd::Never,
        };
        assert_eq!(recurrence_to_rrule(&rule), "FREQ=DAILY");
    }

    #[test]
    fn until_becomes_utc_stamp() {
        let rule = Recurrence {
            freq: Freq::Monthly,
            interval: 1,
            by_day: vec![],
            end: RecurrenceEnd::Until { date: "2026-09-30".into() },
        };
        // UNTIL 以日期末尾 23:59 的 UTC 标记（分钟精度）表达，保证包含当天。
        assert_eq!(
            recurrence_to_rrule(&rule),
            "FREQ=MONTHLY;UNTIL=20260930T235900Z"
        );
    }
}
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rrule_bridge::tests::weekly_with_bydays_and_count`
Expected: FAIL —— `cannot find function recurrence_to_rrule`。

- [ ] **Step 4: 实现 recurrence_to_rrule**

在 `use` 语句下方加入：

```rust
/// 把简单 `Recurrence` 翻译成标准 RRULE 串（不含 `RRULE:` 前缀）。
/// INTERVAL=1 与 Never 结束条件省略，与 RFC 5545 惯例一致。
pub fn recurrence_to_rrule(rule: &Recurrence) -> String {
    let mut parts: Vec<String> = Vec::new();
    let freq = match rule.freq {
        Freq::Daily => "DAILY",
        Freq::Weekly => "WEEKLY",
        Freq::Monthly => "MONTHLY",
        Freq::Yearly => "YEARLY",
    };
    parts.push(format!("FREQ={freq}"));
    if rule.interval > 1 {
        parts.push(format!("INTERVAL={}", rule.interval));
    }
    if !rule.by_day.is_empty() {
        parts.push(format!("BYDAY={}", rule.by_day.join(",")));
    }
    match &rule.end {
        RecurrenceEnd::Never => {}
        RecurrenceEnd::Count { count } => parts.push(format!("COUNT={count}")),
        RecurrenceEnd::Until { date } => {
            // date 是 `%Y-%m-%d`；UNTIL 以当天 23:59 的 UTC 标记表达，包含当天全部实例。
            let compact = date.replace('-', "");
            parts.push(format!("UNTIL={compact}T235900Z"));
        }
    }
    parts.join(";")
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rrule_bridge::tests`
Expected: PASS（3 个测试）。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/src/rrule_bridge.rs src-tauri/src/main.rs
git commit -m "feat: translate simple Recurrence to RFC 5545 RRULE string"
```

---

## Task 4：RRULE 桥接——RRULE 串 → Recurrence（尽力反向）

**Files:**
- Modify: `src-tauri/src/rrule_bridge.rs`

- [ ] **Step 1: 写失败测试**

在 `mod tests` 内加入：

```rust
    #[test]
    fn simple_rrule_roundtrips_back_to_recurrence() {
        let rule = weekly_mo_count();
        let text = recurrence_to_rrule(&rule);
        assert_eq!(rrule_to_recurrence(&text), Some(rule));
    }

    #[test]
    fn complex_rrule_returns_none() {
        // BYSETPOS 无法用简单模型表达。
        assert_eq!(
            rrule_to_recurrence("FREQ=MONTHLY;BYDAY=TU;BYSETPOS=3"),
            None
        );
        // 带序数的 BYDAY（3MO）也超出简单模型。
        assert_eq!(rrule_to_recurrence("FREQ=MONTHLY;BYDAY=3MO"), None);
    }

    #[test]
    fn until_parses_back_to_date() {
        let parsed = rrule_to_recurrence("FREQ=MONTHLY;UNTIL=20260930T235900Z").unwrap();
        assert_eq!(parsed.end, RecurrenceEnd::Until { date: "2026-09-30".into() });
    }
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rrule_bridge::tests::simple_rrule_roundtrips_back_to_recurrence`
Expected: FAIL —— `cannot find function rrule_to_recurrence`。

- [ ] **Step 3: 实现 rrule_to_recurrence**

在 `recurrence_to_rrule` 下方加入：

```rust
/// 尽力把 RRULE 串反向翻译成简单 `Recurrence`。含简单模型无法表达的部分
/// （BYSETPOS、BYMONTHDAY、BYMONTH、带序数的 BYDAY 如 `3MO`、BYYEARDAY、BYWEEKNO 等）
/// 时返回 None——调用方据此判定该规则只读，不提供简单编辑表单。
pub fn rrule_to_recurrence(text: &str) -> Option<Recurrence> {
    let mut freq: Option<Freq> = None;
    let mut interval: u32 = 1;
    let mut by_day: Vec<String> = Vec::new();
    let mut end = RecurrenceEnd::Never;

    for part in text.split(';') {
        let (key, value) = part.split_once('=')?;
        match key {
            "FREQ" => {
                freq = Some(match value {
                    "DAILY" => Freq::Daily,
                    "WEEKLY" => Freq::Weekly,
                    "MONTHLY" => Freq::Monthly,
                    "YEARLY" => Freq::Yearly,
                    _ => return None, // SECONDLY/MINUTELY/HOURLY 超出简单模型
                });
            }
            "INTERVAL" => interval = value.parse().ok()?,
            "BYDAY" => {
                for code in value.split(',') {
                    // 简单模型只接受无序数的两字母星期码。
                    if !matches!(code, "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU") {
                        return None;
                    }
                    by_day.push(code.to_owned());
                }
            }
            "COUNT" => end = RecurrenceEnd::Count { count: value.parse().ok()? },
            "UNTIL" => {
                // 取日期部分 `YYYYMMDD`，还原成 `YYYY-MM-DD`。
                let date = value.get(0..8)?;
                let formatted = format!("{}-{}-{}", &date[0..4], &date[4..6], &date[6..8]);
                end = RecurrenceEnd::Until { date: formatted };
            }
            // 任何简单模型无法表达的部分 → 整条视为复杂规则。
            "BYSETPOS" | "BYMONTHDAY" | "BYMONTH" | "BYYEARDAY" | "BYWEEKNO" | "WKST" => {
                return None;
            }
            _ => return None,
        }
    }

    Some(Recurrence {
        freq: freq?,
        interval,
        by_day,
        end,
    })
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rrule_bridge::tests`
Expected: PASS（6 个测试）。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/rrule_bridge.rs
git commit -m "feat: best-effort reverse translation from RRULE string to Recurrence"
```

---

## Task 5：Part 3a 收尾校验

**Files:** 无（仅校验）

- [ ] **Step 1: 桥接与迁移测试通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rrule_bridge::tests db::tests`
Expected: 全部通过。

- [ ] **Step 2: 确认整包尚未要求编译通过**

本 Part 结束时 `events.rs` 因 `Event`/`EventDraft` 新字段而**尚未编译通过**，这是预期的中间态。整包编译通过是 Part 3b 的收尾目标。执行者应连续进入 Part 3b，不在此处停下等待整包绿灯。

- [ ] **Step 3: 更新总览进度**

在 overview 的 Spec A 进度表把 `A3 | 清空重建迁移 + 新 schema + 索引` 标为 ✅。提交：

```bash
git add docs/superpowers/specs/2026-08-21-ics-calendar-overview.md
git commit -m "docs: mark schema rebuild milestone complete"
```

---

## Self-Review（对照 Spec A）

- **Spec 覆盖**：对应 Spec A 的「存储模型」「数据迁移（清空重建）」两节，以及模型字段扩展与 Recurrence↔RRULE 桥接。读写业务、范围查询、提醒、前端属 Part 3b/4。✅
- **占位符扫描**：无 TBD/TODO；迁移 SQL、模型字段、桥接函数均给出完整代码与测试。✅
- **类型一致性**：`recurrence_to_rrule(&Recurrence) -> String`、`rrule_to_recurrence(&str) -> Option<Recurrence>`；`Event` 新增 `start_tz`/`end_tz: Option<String>`、`rrule: Option<String>`；`EventDraft` 新增 `start_tz`/`end_tz`。列名与 Part 3b 读写路径将引用的完全一致。✅
- **中间态说明**：明确标注本 Part 结束时整包不编译，须与 Part 3b 连续执行，避免执行者误判失败。✅
