# ICS 日历 · Spec A 实现计划 · Part 1：依赖与时区换算层

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入 `chrono-tz` / `rrule` / `iana-time-zone` 依赖，并新建一个纯函数时区换算模块 `timezone.rs`，提供「钟面时间 ↔ UTC 瞬时点」双向换算、DST 断层/重叠处理与设备时区探测。

**Architecture:** 本 Part 只新增一个不依赖任何现有代码的纯模块 `src-tauri/src/timezone.rs`，以及 `Cargo.toml` 的依赖声明。它是 Spec A 的地基：Part 2 的 RRULE 引擎与 Part 3 的读写层都建立在它之上。不触碰 `events.rs`/`recurrence.rs`/schema，因此可独立落地、独立测试，落地后 app 行为不变。

**Tech Stack:** Rust、`chrono` 0.4、`chrono-tz` 0.10、`iana-time-zone` 0.1，`cargo test`。

> 本计划是 Spec A（`docs/superpowers/specs/2026-08-21-ics-calendar-a-engine-storage-design.md`）四份实现计划的第一份。后续：Part 2 RRULE 引擎、Part 3 schema+读写+范围查询、Part 4 提醒适配+前端。总览与进度见 `docs/superpowers/specs/2026-08-21-ics-calendar-overview.md`。

---

## 文件结构

- 创建：`src-tauri/src/timezone.rs` —— 纯函数时区换算模块。唯一职责：钟面时间与 UTC 之间的换算、DST 边界解析、设备时区探测。无状态、无 I/O（设备时区探测除外）、不依赖 `db`/`events`/`recurrence`。
- 修改：`src-tauri/Cargo.toml` —— 新增 `chrono-tz`、`rrule`、`iana-time-zone` 三个依赖。
- 修改：`src-tauri/src/main.rs` —— 注册 `mod timezone;`（仅一行，使模块进入编译）。

换算的真值约定（贯穿整个 Spec A）：

- **钟面时间**用 `%Y-%m-%dT%H:%M`（分钟精度，与现有 events 存储一致）。
- **UTC 缓存**用 `%Y-%m-%dT%H:%MZ`（分钟精度、带 `Z` 后缀）。
- **DST 断层**（春跳，钟面不存在）→ 取断层后的第一个有效瞬时点（later）。
- **DST 重叠**（秋回，钟面出现两次）→ 取第一次出现（earlier）。

---

## Task 1：引入依赖

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: 在 `[dependencies]` 增加三个依赖**

打开 `src-tauri/Cargo.toml`，在 `chrono = { version = "0.4", features = ["serde"] }` 这一行下面加入三行：

```toml
chrono-tz = { version = "0.10", features = ["serde"] }
rrule = "0.14"
iana-time-zone = "0.1"
```

- [ ] **Step 2: 拉取并编译依赖，确认版本兼容**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: 编译成功（会下载 `rrule`、`chrono-tz`；`iana-time-zone` 已在依赖树中）。无版本冲突报错。

- [ ] **Step 3: 提交**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: add chrono-tz, rrule, iana-time-zone dependencies"
```

---

## Task 2：注册空模块

**Files:**
- Create: `src-tauri/src/timezone.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: 创建带常量的空模块**

创建 `src-tauri/src/timezone.rs`，内容：

```rust
//! 时区换算层：钟面时间 ↔ UTC 瞬时点的双向换算，DST 断层/重叠解析，设备时区探测。
//! 纯函数、无状态，是 Spec A 时间模型的地基。

use crate::error::CommandError;
use chrono::{DateTime, Duration, LocalResult, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;

/// 钟面时间的存储格式（分钟精度），与 events 表一致。
pub const WALL_FORMAT: &str = "%Y-%m-%dT%H:%M";
/// UTC 缓存列的存储格式（分钟精度，带 Z 后缀）。
pub const UTC_FORMAT: &str = "%Y-%m-%dT%H:%MZ";
```

- [ ] **Step 2: 在 main.rs 注册模块**

在 `src-tauri/src/main.rs` 中，找到 `mod reminders;` 那一行（模块声明区），在其下方按字母序附近加入：

```rust
mod timezone;
```

- [ ] **Step 3: 编译确认模块被纳入**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: 编译成功。可能出现 `WALL_FORMAT`/`UTC_FORMAT` 未使用的 warning，属正常（后续 Task 会用到）。

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/timezone.rs src-tauri/src/main.rs
git commit -m "chore: register empty timezone module"
```

---

## Task 3：解析 IANA 时区名

**Files:**
- Modify: `src-tauri/src/timezone.rs`
- Test: 同文件 `#[cfg(test)] mod tests`

- [ ] **Step 1: 写失败测试**

