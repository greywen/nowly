# ICS 日历 · Spec A 实现计划 · Part 2：RRULE 引擎

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建一个纯函数模块 `rrule_engine.rs`，封装 `rrule` crate，把「dtstart 钟面 + 时区 + RRULE 串 + RDATE + EXDATE + 查询窗口」展开成落窗的实例列表，每个实例带系列时区下的钟面身份键与（带时区事件的）UTC 瞬时点。完整 RFC 5545 RRULE（含 `BYDAY` 序数、`BYSETPOS`、`WKST` 等）由 `rrule` crate 承担，DST 边界由其原生处理。

**Architecture:** 本 Part 只新增一个纯模块 `src-tauri/src/rrule_engine.rs`，依赖 Part 1 的 `timezone` 模块，不触碰 `events.rs`/`recurrence.rs`/schema。它把「一个系列在一个窗口内的所有实例」这件事收敛成单一入口 `expand`，供 Part 3 的读取层与 Spec C 的订阅展开复用。落地后 app 行为不变。

**Tech Stack:** Rust、`rrule` 0.14、`chrono` 0.4、`chrono-tz` 0.10，`cargo test`。

> 本计划是 Spec A（`docs/superpowers/specs/2026-08-21-ics-calendar-a-engine-storage-design.md`）四份实现计划的第二份。前置：Part 1（时区换算层）必须已落地。后续：Part 3 schema+读写+范围查询、Part 4 提醒适配+前端。

---

## 文件结构

- 创建：`src-tauri/src/rrule_engine.rs` —— 纯函数 RRULE 展开模块。唯一职责：把系列规格 + 窗口展开成实例列表。无状态、无 I/O，依赖 `timezone`（Part 1）与 `rrule` crate。
- 修改：`src-tauri/src/main.rs` —— 注册 `mod rrule_engine;`（一行）。

### 展开的真值约定

- **实例身份键**是系列自身时区（或浮动）下的钟面时间 `NaiveDateTime`，与现有例外表的 `occurrence_start_at` 语义一致。
- **窗口**以系列自身时区下的钟面时间半开区间 `[start, end)` 表达；调用方（Part 3）负责把设备时区窗口换算到系列时区再传入。
- **带时区事件**：每个实例同时给出 UTC 瞬时点（写 UTC 缓存 / 范围判定用）。
- **浮动事件**：UTC 瞬时点为 `None`（无固定瞬时点，钟面在任意时区都相同）。

### 与 `rrule` crate 的桥接方式（已实证）

- 用组合出的 ICS 文本 `parse::<RRuleSet>()` 构建系列：
  - 带时区：`DTSTART;TZID=Asia/Shanghai:20260803T100000\nRRULE:...`
  - 浮动：`DTSTART:20260803T100000\nRRULE:...`（无 TZID、无 `Z`）
- 窗口过滤用 `set.after(dt).before(dt).all(limit)`，返回 `RRuleResult { dates, limited }`。
- 每个 `DateTime<rrule::Tz>`：`.naive_local()` 取系列时区钟面（身份键），`.with_timezone(&Utc)` 取 UTC 瞬时点。
- `.after`/`.before` 按瞬时点比较，传入用 UTC 构造即可；结果的半开右界由本模块再过滤钟面 `< end` 保证。

---

## Task 1：注册空模块与数据类型

**Files:**
- Create: `src-tauri/src/rrule_engine.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: 创建模块骨架**

创建 `src-tauri/src/rrule_engine.rs`：

```rust
//! RRULE 展开引擎：封装 `rrule` crate，把系列规格在一个窗口内展开成实例列表。
//! 完整 RFC 5545 RRULE 与 DST 边界由 `rrule` crate 承担；本模块负责钟面/时区的
//! 桥接与半开窗口过滤。纯函数、无状态，依赖 Part 1 的 `timezone` 模块。

use crate::error::CommandError;
use crate::timezone;
use chrono::{DateTime, NaiveDateTime, Utc};
use chrono_tz::Tz;
use rrule::RRuleSet;

/// 一次展开得到的实例。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Occurrence {
    /// 系列自身时区（或浮动）下的钟面时间 —— 实例身份键。
    pub wall: NaiveDateTime,
    /// 带时区事件的 UTC 瞬时点；浮动事件为 None。
    pub utc: Option<DateTime<Utc>>,
}

