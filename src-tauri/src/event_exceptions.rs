use crate::error::CommandError;
use rusqlite::{params, Connection, Row};
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OverrideFields {
    pub title: String,
    pub start_at: String,
    pub end_at: String,
    pub all_day: bool,
    pub category: String,
    pub color: String,
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Exception {
    Excluded,
    Overridden(OverrideFields),
}

/// 键为 `occurrence_start_at`，即该次「原本」应发生的时刻。
pub type ExceptionMap = HashMap<String, Exception>;

fn read_exception(row: &Row<'_>) -> rusqlite::Result<(String, Exception)> {
    let slot: String = row.get(0)?;
    let kind: String = row.get(1)?;
    if kind == "excluded" {
        return Ok((slot, Exception::Excluded));
    }
    Ok((
        slot,
        Exception::Overridden(OverrideFields {
            title: row.get(2)?,
            start_at: row.get(3)?,
            end_at: row.get(4)?,
            all_day: row.get::<_, i64>(5)? == 1,
            category: row.get(6)?,
            color: row.get(7)?,
            note: row.get(8)?,
        }),
    ))
}

/// 同时取回两类例外：影响窗口内槽位的，以及被覆盖后移入窗口的。
/// 覆盖会把实例移出或移入窗口，只按 `occurrence_start_at` 筛会让前者照原样渲染、后者彻底消失。
pub fn load_for_window(
    connection: &Connection,
    series_id: &str,
    window_start: &str,
    window_end_exclusive: &str,
) -> Result<ExceptionMap, CommandError> {
    let mut statement = connection
        .prepare(
            "SELECT occurrence_start_at,kind,title,start_at,end_at,all_day,category,color,note
             FROM event_exceptions
             WHERE series_id=?1
               AND ((occurrence_start_at >= ?2 AND occurrence_start_at < ?3)
                    OR (kind='overridden' AND start_at >= ?2 AND start_at < ?3))",
        )
        .map_err(CommandError::database)?;
    let rows = statement
        .query_map(
            params![series_id, window_start, window_end_exclusive],
            read_exception,
        )
        .map_err(CommandError::database)?;
    let mut map = ExceptionMap::new();
    for row in rows {
        let (slot, exception) = row.map_err(CommandError::database)?;
        map.insert(slot, exception);
    }
    Ok(map)
}

pub fn upsert_excluded(
    connection: &Connection,
    series_id: &str,
    slot: &str,
    now: &str,
) -> Result<(), CommandError> {
    connection
        .execute(
            "INSERT INTO event_exceptions(id,series_id,occurrence_start_at,kind,
                                          title,start_at,end_at,all_day,category,color,note,
                                          created_at,updated_at)
             VALUES (?1,?2,?3,'excluded',NULL,NULL,NULL,NULL,NULL,NULL,NULL,?4,?4)
             ON CONFLICT(series_id,occurrence_start_at) DO UPDATE SET
               kind='excluded',title=NULL,start_at=NULL,end_at=NULL,all_day=NULL,
               category=NULL,color=NULL,note=NULL,updated_at=?4",
            params![
                Uuid::new_v4().hyphenated().to_string(),
                series_id,
                slot,
                now
            ],
        )
        .map(|_| ())
        .map_err(CommandError::database)
}

pub fn upsert_overridden(
    connection: &Connection,
    series_id: &str,
    slot: &str,
    fields: &OverrideFields,
    now: &str,
) -> Result<(), CommandError> {
    connection
        .execute(
            "INSERT INTO event_exceptions(id,series_id,occurrence_start_at,kind,
                                          title,start_at,end_at,all_day,category,color,note,
                                          created_at,updated_at)
             VALUES (?1,?2,?3,'overridden',?4,?5,?6,?7,?8,?9,?10,?11,?11)
             ON CONFLICT(series_id,occurrence_start_at) DO UPDATE SET
               kind='overridden',title=?4,start_at=?5,end_at=?6,all_day=?7,
               category=?8,color=?9,note=?10,updated_at=?11",
            params![
                Uuid::new_v4().hyphenated().to_string(),
                series_id,
                slot,
                fields.title,
                fields.start_at,
                fields.end_at,
                i64::from(fields.all_day),
                fields.category,
                fields.color,
                fields.note,
                now
            ],
        )
        .map(|_| ())
        .map_err(CommandError::database)
}

pub fn delete_from(
    connection: &Connection,
    series_id: &str,
    slot: &str,
) -> Result<(), CommandError> {
    connection
        .execute(
            "DELETE FROM event_exceptions WHERE series_id=?1 AND occurrence_start_at >= ?2",
            params![series_id, slot],
        )
        .map(|_| ())
        .map_err(CommandError::database)
}