在 `timezone.rs` 末尾加入测试模块：

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_valid_iana_name() {
        assert_eq!(parse_tz("Asia/Shanghai").unwrap(), Tz::Asia__Shanghai);
        assert_eq!(parse_tz("UTC").unwrap(), Tz::UTC);
    }

    #[test]
    fn rejects_an_unknown_name() {
        let err = parse_tz("Mars/Olympus").unwrap_err();
        assert_eq!(err.field.as_deref(), Some("timezone"));
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml timezone::tests::parses_a_valid_iana_name`
Expected: 编译失败，`cannot find function parse_tz`。

- [ ] **Step 3: 实现 parse_tz**

在 `timezone.rs` 的常量下方（测试模块之前）加入：

```rust
/// 把 IANA 时区名解析成 `chrono_tz::Tz`。未知名字返回校验错误。
pub fn parse_tz(name: &str) -> Result<Tz, CommandError> {
    name.parse::<Tz>()
        .map_err(|_| CommandError::validation("timezone", format!("未知的时区：{name}")))
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml timezone::tests`
Expected: PASS（2 个测试）。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/timezone.rs
git commit -m "feat: parse IANA timezone names in timezone layer"
```

---

## Task 4：钟面时间字符串解析

**Files:**
- Modify: `src-tauri/src/timezone.rs`

- [ ] **Step 1: 写失败测试**

在 `mod tests` 内加入：

```rust
    #[test]
    fn parses_wall_clock_strings() {
        let wall = parse_wall("2026-08-03T10:00").unwrap();
        assert_eq!(wall.format(WALL_FORMAT).to_string(), "2026-08-03T10:00");
    }

    #[test]
    fn rejects_malformed_wall_clock() {
        assert_eq!(
            parse_wall("nope").unwrap_err().field.as_deref(),
            Some("startAt")
        );
    }
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml timezone::tests::parses_wall_clock_strings`
Expected: 编译失败，`cannot find function parse_wall`。

- [ ] **Step 3: 实现 parse_wall**

在 `parse_tz` 下方加入：

```rust
/// 解析钟面时间字符串（`%Y-%m-%dT%H:%M`）。失败时字段名记为 `startAt`，
/// 便于校验错误直接对应到前端字段。
pub fn parse_wall(value: &str) -> Result<NaiveDateTime, CommandError> {
    NaiveDateTime::parse_from_str(value, WALL_FORMAT)
        .map_err(|_| CommandError::validation("startAt", "钟面时间格式无效。"))
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml timezone::tests`
Expected: PASS（4 个测试）。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/timezone.rs
git commit -m "feat: parse wall-clock strings in timezone layer"
```

---

## Task 5：钟面 → UTC 换算（含 DST 边界）

这是本模块的核心。`chrono` 的 `from_local_datetime` 对一个钟面时间返回三种结果：唯一、歧义（秋回重叠）、不存在（春跳断层）。按 Spec A：重叠取 earlier，断层取断层后的第一个有效瞬时点。

**Files:**
- Modify: `src-tauri/src/timezone.rs`

- [ ] **Step 1: 写失败测试（普通、重叠、断层三种）**

在 `mod tests` 内加入。测试用 `America/New_York` 的 2026 年 DST 边界：2026-03-08 02:00 春跳（02:00→03:00，02:30 不存在）；2026-11-01 02:00 秋回（01:00→02:00 前 01:30 出现两次）。

```rust
    #[test]
    fn converts_wall_to_utc_normally() {
        // 上海不实行夏令时，UTC+8 恒定：10:00 → 02:00Z。
        let utc = wall_to_utc(parse_wall("2026-08-03T10:00").unwrap(), Tz::Asia__Shanghai);
        assert_eq!(utc.format(UTC_FORMAT).to_string(), "2026-08-03T02:00Z");
    }

    #[test]
    fn spring_forward_gap_takes_the_instant_after_the_gap() {
        // 纽约 2026-03-08，02:00 跳到 03:00，02:30 不存在。
        // 断层后第一个有效钟面是 03:00 EDT(UTC-4) = 07:00Z。
        let utc = wall_to_utc(
            parse_wall("2026-03-08T02:30").unwrap(),
            Tz::America__New_York,
        );
        assert_eq!(utc.format(UTC_FORMAT).to_string(), "2026-03-08T07:00Z");
    }

    #[test]
    fn fall_back_overlap_takes_the_earlier_instant() {
        // 纽约 2026-11-01，01:30 出现两次。第一次是 EDT(UTC-4) = 05:30Z。
        let utc = wall_to_utc(
            parse_wall("2026-11-01T01:30").unwrap(),
            Tz::America__New_York,
        );
        assert_eq!(utc.format(UTC_FORMAT).to_string(), "2026-11-01T05:30Z");
    }
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml timezone::tests::converts_wall_to_utc_normally`
Expected: 编译失败，`cannot find function wall_to_utc`。

- [ ] **Step 3: 实现 wall_to_utc**

在 `parse_wall` 下方加入：

```rust
/// 把某具名时区下的钟面时间换算成 UTC 瞬时点。
/// DST 重叠（钟面出现两次）取第一次出现（earlier）；
/// DST 断层（钟面不存在）取断层后的第一个有效瞬时点（later）。
pub fn wall_to_utc(wall: NaiveDateTime, tz: Tz) -> DateTime<Utc> {
    match tz.from_local_datetime(&wall) {
        LocalResult::Single(dt) => dt.with_timezone(&Utc),
        LocalResult::Ambiguous(earlier, _later) => earlier.with_timezone(&Utc),
        LocalResult::None => {
            // 断层：该钟面在本地不存在。逐分钟前探，找到断层后第一个有效钟面，
            // 返回它对应的瞬时点。DST 断层至多数小时，3 小时窗口足以覆盖。
            let mut probe = wall;
            for _ in 0..(3 * 60) {
                probe += Duration::minutes(1);
                match tz.from_local_datetime(&probe) {
                    LocalResult::Single(dt) => return dt.with_timezone(&Utc),
                    LocalResult::Ambiguous(dt, _) => return dt.with_timezone(&Utc),
                    LocalResult::None => {}
                }
            }
            // 真实时区不会走到这里；兜底按 UTC 解释，保证函数全域有返回值。
            Utc.from_utc_datetime(&wall)
        }
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml timezone::tests`
Expected: PASS（7 个测试）。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/timezone.rs
git commit -m "feat: wall-clock to UTC conversion with DST gap and overlap handling"
```

---

## Task 6：UTC → 钟面换算（用于按设备时区显示）

**Files:**
- Modify: `src-tauri/src/timezone.rs`

- [ ] **Step 1: 写失败测试**

在 `mod tests` 内加入：

```rust
    #[test]
    fn converts_utc_to_wall_in_target_zone() {
        let instant = wall_to_utc(parse_wall("2026-08-03T10:00").unwrap(), Tz::Asia__Shanghai);
        // 同一瞬时点在纽约（EDT, UTC-4）是前一天 22:00。
        let wall = utc_to_wall(instant, Tz::America__New_York);
        assert_eq!(wall.format(WALL_FORMAT).to_string(), "2026-08-02T22:00");
    }
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml timezone::tests::converts_utc_to_wall_in_target_zone`
Expected: 编译失败，`cannot find function utc_to_wall`。

- [ ] **Step 3: 实现 utc_to_wall**

在 `wall_to_utc` 下方加入：

```rust
/// 把 UTC 瞬时点换算成某具名时区下的钟面时间。用于按设备时区显示带时区事件。
pub fn utc_to_wall(instant: DateTime<Utc>, tz: Tz) -> NaiveDateTime {
    instant.with_timezone(&tz).naive_local()
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml timezone::tests`
Expected: PASS（8 个测试）。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/timezone.rs
git commit -m "feat: UTC to wall-clock conversion in a target zone"
```

---

## Task 7：设备时区探测

**Files:**
- Modify: `src-tauri/src/timezone.rs`

- [ ] **Step 1: 写失败测试**

设备时区依赖运行环境，无法断言具体值，只断言「返回一个合法 Tz、且不 panic」。在 `mod tests` 内加入：

```rust
    #[test]
    fn device_tz_returns_a_valid_zone() {
        // 只要求不 panic 并返回一个合法时区；具体值取决于运行环境。
        let tz = device_tz();
        assert!(!tz.name().is_empty());
    }
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml timezone::tests::device_tz_returns_a_valid_zone`
Expected: 编译失败，`cannot find function device_tz`。

- [ ] **Step 3: 实现 device_tz**

在 `utc_to_wall` 下方加入：

```rust
/// 探测设备当前的 IANA 时区。探测失败或时区名无法解析时回退到 UTC，
/// 保证调用方永远拿到一个合法时区而不必处理错误。
pub fn device_tz() -> Tz {
    iana_time_zone::get_timezone()
        .ok()
        .and_then(|name| name.parse::<Tz>().ok())
        .unwrap_or(Tz::UTC)
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml timezone::tests`
Expected: PASS（9 个测试）。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/timezone.rs
git commit -m "feat: detect device IANA timezone with UTC fallback"
```

---

## Task 8：格式化辅助（钟面串 / UTC 串）

Part 3 写库时需要把 `NaiveDateTime` 与 `DateTime<Utc>` 格式化回存储字符串。集中在此提供，避免各处散落 `format` 调用。

**Files:**
- Modify: `src-tauri/src/timezone.rs`

- [ ] **Step 1: 写失败测试**

在 `mod tests` 内加入：

```rust
    #[test]
    fn formats_wall_and_utc_strings() {
        let wall = parse_wall("2026-08-03T10:00").unwrap();
        assert_eq!(format_wall(wall), "2026-08-03T10:00");
        let instant = wall_to_utc(wall, Tz::Asia__Shanghai);
        assert_eq!(format_utc(instant), "2026-08-03T02:00Z");
    }
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml timezone::tests::formats_wall_and_utc_strings`
Expected: 编译失败，`cannot find function format_wall`。

- [ ] **Step 3: 实现 format_wall / format_utc**

在 `device_tz` 下方加入：

```rust
/// 把钟面时间格式化成存储字符串（`%Y-%m-%dT%H:%M`）。
pub fn format_wall(wall: NaiveDateTime) -> String {
    wall.format(WALL_FORMAT).to_string()
}

/// 把 UTC 瞬时点格式化成缓存列字符串（`%Y-%m-%dT%H:%MZ`）。
pub fn format_utc(instant: DateTime<Utc>) -> String {
    instant.format(UTC_FORMAT).to_string()
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml timezone::tests`
Expected: PASS（10 个测试）。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/timezone.rs
git commit -m "feat: wall and UTC string formatting helpers"
```

---

## Task 9：往返一致性回归测试

锁定「钟面 → UTC → 钟面」在同一时区下的往返一致性（DST 边界外），作为整层的守卫测试。

**Files:**
- Modify: `src-tauri/src/timezone.rs`

- [ ] **Step 1: 写测试**

在 `mod tests` 内加入。含一个非整点偏移时区（`Asia/Kathmandu` +5:45）以覆盖非整点偏移：

```rust
    #[test]
    fn wall_utc_roundtrip_outside_dst_boundaries() {
        for (zone, wall_str) in [
            (Tz::Asia__Shanghai, "2026-08-03T10:00"),
            (Tz::Asia__Kathmandu, "2026-08-03T10:00"),
            (Tz::America__New_York, "2026-08-03T10:00"),
            (Tz::UTC, "2026-08-03T10:00"),
        ] {
            let wall = parse_wall(wall_str).unwrap();
            let instant = wall_to_utc(wall, zone);
            let back = utc_to_wall(instant, zone);
            assert_eq!(format_wall(back), wall_str, "zone {}", zone.name());
        }
    }
```

- [ ] **Step 2: 运行测试确认通过（实现已就绪，应直接通过）**

Run: `cargo test --manifest-path src-tauri/Cargo.toml timezone::tests`
Expected: PASS（11 个测试）。

- [ ] **Step 3: 提交**

```bash
git add src-tauri/src/timezone.rs
git commit -m "test: wall-UTC roundtrip consistency including non-integer offset zone"
```

---

## Task 10：Part 1 收尾校验

**Files:** 无（仅校验）

- [ ] **Step 1: 全量 Rust 测试通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全部通过，含新增的 11 个 `timezone::tests`，且原有 244 个测试不受影响（本 Part 未改动任何现有模块）。

- [ ] **Step 2: 无编译 warning 残留**

Run: `cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | grep -i warning`
Expected: 无 `timezone.rs` 相关的未使用 warning（所有公开函数都已被测试引用）。若有其他既存 warning 属历史遗留，不在本 Part 处理范围。

- [ ] **Step 3: 更新总览进度**

在 `docs/superpowers/specs/2026-08-21-ics-calendar-overview.md` 的 Spec A 进度表中，把 `A4 | 时区换算层（钟面↔UTC↔本机，DST 边界）` 的状态从 ⬜ 改为 ✅（A2 依赖引入也可一并标 ✅）。提交：

```bash
git add docs/superpowers/specs/2026-08-21-ics-calendar-overview.md
git commit -m "docs: mark timezone layer milestone complete"
```

---

## Self-Review（对照 Spec A 与本 Part 目标）

- **Spec 覆盖**：本 Part 对应 Spec A 的「依赖」与「时区换算层」两节，以及 DST 边界规则（春跳取 later、秋回取 earlier）。RRULE、schema、范围查询、提醒、前端属 Part 2–4，不在此。✅
- **占位符扫描**：无 TBD/TODO；每个代码步骤都给出完整实现与测试。✅
- **类型一致性**：`parse_tz`→`Tz`、`parse_wall`→`NaiveDateTime`、`wall_to_utc`→`DateTime<Utc>`、`utc_to_wall`→`NaiveDateTime`、`device_tz`→`Tz`、`format_wall`/`format_utc`→`String`，常量 `WALL_FORMAT`/`UTC_FORMAT` 全程一致引用。✅
- **DST 语义与 Spec 一致**：断层取后、重叠取前，测试用 `America/New_York` 2026 两个真实边界锁定。✅