/// 一个系列的展开输入。
#[derive(Debug, Clone)]
pub struct SeriesSpec {
    /// 系列开始的钟面时间（dtstart）。
    pub dtstart_wall: NaiveDateTime,
    /// 系列时区；None 表示浮动事件（无时区）。
    pub tz: Option<Tz>,
    /// RFC 5545 RRULE 串（如 `FREQ=WEEKLY;BYDAY=MO`）；None 表示单次事件。
    pub rrule: Option<String>,
    /// 附加发生时刻（RDATE），系列时区下的钟面时间。
    pub rdate: Vec<NaiveDateTime>,
    /// 排除发生时刻（EXDATE），系列时区下的钟面时间。
    pub exdate: Vec<NaiveDateTime>,
}

/// 单次展开的实例数量上限，防御超大/无限系列。与旧引擎的 MAX_WINDOW_OCCURRENCES 同量级。
pub const MAX_WINDOW_OCCURRENCES: usize = 1_000;
```

- [ ] **Step 2: 注册模块**

在 `src-tauri/src/main.rs` 模块声明区（`mod timezone;` 附近）加入：

```rust
mod rrule_engine;
```

- [ ] **Step 3: 编译确认**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: 编译成功。会有 `Occurrence`/`SeriesSpec`/常量未使用的 warning，属正常（后续 Task 使用）。

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/rrule_engine.rs src-tauri/src/main.rs
git commit -m "chore: register rrule_engine module with core types"
```

---

## Task 2：ICS 文本组合（内部辅助）

把 `SeriesSpec` 组合成 `rrule` crate 能解析的 ICS 文本。这是引擎的关键桥接点，单独 TDD。

**Files:**
- Modify: `src-tauri/src/rrule_engine.rs`

- [ ] **Step 1: 写失败测试**

