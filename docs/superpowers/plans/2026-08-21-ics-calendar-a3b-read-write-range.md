# ICS 日历 · Spec A 实现计划 · Part 3b：读写路径与范围查询

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `events.rs` 的读写路径与范围查询适配 Part 3a 的新 schema：写入时按设备时区绑定本地定时事件、维护 UTC 缓存列、经桥接存 RRULE 串；读取时把带时区事件换算成设备时区显示钟面并回填 `startTz`/`endTz`/`rrule`；范围查询改为「浮动/全天走钟面、带时区走 UTC 缓存」两路谓词，重复展开改用 Part 2 的 `rrule_engine`。收尾时整包编译通过、全部测试绿。

**Architecture:** 本 Part 是整个 Spec A 的集成核心。它把 Part 1（时区）、Part 2（RRULE 引擎）、Part 3a（schema/模型/桥接）接进 `events.rs` 的实际读写。保留既有的 `event_exceptions` 合并机制与任务双向关联逻辑（它们不随时间模型改变），只替换「重复列读写」「时间换算」「范围展开」三处。

**Tech Stack:** Rust、`rusqlite`、Part 1 `timezone`、Part 2 `rrule_engine`、Part 3a `rrule_bridge`、`cargo test`。

> 本计划是 Spec A 四份实现计划的第三份（3b）。前置：Part 1、2、3a 必须已落地（3a 结束时整包处于不可编译的中间态，本 Part 收尾使其恢复可编译）。后续：Part 4（提醒适配 + 前端）。

---

## 文件结构

- 修改：`src-tauri/src/events.rs` —— 核心。`EVENT_COLUMNS`、`read_series_row`/`read_event`/`instance_from`、`validate_and_normalize`、`recurrence_columns`→`ics_columns`、`create`/`update` 写入、`list_in_range` 范围查询。
- 修改：`src-tauri/src/event_exceptions.rs` —— override 实例的时间换算随系列时区走（读取时把 override 钟面按系列时区回算显示钟面）。仅在跨时区显示时需要；本 Part 先保持钟面直存直读（override 继承系列时区），不新增时区列。

### 关键约定（承接 3a）

- 写入 `start_at`/`end_at` = 事件自身时区的钟面；带时区事件另算 `start_utc`/`end_utc`。
- 本地新建：定时事件 `start_tz = end_tz = device_tz()`；全天事件 `start_tz = end_tz = NULL`。
- 读取下发：`Event.start_at`/`end_at` = **设备时区显示钟面**；`start_tz`/`end_tz` = 事件自身时区（下发给前端标注）；`rrule` = 存储的 RRULE 串。
- 重复实例身份 `occurrence_start_at` = 系列自身时区钟面（不随设备换算）。

---

## Task 1：更新列常量与读取路径

**Files:**
- Modify: `src-tauri/src/events.rs`

- [ ] **Step 1: 更新 EVENT_COLUMNS**

把 `events.rs:16` 的 `EVENT_COLUMNS` 改为新列集合（顺序决定后续 `row.get(idx)`，务必与实现里的索引一致）：

```rust
const EVENT_COLUMNS: &str = "id,title,start_at,end_at,start_tz,end_tz,start_utc,end_utc,\
                             all_day,category,color,linked_task_id,note,reminders,\
                             created_at,updated_at,rrule,recurrence_final_at,rdate,exdate";
```

列索引（0 基）：0 id,1 title,2 start_at,3 end_at,4 start_tz,5 end_tz,6 start_utc,7 end_utc,8 all_day,9 category,10 color,11 linked_task_id,12 note,13 reminders,14 created_at,15 updated_at,16 rrule,17 recurrence_final_at,18 rdate,19 exdate。

- [ ] **Step 2: 写失败测试（读取单次带时区事件回填字段）**

在 `events.rs` 的 `mod tests` 内加入。用直插 SQL 造一个带时区事件，断言读取后 `start_tz`/`rrule` 正确、显示钟面按设备时区换算。为让测试确定，设备时区在测试内固定读取 `timezone::device_tz()` 并据此断言换算关系而非绝对值：

