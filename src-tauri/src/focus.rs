use crate::db::AppDb;
use crate::error::CommandError;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusSession {
    pub id: String,
    pub planned_seconds: i64,
    pub focused_seconds: i64,
    pub status: String,
    pub started_at: String,
    pub ended_at: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusRange {
    pub start_at: String,
    pub end_at_exclusive: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusPeriodBoundary {
    pub period: String,
    pub start_at: String,
    pub end_at_exclusive: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusStatisticsPoint {
    pub period: String,
    pub focused_seconds: i64,
    pub completed_count: i64,
    pub interrupted_count: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusStatistics {
    pub total_focused_seconds: i64,
    pub completed_count: i64,
    pub interrupted_count: i64,
    pub completion_rate: f64,
    pub points: Vec<FocusStatisticsPoint>,
}

fn read_session(row: &Row<'_>) -> rusqlite::Result<FocusSession> {
    Ok(FocusSession {
        id: row.get(0)?,
        planned_seconds: row.get(1)?,
        focused_seconds: row.get(2)?,
        status: row.get(3)?,
        started_at: row.get(4)?,
        ended_at: row.get(5)?,
        created_at: row.get(6)?,
    })
}

fn by_id(connection: &Connection, id: &str) -> Result<Option<FocusSession>, CommandError> {
    connection.query_row(
        "SELECT id,planned_seconds,focused_seconds,status,started_at,ended_at,created_at FROM focus_sessions WHERE id=?1",
        [id], read_session,
    ).optional().map_err(CommandError::database)
}

fn validate(session: &FocusSession) -> Result<(), CommandError> {
    if session.id.trim().is_empty() {
        return Err(CommandError::validation("id", "专注会话编号无效。"));
    }
    if session.planned_seconds <= 0 {
        return Err(CommandError::validation("plannedSeconds", "计划时长无效。"));
    }
    if session.focused_seconds <= 0 {
        return Err(CommandError::validation("focusedSeconds", "专注时长无效。"));
    }
    if session.status != "completed" && session.status != "interrupted" {
        return Err(CommandError::validation("status", "专注状态无效。"));
    }
    Ok(())
}

pub fn create(
    connection: &Connection,
    session: FocusSession,
) -> Result<FocusSession, CommandError> {
    validate(&session)?;
    connection.execute(
        "INSERT INTO focus_sessions(id,planned_seconds,focused_seconds,status,started_at,ended_at,created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(id) DO NOTHING",
        params![session.id, session.planned_seconds, session.focused_seconds, session.status,
            session.started_at, session.ended_at, session.created_at],
    ).map_err(CommandError::database)?;
    by_id(connection, &session.id)?
        .ok_or_else(|| CommandError::conflict("专注记录保存状态已变化，请重试。"))
}

pub fn list(
    connection: &Connection,
    range: &FocusRange,
) -> Result<Vec<FocusSession>, CommandError> {
    let mut statement = connection
        .prepare(
            "SELECT id,planned_seconds,focused_seconds,status,started_at,ended_at,created_at
         FROM focus_sessions WHERE ended_at>=?1 AND ended_at<?2 ORDER BY ended_at DESC,id ASC",
        )
        .map_err(CommandError::database)?;
    let rows = statement
        .query_map(
            params![range.start_at, range.end_at_exclusive],
            read_session,
        )
        .map_err(CommandError::database)?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(CommandError::database)
}

pub fn statistics(
    connection: &Connection,
    boundaries: &[FocusPeriodBoundary],
) -> Result<FocusStatistics, CommandError> {
    let mut points = Vec::with_capacity(boundaries.len());
    let mut total_focused_seconds = 0;
    let mut completed_count = 0;
    let mut interrupted_count = 0;
    for boundary in boundaries {
        let (focused_seconds, completed, interrupted) = connection
            .query_row(
                "SELECT COALESCE(SUM(focused_seconds),0),
                    COALESCE(SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END),0),
                    COALESCE(SUM(CASE WHEN status='interrupted' THEN 1 ELSE 0 END),0)
             FROM focus_sessions WHERE ended_at>=?1 AND ended_at<?2",
                params![boundary.start_at, boundary.end_at_exclusive],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .map_err(CommandError::database)?;
        total_focused_seconds += focused_seconds;
        completed_count += completed;
        interrupted_count += interrupted;
        points.push(FocusStatisticsPoint {
            period: boundary.period.clone(),
            focused_seconds,
            completed_count: completed,
            interrupted_count: interrupted,
        });
    }
    let terminal_count = completed_count + interrupted_count;
    Ok(FocusStatistics {
        total_focused_seconds,
        completed_count,
        interrupted_count,
        completion_rate: if terminal_count == 0 {
            0.0
        } else {
            completed_count as f64 / terminal_count as f64
        },
        points,
    })
}

#[tauri::command]
pub fn create_focus_session(
    db: State<'_, AppDb>,
    session: FocusSession,
) -> Result<FocusSession, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    create(&connection, session)
}

#[tauri::command]
pub fn list_focus_sessions(
    db: State<'_, AppDb>,
    range: FocusRange,
) -> Result<Vec<FocusSession>, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    list(&connection, &range)
}

#[tauri::command]
pub fn get_focus_statistics(
    db: State<'_, AppDb>,
    boundaries: Vec<FocusPeriodBoundary>,
) -> Result<FocusStatistics, CommandError> {
    let connection = db.0.lock().map_err(CommandError::database)?;
    statistics(&connection, &boundaries)
}

#[cfg(test)]
mod tests {
    use super::{create, list, statistics, FocusPeriodBoundary, FocusRange, FocusSession};
    use crate::db::migrate;
    use rusqlite::Connection;

    fn database() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        connection
    }

    fn session(id: &str, status: &str, ended_at: &str, focused_seconds: i64) -> FocusSession {
        FocusSession {
            id: id.into(),
            planned_seconds: 1500,
            focused_seconds,
            status: status.into(),
            started_at: "2026-08-14T09:00:00Z".into(),
            ended_at: ended_at.into(),
            created_at: ended_at.into(),
        }
    }

    #[test]
    fn create_is_idempotent_and_preserves_the_canonical_row() {
        let connection = database();
        let original = session("s1", "completed", "2026-08-14T09:25:00Z", 1500);
        assert_eq!(create(&connection, original.clone()).unwrap(), original);
        let conflicting = session("s1", "interrupted", "2026-08-14T09:10:00Z", 600);
        assert_eq!(create(&connection, conflicting).unwrap(), original);
    }

    #[test]
    fn list_uses_an_exclusive_iso_range_and_orders_newest_first() {
        let connection = database();
        create(
            &connection,
            session("old", "completed", "2026-08-13T23:59:59Z", 60),
        )
        .unwrap();
        create(
            &connection,
            session("a", "completed", "2026-08-14T10:00:00Z", 300),
        )
        .unwrap();
        create(
            &connection,
            session("b", "interrupted", "2026-08-14T11:00:00Z", 120),
        )
        .unwrap();
        create(
            &connection,
            session("end", "completed", "2026-08-15T00:00:00Z", 60),
        )
        .unwrap();
        let records = list(
            &connection,
            &FocusRange {
                start_at: "2026-08-14T00:00:00Z".into(),
                end_at_exclusive: "2026-08-15T00:00:00Z".into(),
            },
        )
        .unwrap();
        assert_eq!(
            records.into_iter().map(|item| item.id).collect::<Vec<_>>(),
            vec!["b", "a"]
        );
    }

    #[test]
    fn statistics_zero_fill_boundaries_and_split_terminal_counts() {
        let connection = database();
        create(
            &connection,
            session("done", "completed", "2026-08-14T10:00:00Z", 1200),
        )
        .unwrap();
        create(
            &connection,
            session("stop", "interrupted", "2026-08-14T11:00:00Z", 300),
        )
        .unwrap();
        let result = statistics(
            &connection,
            &[
                FocusPeriodBoundary {
                    period: "2026-08-13".into(),
                    start_at: "2026-08-13T00:00:00Z".into(),
                    end_at_exclusive: "2026-08-14T00:00:00Z".into(),
                },
                FocusPeriodBoundary {
                    period: "2026-08-14".into(),
                    start_at: "2026-08-14T00:00:00Z".into(),
                    end_at_exclusive: "2026-08-15T00:00:00Z".into(),
                },
            ],
        )
        .unwrap();
        assert_eq!(result.total_focused_seconds, 1500);
        assert_eq!(result.completed_count, 1);
        assert_eq!(result.interrupted_count, 1);
        assert_eq!(result.completion_rate, 0.5);
        assert_eq!(result.points[0].focused_seconds, 0);
        assert_eq!(result.points[1].focused_seconds, 1500);
        assert_eq!(result.points[1].completed_count, 1);
        assert_eq!(result.points[1].interrupted_count, 1);
    }
}