在文件末尾加入测试模块：

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::timezone::parse_wall;

    #[test]
    fn composes_ics_for_a_tz_bound_series() {
        let spec = SeriesSpec {
            dtstart_wall: parse_wall("2026-08-03T10:00").unwrap(),
            tz: Some(Tz::Asia__Shanghai),
            rrule: Some("FREQ=WEEKLY;BYDAY=MO".into()),
            rdate: Vec::new(),
            exdate: Vec::new(),
        };
        let ics = compose_ics(&spec);
        assert_eq!(
            ics,
            "DTSTART;TZID=Asia/Shanghai:20260803T100000\nRRULE:FREQ=WEEKLY;BYDAY=MO"
        );
    }

    #[test]
    fn composes_ics_for_a_floating_series_with_exdate() {
        let spec = SeriesSpec {
            dtstart_wall: parse_wall("2026-01-01T09:00").unwrap(),
            tz: None,
            rrule: Some("FREQ=DAILY;COUNT=3".into()),
            rdate: vec![parse_wall("2026-01-10T09:00").unwrap()],
            exdate: vec![parse_wall("2026-01-02T09:00").unwrap()],
        };
        let ics = compose_ics(&spec);
        assert_eq!(
            ics,
            "DTSTART:20260101T090000\nRRULE:FREQ=DAILY;COUNT=3\nRDATE:20260110T090000\nEXDATE:20260102T090000"
        );
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rrule_engine::tests::composes_ics_for_a_tz_bound_series`
Expected: 编译失败，`cannot find function compose_ics`。

- [ ] **Step 3: 实现 compose_ics 与时间戳格式化**

在 `SeriesSpec` 定义下方加入：

```rust
/// rrule crate 解析 DTSTART/RDATE/EXDATE 用的秒级时间戳格式。
const ICS_STAMP: &str = "%Y%m%dT%H%M%S";

fn stamp(wall: NaiveDateTime) -> String {
    wall.format(ICS_STAMP).to_string()
}

/// 把系列规格组合成 rrule crate 能解析的 ICS 文本。
/// 带时区用 `DTSTART;TZID=<zone>:<stamp>`，浮动用 `DTSTART:<stamp>`。
/// RDATE/EXDATE 沿用 DTSTART 的时区语境（与 dtstart 同一钟面框架）。
fn compose_ics(spec: &SeriesSpec) -> String {
    let mut lines: Vec<String> = Vec::new();
    match spec.tz {
        Some(tz) => lines.push(format!("DTSTART;TZID={}:{}", tz.name(), stamp(spec.dtstart_wall))),
        None => lines.push(format!("DTSTART:{}", stamp(spec.dtstart_wall))),
    }
    if let Some(rule) = &spec.rrule {
        lines.push(format!("RRULE:{rule}"));
    }
    if !spec.rdate.is_empty() {
        let stamps: Vec<String> = spec.rdate.iter().map(|w| stamp(*w)).collect();
        lines.push(format!("RDATE:{}", stamps.join(",")));
    }
    if !spec.exdate.is_empty() {
        let stamps: Vec<String> = spec.exdate.iter().map(|w| stamp(*w)).collect();
        lines.push(format!("EXDATE:{}", stamps.join(",")));
    }
    lines.join("\n")
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rrule_engine::tests`
Expected: PASS（2 个测试）。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/rrule_engine.rs
git commit -m "feat: compose ICS text from a series spec"
```

---

## Task 3：展开重复系列（含 DST 与窗口过滤）

引擎主入口。这是本 Part 的核心。

**Files:**
- Modify: `src-tauri/src/rrule_engine.rs`

- [ ] **Step 1: 写失败测试（DST 偏移变化 + 窗口半开 + 序数星期）**

在 `mod tests` 内加入。DST 用实证过的 `America/New_York` 周会：3/2 是 15:00Z（EST），3/9 起是 14:00Z（EDT），钟面恒为 10:00。

```rust
    fn window(start: &str, end: &str) -> (NaiveDateTime, NaiveDateTime) {
        (parse_wall(start).unwrap(), parse_wall(end).unwrap())
    }

    #[test]
    fn expands_tz_bound_weekly_with_dst_offset_shift() {
        let spec = SeriesSpec {
            dtstart_wall: parse_wall("2026-03-02T10:00").unwrap(),
            tz: Some(Tz::America__New_York),
            rrule: Some("FREQ=WEEKLY;BYDAY=MO".into()),
            rdate: Vec::new(),
            exdate: Vec::new(),
        };
        let (s, e) = window("2026-03-01T00:00", "2026-03-31T00:00");
        let occ = expand(&spec, s, e, MAX_WINDOW_OCCURRENCES).unwrap();
        // 钟面恒为 10:00。
        assert!(occ.iter().all(|o| o.wall.format("%H:%M").to_string() == "10:00"));
        // 3/2 在 DST 前：15:00Z；3/9 在 DST 后：14:00Z。
        let by_date = |d: &str| occ.iter().find(|o| o.wall.format("%Y-%m-%d").to_string() == d).unwrap();
        assert_eq!(timezone::format_utc(by_date("2026-03-02").utc.unwrap()), "2026-03-02T15:00Z");
        assert_eq!(timezone::format_utc(by_date("2026-03-09").utc.unwrap()), "2026-03-09T14:00Z");
    }

    #[test]
    fn window_right_bound_is_half_open() {
        let spec = SeriesSpec {
            dtstart_wall: parse_wall("2026-08-01T10:00").unwrap(),
            tz: Some(Tz::Asia__Shanghai),
            rrule: Some("FREQ=DAILY".into()),
            rdate: Vec::new(),
            exdate: Vec::new(),
        };
        // 窗口 [8/1, 8/3)：应含 8/1、8/2，不含 8/3。
        let (s, e) = window("2026-08-01T00:00", "2026-08-03T00:00");
        let occ = expand(&spec, s, e, MAX_WINDOW_OCCURRENCES).unwrap();
        let dates: Vec<String> = occ.iter().map(|o| o.wall.format("%Y-%m-%d").to_string()).collect();
        assert_eq!(dates, vec!["2026-08-01", "2026-08-02"]);
    }

    #[test]
    fn expands_monthly_ordinal_weekday() {
        // 每月第 3 个周二。
        let spec = SeriesSpec {
            dtstart_wall: parse_wall("2026-01-01T09:00").unwrap(),
            tz: None,
            rrule: Some("FREQ=MONTHLY;BYDAY=TU;BYSETPOS=3".into()),
            rdate: Vec::new(),
            exdate: Vec::new(),
        };
        let (s, e) = window("2026-01-01T00:00", "2026-04-01T00:00");
        let occ = expand(&spec, s, e, MAX_WINDOW_OCCURRENCES).unwrap();
        let dates: Vec<String> = occ.iter().map(|o| o.wall.format("%Y-%m-%d").to_string()).collect();
        assert_eq!(dates, vec!["2026-01-20", "2026-02-17", "2026-03-17"]);
        // 浮动事件无 UTC 瞬时点。
        assert!(occ.iter().all(|o| o.utc.is_none()));
    }
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rrule_engine::tests::expands_tz_bound_weekly_with_dst_offset_shift`
Expected: 编译失败，`cannot find function expand`。

- [ ] **Step 3: 实现 expand（重复系列路径）**

在 `compose_ics` 下方加入。单次事件（`rrule` 为 None）在 Task 4 处理，此处先只处理 `rrule` 为 Some 的重复系列，单次路径先返回空以让重复测试通过；Task 4 补全。

```rust
/// 把 `[window_start_wall, window_end_excl_wall)`（系列时区钟面半开窗口）内的实例展开。
/// `limit` 为实例数量上限。带时区事件每个实例带 UTC 瞬时点；浮动事件为 None。
pub fn expand(
    spec: &SeriesSpec,
    window_start_wall: NaiveDateTime,
    window_end_excl_wall: NaiveDateTime,
    limit: usize,
) -> Result<Vec<Occurrence>, CommandError> {
    if window_start_wall >= window_end_excl_wall {
        return Ok(Vec::new());
    }
    // 单次事件路径在 Task 4 实现。
    let Some(_) = spec.rrule.as_ref() else {
        return expand_single(spec, window_start_wall, window_end_excl_wall);
    };

    // 窗口两端换算成 UTC 瞬时点，供 rrule 的 after/before 按瞬时点过滤。
    // 带时区：用系列时区把钟面窗口换算成 UTC；浮动：钟面即当作 UTC 瞬时点。
    let (after_utc, before_utc) = window_instants(spec, window_start_wall, window_end_excl_wall);

    let ics = compose_ics(spec);
    let set: RRuleSet = ics
        .parse()
        .map_err(|e| CommandError::validation("recurrence", format!("重复规则无效：{e}")))?;

    // after/before 按瞬时点闭区间过滤；右界的半开由下方钟面 < end 再保证。
    let after = to_rrule_utc(after_utc);
    let before = to_rrule_utc(before_utc);
    let result = set.after(after).before(before).all(limit as u16);

    let mut out = Vec::new();
    for dt in result.dates {
        let wall = dt.naive_local();
        // 半开右界：钟面 >= 窗口末端的实例（after/before 闭区间可能带入）剔除。
        if wall >= window_end_excl_wall {
            continue;
        }
        if wall < window_start_wall {
            continue;
        }
        let utc = if spec.tz.is_some() {
            Some(dt.with_timezone(&Utc))
        } else {
            None
        };
        out.push(Occurrence { wall, utc });
        if out.len() >= limit {
            break;
        }
    }
    Ok(out)
}

/// 把系列时区钟面窗口换算成 UTC 瞬时点对。
fn window_instants(
    spec: &SeriesSpec,
    start_wall: NaiveDateTime,
    end_wall: NaiveDateTime,
) -> (DateTime<Utc>, DateTime<Utc>) {
    match spec.tz {
        Some(tz) => (
            timezone::wall_to_utc(start_wall, tz),
            timezone::wall_to_utc(end_wall, tz),
        ),
        // 浮动：钟面直接当作 UTC 瞬时点（仅用于 after/before 的相对过滤，语义自洽）。
        None => (
            DateTime::<Utc>::from_naive_utc_and_offset(start_wall, Utc),
            DateTime::<Utc>::from_naive_utc_and_offset(end_wall, Utc),
        ),
    }
}

/// 把 UTC 瞬时点转成 rrule crate 的 `DateTime<rrule::Tz>`（UTC 载体，按瞬时点比较）。
fn to_rrule_utc(instant: DateTime<Utc>) -> DateTime<rrule::Tz> {
    instant.with_timezone(&rrule::Tz::UTC)
}
```

> 注：`rrule::Tz::UTC` 与 `RRuleResult` 已由 `use rrule::RRuleSet;` 所在 crate 提供；`rrule::Tz` 用全路径引用，避免与 `chrono_tz::Tz` 混淆。`all` 接收 `u16` 上限，`limit` 需转型。

- [ ] **Step 4: 加入单次事件占位实现（Task 4 补全）**

在 `expand` 下方加入临时占位，使重复测试可编译通过：

```rust
/// 单次事件展开（无 RRULE）：dtstart 加 rdate 减 exdate，过滤到窗口。Task 4 实现。
fn expand_single(
    _spec: &SeriesSpec,
    _start: NaiveDateTime,
    _end: NaiveDateTime,
) -> Result<Vec<Occurrence>, CommandError> {
    Ok(Vec::new())
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rrule_engine::tests`
Expected: PASS（5 个测试：2 个 compose + 3 个 expand）。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/src/rrule_engine.rs
git commit -m "feat: expand recurring series within a window with DST-correct UTC"
```

---

## Task 4：单次事件与 RDATE/EXDATE 展开

**Files:**
- Modify: `src-tauri/src/rrule_engine.rs`

- [ ] **Step 1: 写失败测试**

在 `mod tests` 内加入：

```rust
    #[test]
    fn expands_a_single_tz_bound_event() {
        let spec = SeriesSpec {
            dtstart_wall: parse_wall("2026-08-03T10:00").unwrap(),
            tz: Some(Tz::Asia__Shanghai),
            rrule: None,
            rdate: Vec::new(),
            exdate: Vec::new(),
        };
        let (s, e) = window("2026-08-01T00:00", "2026-09-01T00:00");
        let occ = expand(&spec, s, e, MAX_WINDOW_OCCURRENCES).unwrap();
        assert_eq!(occ.len(), 1);
        assert_eq!(occ[0].wall.format("%Y-%m-%dT%H:%M").to_string(), "2026-08-03T10:00");
        assert_eq!(timezone::format_utc(occ[0].utc.unwrap()), "2026-08-03T02:00Z");
    }

    #[test]
    fn single_event_outside_window_is_excluded() {
        let spec = SeriesSpec {
            dtstart_wall: parse_wall("2026-08-03T10:00").unwrap(),
            tz: None,
            rrule: None,
            rdate: Vec::new(),
            exdate: Vec::new(),
        };
        let (s, e) = window("2026-09-01T00:00", "2026-10-01T00:00");
        assert!(expand(&spec, s, e, MAX_WINDOW_OCCURRENCES).unwrap().is_empty());
    }

    #[test]
    fn single_event_with_rdate_and_exdate() {
        // dtstart 被 exdate 排除，只剩一个 rdate。
        let spec = SeriesSpec {
            dtstart_wall: parse_wall("2026-08-03T10:00").unwrap(),
            tz: None,
            rrule: None,
            rdate: vec![parse_wall("2026-08-10T10:00").unwrap()],
            exdate: vec![parse_wall("2026-08-03T10:00").unwrap()],
        };
        let (s, e) = window("2026-08-01T00:00", "2026-09-01T00:00");
        let occ = expand(&spec, s, e, MAX_WINDOW_OCCURRENCES).unwrap();
        let dates: Vec<String> = occ.iter().map(|o| o.wall.format("%Y-%m-%d").to_string()).collect();
        assert_eq!(dates, vec!["2026-08-10"]);
    }
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rrule_engine::tests::expands_a_single_tz_bound_event`
Expected: FAIL（占位返回空，断言 `occ.len()==1` 失败）。

- [ ] **Step 3: 实现 expand_single**

用实现替换 Task 3 的占位 `expand_single`：

```rust
/// 单次事件展开（无 RRULE）：候选 = {dtstart} ∪ rdate，减去 exdate，过滤到窗口。
fn expand_single(
    spec: &SeriesSpec,
    start: NaiveDateTime,
    end: NaiveDateTime,
) -> Result<Vec<Occurrence>, CommandError> {
    let mut candidates: Vec<NaiveDateTime> = Vec::new();
    candidates.push(spec.dtstart_wall);
    candidates.extend(spec.rdate.iter().copied());
    candidates.retain(|w| !spec.exdate.contains(w));
    candidates.sort_unstable();
    candidates.dedup();

    let mut out = Vec::new();
    for wall in candidates {
        if wall < start || wall >= end {
            continue;
        }
        let utc = spec.tz.map(|tz| timezone::wall_to_utc(wall, tz));
        out.push(Occurrence { wall, utc });
    }
    Ok(out)
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rrule_engine::tests`
Expected: PASS（8 个测试）。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/rrule_engine.rs
git commit -m "feat: expand single events with RDATE/EXDATE"
```

---

## Task 5：COUNT / UNTIL 结束条件与上限防御

**Files:**
- Modify: `src-tauri/src/rrule_engine.rs`

- [ ] **Step 1: 写失败测试**

在 `mod tests` 内加入：

```rust
    #[test]
    fn count_bound_series_stops_after_n() {
        let spec = SeriesSpec {
            dtstart_wall: parse_wall("2026-08-01T10:00").unwrap(),
            tz: None,
            rrule: Some("FREQ=DAILY;COUNT=3".into()),
            rdate: Vec::new(),
            exdate: Vec::new(),
        };
        let (s, e) = window("2026-08-01T00:00", "2026-09-01T00:00");
        let occ = expand(&spec, s, e, MAX_WINDOW_OCCURRENCES).unwrap();
        assert_eq!(occ.len(), 3);
    }

    #[test]
    fn until_bound_series_is_inclusive_of_the_until_date() {
        let spec = SeriesSpec {
            dtstart_wall: parse_wall("2026-08-01T10:00").unwrap(),
            tz: None,
            rrule: Some("FREQ=DAILY;UNTIL=20260803T100000".into()),
            rdate: Vec::new(),
            exdate: Vec::new(),
        };
        let (s, e) = window("2026-08-01T00:00", "2026-09-01T00:00");
        let occ = expand(&spec, s, e, MAX_WINDOW_OCCURRENCES).unwrap();
        let dates: Vec<String> = occ.iter().map(|o| o.wall.format("%Y-%m-%d").to_string()).collect();
        assert_eq!(dates, vec!["2026-08-01", "2026-08-02", "2026-08-03"]);
    }

    #[test]
    fn infinite_series_is_capped_by_limit() {
        let spec = SeriesSpec {
            dtstart_wall: parse_wall("2026-01-01T10:00").unwrap(),
            tz: None,
            rrule: Some("FREQ=DAILY".into()),
            rdate: Vec::new(),
            exdate: Vec::new(),
        };
        // 十年窗口的每日无限系列，被 limit 截断。
        let (s, e) = window("2026-01-01T00:00", "2036-01-01T00:00");
        let occ = expand(&spec, s, e, 5).unwrap();
        assert_eq!(occ.len(), 5);
    }
```

- [ ] **Step 2: 运行测试确认通过（实现已就绪，应直接通过）**

`expand` 已用 `set.after().before().all(limit)` 天然支持 COUNT/UNTIL 与上限，本 Task 的测试是对已实现行为的锁定。

Run: `cargo test --manifest-path src-tauri/Cargo.toml rrule_engine::tests`
Expected: PASS（11 个测试）。若 `infinite_series_is_capped_by_limit` 未被截断，检查 `all(limit as u16)` 与出口 `out.len() >= limit` 是否都生效。

- [ ] **Step 3: 提交**

```bash
git add src-tauri/src/rrule_engine.rs
git commit -m "test: lock COUNT/UNTIL end conditions and occurrence cap"
```

---

## Task 6：Part 2 收尾校验

**Files:** 无（仅校验）

- [ ] **Step 1: 全量 Rust 测试通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全部通过，含新增的 11 个 `rrule_engine::tests`，Part 1 的 `timezone::tests` 与原有测试不受影响（本 Part 未改动现有模块）。

- [ ] **Step 2: 更新总览进度**

在 `docs/superpowers/specs/2026-08-21-ics-calendar-overview.md` 的 Spec A 进度表中，把 `A5 | 完整 RRULE 解析/展开/往返 + RDATE/EXDATE` 状态从 ⬜ 改为 ✅。提交：

```bash
git add docs/superpowers/specs/2026-08-21-ics-calendar-overview.md
git commit -m "docs: mark RRULE engine milestone complete"
```

---

## Self-Review（对照 Spec A 与本 Part 目标）

- **Spec 覆盖**：本 Part 对应 Spec A 的「完整 RRULE 引擎」与「DST 边界」两节。`FREQ`/`INTERVAL`/`BY*`/`BYSETPOS`/`WKST`/`COUNT`/`UNTIL` 由 `rrule` crate 承担并经测试验证（序数星期 `BYSETPOS=3`、COUNT、UNTIL）；`RDATE`/`EXDATE` 在重复与单次两条路径均覆盖。DST 由 `America/New_York` 周会的 UTC 偏移变化锁定。✅
- **占位符扫描**：无 TBD/TODO。Task 3 的 `expand_single` 占位在 Task 4 被真实实现替换，非遗留占位。✅
- **类型一致性**：`Occurrence { wall: NaiveDateTime, utc: Option<DateTime<Utc>> }`、`SeriesSpec`、`expand(&SeriesSpec, NaiveDateTime, NaiveDateTime, usize) -> Result<Vec<Occurrence>, CommandError>` 全程一致；`compose_ics`/`window_instants`/`to_rrule_utc`/`expand_single` 签名与调用点匹配。✅
- **与 Part 1 衔接**：复用 `timezone::wall_to_utc`/`format_utc`/`parse_wall`，无重复实现。✅
- **与 Part 3 衔接**：`expand` 的窗口以系列时区钟面表达，实例身份键为系列时区钟面，正对齐 Part 3 的读取层与例外表 `occurrence_start_at`。✅