```rust
    #[test]
    fn reads_a_tz_bound_single_event_with_display_conversion() {
        let connection = database();
        // 上海 10:00（02:00Z）。
        connection.execute(
            "INSERT INTO events(id,title,start_at,end_at,start_tz,end_tz,start_utc,end_utc,
                                all_day,category,color,note,reminders,created_at,updated_at)
             VALUES ('e1','会议','2026-08-03T10:00','2026-08-03T11:00','Asia/Shanghai','Asia/Shanghai',
                     '2026-08-03T02:00Z','2026-08-03T03:00Z',0,'work','#4FC9DA','','[]','t','t')",
            [],
        ).unwrap();
        let event = event_by_id(&connection, "e1").unwrap().unwrap();
        assert_eq!(event.start_tz.as_deref(), Some("Asia/Shanghai"));
        assert_eq!(event.rrule, None);
        // 显示钟面 = 02:00Z 换算到设备时区。
        let device = crate::timezone::device_tz();
        let expected = crate::timezone::format_wall(
            crate::timezone::utc_to_wall(
                "2026-08-03T02:00Z".parse::<chrono::DateTime<chrono::Utc>>()
                    .unwrap_or_else(|_| {
                        use chrono::TimeZone;
                        chrono::Utc.with_ymd_and_hms(2026, 8, 3, 2, 0, 0).unwrap()
                    }),
                device,
            ),
        );
        assert_eq!(event.start_at, expected);
    }
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml events::tests::reads_a_tz_bound_single_event_with_display_conversion`
Expected: 编译失败（`read_event` 仍用旧列索引 / `Event` 缺字段）或断言失败。

- [ ] **Step 4: 重写 read_series_row / read_event / instance_from**

用新列索引重写读取。`read_series_row` 读出事件自身时区的钟面与 RRULE 串；`read_event` 与 `instance_from` 在装配 `Event` 时，把 `start_at`/`end_at` 换算成设备时区显示钟面，并回填 `start_tz`/`end_tz`/`rrule`。

替换 `read_series_row`（events.rs:98 起）为：

```rust
struct SeriesRow {
    // 事件自身时区下的钟面（存储原值）。
    id: String,
    title: String,
    start_wall: String,
    end_wall: String,
    start_tz: Option<String>,
    end_tz: Option<String>,
    all_day: bool,
    category: String,
    color: String,
    linked_task_id: Option<String>,
    note: String,
    reminders: Vec<i64>,
    created_at: String,
    updated_at: String,
    rrule: Option<String>,
    final_at: Option<String>,
    rdate: Vec<String>,
    exdate: Vec<String>,
}

fn parse_json_list(raw: Option<String>) -> Vec<String> {
    raw.filter(|s| !s.trim().is_empty())
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
}

fn read_series_row(row: &Row<'_>) -> rusqlite::Result<SeriesRow> {
    let reminders: String = row.get(13)?;
    Ok(SeriesRow {
        id: row.get(0)?,
        title: row.get(1)?,
        start_wall: row.get(2)?,
        end_wall: row.get(3)?,
        start_tz: row.get(4)?,
        end_tz: row.get(5)?,
        all_day: row.get::<_, i64>(8)? == 1,
        category: row.get(9)?,
        color: row.get(10)?,
        linked_task_id: row.get(11)?,
        note: row.get(12)?,
        reminders: parse_reminders(&reminders),
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
        rrule: row.get(16)?,
        final_at: row.get(17)?,
        rdate: parse_json_list(row.get(18)?),
        exdate: parse_json_list(row.get(19)?),
    })
}
```

在 `read_series_row` 下方加入一个装配辅助，把系列时区钟面换算成设备时区显示钟面：

```rust
/// 把事件自身时区下的钟面换算成设备时区的显示钟面。浮动/全天原样返回。
fn to_display_wall(wall: &str, tz: &Option<String>) -> String {
    let Some(tz_name) = tz else { return wall.to_owned() };
    let (Ok(zone), Ok(naive)) = (crate::timezone::parse_tz(tz_name), crate::timezone::parse_wall(wall)) else {
        return wall.to_owned();
    };
    let instant = crate::timezone::wall_to_utc(naive, zone);
    crate::timezone::format_wall(crate::timezone::utc_to_wall(instant, crate::timezone::device_tz()))
}
```

替换 `read_event`（events.rs:155）为用 `SeriesRow` 装配单次/系列首实例的 `Event`：