pub fn delete_all(connection: &Connection, series_id: &str) -> Result<(), CommandError> {
    connection
        .execute(
            "DELETE FROM event_exceptions WHERE series_id=?1",
            [series_id],
        )
        .map(|_| ())
        .map_err(CommandError::database)
}

pub fn move_from(
    connection: &Connection,
    series_id: &str,
    slot: &str,
    new_series_id: &str,
) -> Result<(), CommandError> {
    connection
        .execute(
            "UPDATE event_exceptions SET series_id=?3
             WHERE series_id=?1 AND occurrence_start_at >= ?2",
            params![series_id, slot, new_series_id],
        )
        .map(|_| ())
        .map_err(CommandError::database)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;
    use rusqlite::{Connection, OptionalExtension};

    const WINDOW_START: &str = "2026-08-01T00:00";
    const WINDOW_END: &str = "2026-09-01T00:00";

    fn seeded() -> Connection {
        let mut connection = Connection::open_in_memory().expect("memory db opens");
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .expect("foreign keys on");
        migrate(&mut connection).expect("migration succeeds");
        for id in ["s1", "s2"] {
            connection
                .execute(
                    "INSERT INTO events(id,title,start_at,end_at,all_day,category,color,note,created_at,updated_at,rrule)
                     VALUES (?1,'周会','2026-08-03T10:00','2026-08-03T11:00',0,'work','#0BB783','','t','t','FREQ=WEEKLY;BYDAY=MO')",
                    [id],
                )
                .expect("series inserts");
        }
        connection
    }

    fn moved_to(start_at: &str, end_at: &str) -> OverrideFields {
        OverrideFields {
            title: "改期周会".into(),
            start_at: start_at.into(),
            end_at: end_at.into(),
            all_day: false,
            category: "work".into(),
            color: "#0BB783".into(),
            note: String::new(),
        }
    }

    fn slots(connection: &Connection, series_id: &str) -> Vec<String> {
        let mut statement = connection
            .prepare(
                "SELECT occurrence_start_at FROM event_exceptions
                 WHERE series_id=?1 ORDER BY occurrence_start_at ASC",
            )
            .expect("statement prepares");
        let rows = statement
            .query_map([series_id], |row| row.get::<_, String>(0))
            .expect("query runs");
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .expect("slots collect")
    }

    #[test]
    fn upsert_replaces_the_slot_instead_of_adding_a_row() {
        let connection = seeded();
        upsert_excluded(&connection, "s1", "2026-08-10T10:00", "t1").expect("exclude");
        upsert_overridden(
            &connection,
            "s1",
            "2026-08-10T10:00",
            &moved_to("2026-08-11T14:00", "2026-08-11T15:00"),
            "t2",
        )
        .expect("override");

        let rows: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM event_exceptions WHERE series_id='s1'",
                [],
                |row| row.get(0),
            )
            .expect("count runs");
        assert_eq!(rows, 1);
        let kind: String = connection
            .query_row(
                "SELECT kind FROM event_exceptions WHERE series_id='s1'",
                [],
                |row| row.get(0),
            )
            .expect("kind reads");
        assert_eq!(kind, "overridden");
    }

    /// 排除必须清空覆盖载荷：残留的覆盖字段会让「先排除、后覆盖」的顺序失效，
    /// 被排除的槽位反而以旧的覆盖形态复活。
    #[test]
    fn switching_to_excluded_clears_the_override_payload() {
        let connection = seeded();
        upsert_overridden(
            &connection,
            "s1",
            "2026-08-10T10:00",
            &moved_to("2026-08-11T14:00", "2026-08-11T15:00"),
            "t1",
        )
        .expect("override");
        let (id, created_at): (String, String) = connection
            .query_row(
                "SELECT id,created_at FROM event_exceptions WHERE series_id='s1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("row reads");

        upsert_excluded(&connection, "s1", "2026-08-10T10:00", "t2").expect("exclude");

        let nulls: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM event_exceptions
                 WHERE series_id='s1' AND kind='excluded'
                   AND title IS NULL AND start_at IS NULL AND end_at IS NULL
                   AND all_day IS NULL AND category IS NULL AND color IS NULL AND note IS NULL",
                [],
                |row| row.get(0),
            )
            .expect("count runs");
        assert_eq!(nulls, 1, "排除后覆盖字段必须全部清空");

        let (same_id, same_created_at, updated_at): (String, String, String) = connection
            .query_row(
                "SELECT id,created_at,updated_at FROM event_exceptions WHERE series_id='s1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("row reads");
        assert_eq!(same_id, id, "覆盖同一槽位不得换行");
        assert_eq!(same_created_at, created_at, "created_at 不得被改写");
        assert_eq!(updated_at, "t2");

        let loaded =
            load_for_window(&connection, "s1", WINDOW_START, WINDOW_END).expect("load runs");
        assert_eq!(loaded.get("2026-08-10T10:00"), Some(&Exception::Excluded));
    }

    /// 逐字段回读，锁住 SELECT 的列序与 `read_exception` 的取值下标一致。
    #[test]
    fn loads_the_full_override_payload() {
        let connection = seeded();
        let fields = OverrideFields {
            title: "季度复盘".into(),
            start_at: "2026-08-12T09:30".into(),
            end_at: "2026-08-12T18:45".into(),
            all_day: true,
            category: "personal".into(),
            color: "#4FC9DA".into(),
            note: "带上上季度数据".into(),
        };
        upsert_overridden(&connection, "s1", "2026-08-10T10:00", &fields, "t").expect("override");

        let loaded =
            load_for_window(&connection, "s1", WINDOW_START, WINDOW_END).expect("load runs");
        assert_eq!(
            loaded.get("2026-08-10T10:00"),
            Some(&Exception::Overridden(fields))
        );
    }

    /// 槽位在窗口内、被改到窗口外：例外必须回来，否则调用方会照原样渲染这一次。
    #[test]
    fn loads_a_slot_that_moves_out_of_the_window() {
        let connection = seeded();
        upsert_overridden(
            &connection,
            "s1",
            "2026-08-10T10:00",
            &moved_to("2026-09-15T14:00", "2026-09-15T15:00"),
            "t",
        )
        .expect("override");

        let loaded =
            load_for_window(&connection, "s1", WINDOW_START, WINDOW_END).expect("load runs");
        assert_eq!(loaded.len(), 1);
        match loaded.get("2026-08-10T10:00") {
            Some(Exception::Overridden(fields)) => {
                assert!(fields.start_at.as_str() >= WINDOW_END, "该次已被移出窗口");
            }
            other => panic!("窗口内槽位的覆盖必须被读回，实际为 {other:?}"),
        }
    }

    /// 槽位在窗口外、被改到窗口内：例外必须回来，否则这一次在本窗口彻底消失。
    #[test]
    fn loads_a_slot_that_moves_into_the_window() {
        let connection = seeded();
        upsert_overridden(
            &connection,
            "s1",
            "2026-09-07T10:00",
            &moved_to("2026-08-20T09:00", "2026-08-20T10:00"),
            "t",
        )
        .expect("override");

        let loaded =
            load_for_window(&connection, "s1", WINDOW_START, WINDOW_END).expect("load runs");
        assert_eq!(loaded.len(), 1);
        match loaded.get("2026-09-07T10:00") {
            Some(Exception::Overridden(fields)) => {
                assert!(
                    fields.start_at.as_str() >= WINDOW_START
                        && fields.start_at.as_str() < WINDOW_END,
                    "该次已被移入窗口"
                );
            }
            other => panic!("被移入窗口的覆盖必须被读回，实际为 {other:?}"),
        }
    }

    #[test]
    fn ignores_exceptions_untouched_by_the_window() {
        let connection = seeded();
        upsert_excluded(&connection, "s1", "2026-10-05T10:00", "t").expect("exclude");
        upsert_overridden(
            &connection,
            "s1",
            "2026-10-12T10:00",
            &moved_to("2026-11-02T14:00", "2026-11-02T15:00"),
            "t",
        )
        .expect("override");

        let loaded =
            load_for_window(&connection, "s1", WINDOW_START, WINDOW_END).expect("load runs");
        assert!(loaded.is_empty(), "窗口外的例外不得被读回：{loaded:?}");
    }

    #[test]
    fn ignores_exceptions_from_other_series() {
        let connection = seeded();
        upsert_excluded(&connection, "s2", "2026-08-17T10:00", "t").expect("exclude");
        upsert_overridden(
            &connection,
            "s2",
            "2026-09-07T10:00",
            &moved_to("2026-08-20T09:00", "2026-08-20T10:00"),
            "t",
        )
        .expect("override");

        let loaded =
            load_for_window(&connection, "s1", WINDOW_START, WINDOW_END).expect("load runs");
        assert!(loaded.is_empty(), "别的系列的例外不得被读回：{loaded:?}");
    }

    #[test]
    fn loads_exclusions_and_overrides_together() {
        let connection = seeded();
        upsert_overridden(
            &connection,
            "s1",
            "2026-09-07T10:00",
            &moved_to("2026-08-20T09:00", "2026-08-20T10:00"),
            "t",
        )
        .expect("override");
        upsert_excluded(&connection, "s1", "2026-08-17T10:00", "t").expect("exclude");
        upsert_overridden(
            &connection,
            "s1",
            "2026-08-10T10:00",
            &moved_to("2026-09-15T14:00", "2026-09-15T15:00"),
            "t",
        )
        .expect("override");
        upsert_excluded(&connection, "s1", "2026-10-05T10:00", "t").expect("exclude");
        upsert_excluded(&connection, "s2", "2026-08-24T10:00", "t").expect("exclude");

        let loaded =
            load_for_window(&connection, "s1", WINDOW_START, WINDOW_END).expect("load runs");
        assert_eq!(loaded.len(), 3, "实际读回 {loaded:?}");
        assert_eq!(loaded.get("2026-08-17T10:00"), Some(&Exception::Excluded));
        assert!(matches!(
            loaded.get("2026-09-07T10:00"),
            Some(Exception::Overridden(_))
        ));
        assert!(matches!(
            loaded.get("2026-08-10T10:00"),
            Some(Exception::Overridden(_))
        ));
    }

    #[test]
    fn window_bounds_are_half_open_on_both_columns() {
        let connection = seeded();
        upsert_excluded(&connection, "s1", WINDOW_START, "t").expect("exclude at start");
        upsert_excluded(&connection, "s1", WINDOW_END, "t").expect("exclude at end");
        upsert_overridden(
            &connection,
            "s1",
            "2026-12-01T10:00",
            &moved_to(WINDOW_START, "2026-08-01T01:00"),
            "t",
        )
        .expect("override onto start");
        upsert_overridden(
            &connection,
            "s1",
            "2026-12-08T10:00",
            &moved_to(WINDOW_END, "2026-09-01T01:00"),
            "t",
        )
        .expect("override onto end");

        let loaded =
            load_for_window(&connection, "s1", WINDOW_START, WINDOW_END).expect("load runs");
        assert_eq!(loaded.len(), 2, "实际读回 {loaded:?}");
        assert!(loaded.contains_key(WINDOW_START), "窗口起点包含在内");
        assert!(!loaded.contains_key(WINDOW_END), "窗口终点不包含在内");
        assert!(
            loaded.contains_key("2026-12-01T10:00"),
            "被移到窗口起点的例外包含在内"
        );
        assert!(
            !loaded.contains_key("2026-12-08T10:00"),
            "被移到窗口终点的例外不包含在内"
        );
    }

    #[test]
    fn delete_from_removes_the_slot_and_everything_after() {
        let connection = seeded();
        upsert_excluded(&connection, "s1", "2026-08-03T10:00", "t").expect("exclude");
        upsert_excluded(&connection, "s1", "2026-08-10T10:00", "t").expect("exclude");
        upsert_excluded(&connection, "s1", "2026-08-17T10:00", "t").expect("exclude");
        upsert_excluded(&connection, "s2", "2026-08-17T10:00", "t").expect("exclude");

        delete_from(&connection, "s1", "2026-08-10T10:00").expect("delete runs");

        assert_eq!(slots(&connection, "s1"), vec!["2026-08-03T10:00"]);
        assert_eq!(slots(&connection, "s2"), vec!["2026-08-17T10:00"]);
    }

    #[test]
    fn delete_all_removes_only_the_target_series() {
        let connection = seeded();
        upsert_excluded(&connection, "s1", "2026-08-03T10:00", "t").expect("exclude");
        upsert_excluded(&connection, "s1", "2026-08-17T10:00", "t").expect("exclude");
        upsert_excluded(&connection, "s2", "2026-08-17T10:00", "t").expect("exclude");

        delete_all(&connection, "s1").expect("delete runs");

        assert!(slots(&connection, "s1").is_empty());
        assert_eq!(slots(&connection, "s2"), vec!["2026-08-17T10:00"]);
    }

    #[test]
    fn move_from_reassigns_the_slot_and_everything_after() {
        let connection = seeded();
        upsert_excluded(&connection, "s1", "2026-08-03T10:00", "t").expect("exclude");
        upsert_overridden(
            &connection,
            "s1",
            "2026-08-10T10:00",
            &moved_to("2026-08-11T14:00", "2026-08-11T15:00"),
            "t",
        )
        .expect("override");
        upsert_excluded(&connection, "s1", "2026-08-17T10:00", "t").expect("exclude");
        upsert_excluded(&connection, "s2", "2026-08-24T10:00", "t").expect("exclude");

        move_from(&connection, "s1", "2026-08-10T10:00", "s2").expect("move runs");

        assert_eq!(slots(&connection, "s1"), vec!["2026-08-03T10:00"]);
        assert_eq!(
            slots(&connection, "s2"),
            vec!["2026-08-10T10:00", "2026-08-17T10:00", "2026-08-24T10:00"]
        );
        let moved_kind: Option<String> = connection
            .query_row(
                "SELECT kind FROM event_exceptions
                 WHERE series_id='s2' AND occurrence_start_at='2026-08-10T10:00'",
                [],
                |row| row.get(0),
            )
            .optional()
            .expect("kind reads");
        assert_eq!(moved_kind.as_deref(), Some("overridden"));
    }
}