```rust
fn event_from_series_row(row: &SeriesRow, occurrence_wall: Option<&str>) -> Event {
    let is_series = row.rrule.is_some();
    let start_display = to_display_wall(&row.start_wall, &row.start_tz);
    let end_display = to_display_wall(&row.end_wall, &row.end_tz);
    Event {
        id: row.id.clone(),
        title: row.title.clone(),
        start_at: start_display,
        end_at: end_display,
        start_tz: row.start_tz.clone(),
        end_tz: row.end_tz.clone(),
        all_day: row.all_day,
        category: row.category.clone(),
        color: row.color.clone(),
        linked_task_id: row.linked_task_id.clone(),
        note: row.note.clone(),
        reminders: row.reminders.clone(),
        created_at: row.created_at.clone(),
        updated_at: row.updated_at.clone(),
        recurrence: row.rrule.as_deref().and_then(crate::rrule_bridge::rrule_to_recurrence),
        rrule: row.rrule.clone(),
        series_id: is_series.then(|| row.id.clone()),
        series_start_at: is_series.then(|| row.start_wall.clone()),
        occurrence_start_at: occurrence_wall
            .map(str::to_owned)
            .or_else(|| is_series.then(|| row.start_wall.clone())),
        is_overridden: false,
    }
}

fn read_event(row: &Row<'_>) -> rusqlite::Result<Event> {
    Ok(event_from_series_row(&read_series_row(row)?, None))
}
```

> `occurrence_start_at` 保持系列时区钟面（`row.start_wall` 或展开的 slot 钟面），不换算——它是例外表身份键。展开实例的装配在 Task 3 的范围查询里用 `event_from_series_row(row, Some(slot_wall))`。

- [ ] **Step 5: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml events::tests::reads_a_tz_bound_single_event_with_display_conversion`
Expected: PASS。（此时其他 events 测试可能仍编译失败，Task 2/3 修复。）

- [ ] **Step 6: 提交**

```bash
git add src-tauri/src/events.rs
git commit -m "feat: read events with new ICS columns and device-tz display conversion"
```

---

## Task 2：写入路径——时区绑定、UTC 缓存、RRULE 串

**Files:**
- Modify: `src-tauri/src/events.rs`

- [ ] **Step 1: 写失败测试（本地定时事件绑设备时区并算 UTC 缓存）**

在 `mod tests` 内加入：

```rust
    #[test]
    fn create_binds_device_tz_and_computes_utc_cache_for_timed_events() {
        let mut connection = database();
        let created = create(&mut connection, draft()).unwrap();
        // 直读存储列（非下发显示值）。
        let (tz, utc): (Option<String>, Option<String>) = connection
            .query_row(
                "SELECT start_tz, start_utc FROM events WHERE id=?1",
                [&created.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        let device = crate::timezone::device_tz();
        assert_eq!(tz.as_deref(), Some(device.name()));
        assert!(utc.is_some(), "带时区事件必须有 UTC 缓存");
    }

    #[test]
    fn create_leaves_all_day_events_floating() {
        let mut connection = database();
        let created = create(&mut connection, EventDraft { all_day: true, ..draft() }).unwrap();
        let (tz, utc): (Option<String>, Option<String>) = connection
            .query_row(
                "SELECT start_tz, start_utc FROM events WHERE id=?1",
                [&created.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(tz, None, "全天事件浮动，无时区");
        assert_eq!(utc, None, "全天事件无 UTC 缓存");
    }
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml events::tests::create_binds_device_tz_and_computes_utc_cache_for_timed_events`
Expected: 编译失败（`create` 仍写旧列）。

- [ ] **Step 3: 用 ics_columns 替换 recurrence_columns**

删除 `type RecurrenceColumns`（events.rs:384）与 `fn recurrence_columns`（events.rs:393），替换为一个计算全部新列写入值的函数。它接收归一化后的 `draft` 与「事件自身时区」，产出 `(start_tz, end_tz, start_utc, end_utc, rrule, final_at, rdate_json, exdate_json)`：

```rust
struct IcsColumns {
    start_tz: Option<String>,
    end_tz: Option<String>,
    start_utc: Option<String>,
    end_utc: Option<String>,
    rrule: Option<String>,
    final_at: Option<String>,
    rdate: String,
    exdate: String,
}

/// 由归一化后的 draft 计算全部 ICS 存储列。本地新建：定时事件绑设备时区，全天浮动。
fn ics_columns(draft: &EventDraft) -> Result<IcsColumns, CommandError> {
    // 事件自身时区：全天为浮动（None）；定时事件取 draft.start_tz（订阅路径已带），
    // 本地新建时 draft.start_tz 为 None，则绑设备时区。
    let (start_tz, end_tz) = if draft.all_day {
        (None, None)
    } else {
        let device = crate::timezone::device_tz().name().to_owned();
        (
            Some(draft.start_tz.clone().unwrap_or_else(|| device.clone())),
            Some(draft.end_tz.clone().unwrap_or(device)),
        )
    };

    // UTC 缓存：仅带时区事件。
    let compute_utc = |wall: &str, tz: &Option<String>| -> Result<Option<String>, CommandError> {
        match tz {
            Some(name) => {
                let zone = crate::timezone::parse_tz(name)?;
                let naive = crate::timezone::parse_wall(wall)?;
                Ok(Some(crate::timezone::format_utc(crate::timezone::wall_to_utc(naive, zone))))
            }
            None => Ok(None),
        }
    };
    let start_utc = compute_utc(&draft.start_at, &start_tz)?;
    let end_utc = compute_utc(&draft.end_at, &end_tz)?;

    // RRULE 串 + final_at（沿用现有 recurrence 归一化算 final_at 的思路，经桥接转串）。
    let (rrule, final_at) = match draft.recurrence.as_ref() {
        Some(rule) => {
            let text = crate::rrule_bridge::recurrence_to_rrule(rule);
            let final_at = compute_final_at(draft, rule)?;
            (Some(text), final_at)
        }
        None => (None, None),
    };

    Ok(IcsColumns {
        start_tz, end_tz, start_utc, end_utc, rrule, final_at,
        rdate: "[]".to_owned(),
        exdate: "[]".to_owned(),
    })
}
```

`compute_final_at` 复用现有 `recurrence::normalize` 的 `final_at`（现有 `recurrence_columns` 里已有等价计算）。把原 `recurrence_columns` 内计算 `final_at` 的那段抽成：

```rust
/// 由重复规则算出绝对上界钟面（供范围预筛）。无限系列返回 None。
fn compute_final_at(draft: &EventDraft, rule: &Recurrence) -> Result<Option<String>, CommandError> {
    let dtstart = parse_local(&draft.start_at, "startAt")?;
    let normalized = recurrence::normalize(rule, dtstart)?;
    Ok(normalized.final_at.map(|v| v.format(LOCAL_MINUTE_FORMAT).to_string()))
}
```

- [ ] **Step 4: 更新 create 的 INSERT**

把 `create`（events.rs:558）里的 INSERT 语句与参数改为新列。INSERT 列与 `?` 占位按新 schema：

```rust
    let cols = ics_columns(&draft)?;
    transaction
        .execute(
            "INSERT INTO events(id,title,start_at,end_at,start_tz,end_tz,start_utc,end_utc,
                                all_day,category,color,linked_task_id,note,reminders,
                                created_at,updated_at,rrule,recurrence_final_at,rdate,exdate)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,NULL,?12,?13,?14,?14,?15,?16,?17,?18)",
            params![
                id, draft.title, draft.start_at, draft.end_at,
                cols.start_tz, cols.end_tz, cols.start_utc, cols.end_utc,
                i64::from(draft.all_day), draft.category, draft.color,
                draft.note, reminders_to_json(&draft.reminders), now,
                cols.rrule, cols.final_at, cols.rdate, cols.exdate
            ],
        )
        .map_err(sql_write_error)?;
```

（`linked_task_id` 仍先写 NULL、再由 `relink` 回填，保持现有双向关联逻辑不变。）

- [ ] **Step 5: 同步更新 update 的 All 分支 UPDATE**

`update` 的 `EditScope::All` 分支同样把 `recurrence_columns` 调用换成 `ics_columns`，UPDATE 语句改为写 `start_tz,end_tz,start_utc,end_utc,rrule,recurrence_final_at,rdate,exdate`（其余字段不变）。ThisAndFollowing 分支的新系列 INSERT 同理复用 `ics_columns`。

> 保留不变：`relink`、`event_exceptions` 的 upsert/delete/move、`slots_unchanged`/`slots_continue`/`occurrences_before`/`truncate_before`/`rewrite_end` 等基于 `Recurrence` 的编辑逻辑。它们操作的是前端简单模型，经桥接落库，语义不变。

- [ ] **Step 6: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml events::tests::create_binds_device_tz_and_computes_utc_cache_for_timed_events events::tests::create_leaves_all_day_events_floating`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src-tauri/src/events.rs
git commit -m "feat: write events with device-tz binding, UTC cache, and RRULE string"
```

---

## Task 3：范围查询——两路谓词 + rrule_engine 展开

**Files:**
- Modify: `src-tauri/src/events.rs`

- [ ] **Step 1: 写失败测试（带时区系列跨设备时区落窗 + 浮动保持旧行为）**

在 `mod tests` 内加入：

```rust
    #[test]
    fn range_query_expands_tz_bound_series_via_engine() {
        let connection = database();
        // 上海每周一 10:00 的系列。
        connection.execute(
            "INSERT INTO events(id,title,start_at,end_at,start_tz,end_tz,start_utc,end_utc,
                                all_day,category,color,note,reminders,created_at,updated_at,rrule,recurrence_final_at)
             VALUES ('s1','周会','2026-08-03T10:00','2026-08-03T11:00','Asia/Shanghai','Asia/Shanghai',
                     '2026-08-03T02:00Z','2026-08-03T03:00Z',0,'work','#4FC9DA','','[]','t','t',
                     'FREQ=WEEKLY;BYDAY=MO',NULL)",
            [],
        ).unwrap();
        let events = list_in_range(&connection, &EventRange {
            start_at: "2026-08-01T00:00".into(),
            end_at_exclusive: "2026-09-01T00:00".into(),
        }).unwrap();
        // 八月的周一：3、10、17、24、31 共五次。
        assert_eq!(events.len(), 5);
        assert!(events.iter().all(|e| e.series_id.as_deref() == Some("s1")));
        // occurrence_start_at 是系列时区钟面。
        assert_eq!(events[0].occurrence_start_at.as_deref(), Some("2026-08-03T10:00"));
    }

    #[test]
    fn range_query_keeps_floating_events_by_wall_clock() {
        let connection = database();
        connection.execute(
            "INSERT INTO events(id,title,start_at,end_at,all_day,category,color,note,reminders,created_at,updated_at)
             VALUES ('f1','浮动','2026-08-10T09:00','2026-08-10T10:00',0,'work','#4FC9DA','','[]','t','t')",
            [],
        ).unwrap();
        let events = list_in_range(&connection, &EventRange {
            start_at: "2026-08-01T00:00".into(),
            end_at_exclusive: "2026-09-01T00:00".into(),
        }).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].start_at, "2026-08-10T09:00");
        assert_eq!(events[0].start_tz, None);
    }
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml events::tests::range_query_expands_tz_bound_series_via_engine`
Expected: 编译失败或断言失败（`list_in_range` 仍用旧展开）。

- [ ] **Step 3: 重写 list_in_range**

以设备时区把查询窗口解释为「设备钟面窗口」，拆两路：

1. 单次事件 + 系列，各自用「浮动走钟面 / 带时区走 UTC 缓存」预筛。
2. 系列展开改调 `rrule_engine::expand`：把设备时区窗口换算到**系列自身时区**的钟面窗口，喂给引擎；引擎产出的 `Occurrence.wall` 即 `occurrence_start_at`，装配用 `event_from_series_row(row, Some(&slot_wall))`，再叠加 `event_exceptions` 合并（excluded 剔除、overridden 覆盖，顺序不变）。

替换 `list_in_range`（events.rs:206）为：

```rust
pub fn list_in_range(
    connection: &Connection,
    range: &EventRange,
) -> Result<Vec<Event>, CommandError> {
    let device = crate::timezone::device_tz();
    let win_start = parse_local(&range.start_at, "startAt")?;
    let win_end = parse_local(&range.end_at_exclusive, "endAtExclusive")?;
    if win_start >= win_end {
        return Err(CommandError::validation("endAtExclusive", "查询结束时间必须晚于开始时间。"));
    }
    // 设备钟面窗口对应的 UTC 瞬时点，用于带时区事件的 UTC 缓存比较。
    let win_start_utc = crate::timezone::format_utc(crate::timezone::wall_to_utc(win_start, device));
    let win_end_utc = crate::timezone::format_utc(crate::timezone::wall_to_utc(win_end, device));
    let win_start_wall = crate::timezone::format_wall(win_start);
    let win_end_wall = crate::timezone::format_wall(win_end);

    let mut results: Vec<Event> = Vec::new();

    // —— 单次事件：浮动/全天走钟面，带时区走 UTC 缓存 ——
    let mut singles = connection.prepare(&format!(
        "SELECT {EVENT_COLUMNS} FROM events WHERE rrule IS NULL AND (
            (start_tz IS NULL AND start_at >= ?1 AND start_at < ?2)
            OR (start_tz IS NOT NULL AND start_utc >= ?3 AND start_utc < ?4))"
    )).map_err(CommandError::database)?;
    let rows = singles.query_map(
        params![win_start_wall, win_end_wall, win_start_utc, win_end_utc],
        read_event,
    ).map_err(CommandError::database)?;
    for row in rows {
        results.push(row.map_err(CommandError::database)?);
    }

    // —— 系列：预筛后用 rrule_engine 在系列时区展开 ——
    let mut series_stmt = connection.prepare(&format!(
        "SELECT {EVENT_COLUMNS} FROM events WHERE rrule IS NOT NULL"
    )).map_err(CommandError::database)?;
    let series_rows = series_stmt
        .query_map([], read_series_row)
        .map_err(CommandError::database)?;

    for series_row in series_rows {
        let series_row = series_row.map_err(CommandError::database)?;
        expand_series_into(connection, &series_row, win_start, win_end, device, &mut results)?;
    }

    results.sort_by(|a, b| a.start_at.cmp(&b.start_at)
        .then(a.end_at.cmp(&b.end_at))
        .then(a.id.cmp(&b.id))
        .then(a.occurrence_start_at.cmp(&b.occurrence_start_at)));
    Ok(results)
}
```

加入系列展开辅助（把设备窗口换算到系列时区，调 `rrule_engine::expand`，叠加例外）：

```rust
fn expand_series_into(
    connection: &Connection,
    row: &SeriesRow,
    win_start: NaiveDateTime,
    win_end: NaiveDateTime,
    device: chrono_tz::Tz,
    out: &mut Vec<Event>,
) -> Result<(), CommandError> {
    // 系列自身时区（浮动为 None）。
    let series_tz = match &row.start_tz {
        Some(name) => Some(crate::timezone::parse_tz(name)?),
        None => None,
    };
    // 设备钟面窗口 → 系列时区钟面窗口。浮动系列：钟面窗口原样。
    let (ws, we) = match series_tz {
        Some(zone) => {
            let s = crate::timezone::utc_to_wall(crate::timezone::wall_to_utc(win_start, device), zone);
            let e = crate::timezone::utc_to_wall(crate::timezone::wall_to_utc(win_end, device), zone);
            (s, e)
        }
        None => (win_start, win_end),
    };

    let spec = crate::rrule_engine::SeriesSpec {
        dtstart_wall: crate::timezone::parse_wall(&row.start_wall)?,
        tz: series_tz,
        rrule: row.rrule.clone(),
        rdate: row.rdate.iter().filter_map(|s| crate::timezone::parse_wall(s).ok()).collect(),
        exdate: row.exdate.iter().filter_map(|s| crate::timezone::parse_wall(s).ok()).collect(),
    };
    let occs = crate::rrule_engine::expand(&spec, ws, we, crate::rrule_engine::MAX_WINDOW_OCCURRENCES)?;

    // 例外：excluded 剔除、overridden 覆盖。复用现有 event_exceptions 加载。
    let exceptions = event_exceptions::load_for_window(
        connection, &row.id,
        &crate::timezone::format_wall(ws), &crate::timezone::format_wall(we),
    )?;

    for occ in occs {
        let slot_wall = crate::timezone::format_wall(occ.wall);
        match exceptions.get(&slot_wall) {
            Some(event_exceptions::Exception::Excluded) => {}
            Some(event_exceptions::Exception::Overridden(fields)) => {
                out.push(overridden_event(row, &slot_wall, fields));
            }
            None => out.push(event_from_series_row(row, Some(&slot_wall))),
        }
    }
    Ok(())
}
```

`overridden_event` 用 override 字段装配 Event（override 钟面继承系列时区，显示换算复用 `to_display_wall`）：

```rust
fn overridden_event(row: &SeriesRow, slot_wall: &str, fields: &event_exceptions::OverrideFields) -> Event {
    let mut event = event_from_series_row(row, Some(slot_wall));
    event.title = fields.title.clone();
    event.start_at = to_display_wall(&fields.start_at, &row.start_tz);
    event.end_at = to_display_wall(&fields.end_at, &row.end_tz);
    event.all_day = fields.all_day;
    event.category = fields.category.clone();
    event.color = fields.color.clone();
    event.note = fields.note.clone();
    event.is_overridden = true;
    event
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml events::tests::range_query_expands_tz_bound_series_via_engine events::tests::range_query_keeps_floating_events_by_wall_clock`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/events.rs
git commit -m "feat: range query with two-predicate split and rrule_engine expansion"
```

---

## Task 4：整包编译与既有测试重写

3a/3b 大改后，`events.rs`/`recurrence.rs` 里依赖旧分列模型的既有测试需重写或删除。

**Files:**
- Modify: `src-tauri/src/events.rs`（测试模块）

- [ ] **Step 1: 编译整包，收集所有失败点**

Run: `cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | grep -E "error\[|error:" | head -40`
Expected: 列出所有因字段/函数变化导致的编译错误。逐个修复调用点（构造 `Event`/`EventDraft` 处补 `start_tz`/`end_tz`/`rrule`；引用已删的 `recurrence_columns`/`RecurrenceColumns` 处改用 `ics_columns`/`IcsColumns`）。

- [ ] **Step 2: 重写依赖旧列的测试**

`events.rs` 测试里直接断言 `recurrence_freq`/`recurrence_by_day` 等列的用例（如 `recurrence_columns_of`、`weekly_columns`、`create_stores_final_at_for_a_counted_series`、`create_leaves_the_recurrence_columns_empty_for_a_single_event`），改为断言新列：`rrule`（串）、`recurrence_final_at`。例如「计数系列存 final_at」改为：

```rust
    #[test]
    fn create_stores_rrule_and_final_at_for_a_counted_series() {
        let mut connection = database();
        let created = create(&mut connection, EventDraft {
            recurrence: Some(Recurrence {
                freq: Freq::Weekly, interval: 1, by_day: vec!["MO".into()],
                end: RecurrenceEnd::Count { count: 3 },
            }),
            ..draft()
        }).unwrap();
        let (rrule, final_at): (Option<String>, Option<String>) = connection.query_row(
            "SELECT rrule, recurrence_final_at FROM events WHERE id=?1",
            [&created.id], |r| Ok((r.get(0)?, r.get(1)?)),
        ).unwrap();
        assert_eq!(rrule.as_deref(), Some("FREQ=WEEKLY;BYDAY=MO;COUNT=3"));
        assert!(final_at.is_some());
    }
```

对无法简单迁移、且其覆盖的行为已被 `rrule_engine::tests` 覆盖的旧展开测试（如 `expands_a_weekly_series_across_the_month`），可删除并在提交信息注明「行为已由 rrule_engine 测试覆盖」。

- [ ] **Step 3: 全量测试通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 整包编译通过，全部测试 PASS（含 Part 1/2 新测试、3a 迁移测试、3b 读写与范围测试；旧展开测试已迁移或删除）。

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/events.rs
git commit -m "test: migrate event tests to ICS model; drop superseded expansion tests"
```

---

## Task 5：Part 3b 收尾校验

**Files:** 无（仅校验）

- [ ] **Step 1: Rust 全绿**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全部通过。

- [ ] **Step 2: 更新总览进度**

在 overview 把 `A6 | 范围查询适配（浮动钟面 / 带时区 UTC 两路）` 标为 ✅。提交：

```bash
git add docs/superpowers/specs/2026-08-21-ics-calendar-overview.md
git commit -m "docs: mark range query milestone complete"
```

---

## Self-Review（对照 Spec A）

- **Spec 覆盖**：对应 Spec A 的「范围查询」「前端（后端换算部分）」与写入路径的时区绑定/UTC 缓存/RRULE 串。提醒与前端渲染属 Part 4。✅
- **占位符扫描**：无 TBD/TODO；读写与范围查询均给出完整代码与测试。保留逻辑（relink、event_exceptions 合并、编辑 split）明确标注为不变，非占位。✅
- **类型一致性**：`SeriesRow` 新字段、`event_from_series_row(&SeriesRow, Option<&str>)`、`to_display_wall(&str, &Option<String>)`、`ics_columns(&EventDraft)->IcsColumns`、`expand_series_into(...)`、`overridden_event(...)` 签名一致；调用 Part 2 `rrule_engine::{SeriesSpec, expand, MAX_WINDOW_OCCURRENCES}`、Part 1 `timezone::*`、Part 3a `rrule_bridge::*` 均与其定义匹配。✅
- **身份键不变**：`occurrence_start_at` 全程为系列时区钟面，与 `event_exceptions` 匹配，未被设备时区换算污染。✅
