use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
    pub field: Option<String>,
}

impl CommandError {
    fn public(code: &str, message: impl Into<String>, field: Option<&str>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            field: field.map(str::to_owned),
        }
    }

    pub fn validation(field: &str, message: impl Into<String>) -> Self {
        Self::public("validation_error", message, Some(field))
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::public("not_found", message, None)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::public("conflict", message, None)
    }

    pub fn database(error: impl std::fmt::Display) -> Self {
        eprintln!("database operation failed: {error}");
        Self::public("database_error", "无法读取本地数据，请重试。", None)
    }

    pub fn system(error: impl std::fmt::Display) -> Self {
        eprintln!("system operation failed: {error}");
        Self::public("system_error", "系统操作失败，请重试。", None)
    }

    /// A system failure whose message was written for the user.
    ///
    /// `system` redacts, because an internal error can carry a path, a query or a
    /// raw OS message. That redaction is the right default, but it also means a
    /// command that has already composed a specific, user-facing reason cannot
    /// report it: the caller's message is logged and thrown away, and the user
    /// gets "系统操作失败，请重试。" no matter what actually went wrong.
    ///
    /// This constructor is for that case only. The caller guarantees the message is
    /// a fixed, translated string it authored — never an error's own `Display`, and
    /// never anything carrying a path, a coordinate or captured content.
    pub fn reported(message: &'static str) -> Self {
        Self::public("system_error", message, None)
    }
}

#[cfg(test)]
mod tests {
    use super::CommandError;

    #[test]
    fn database_error_hides_internal_details() {
        let error = CommandError::database("SQLITE_BUSY at C:\\private\\nowly.sqlite");
        assert_eq!(error.code, "database_error");
        assert_eq!(error.message, "无法读取本地数据，请重试。");
        assert_eq!(error.field, None);
        assert!(!error.message.contains("SQLITE"));
    }

    #[test]
    fn business_errors_have_stable_public_payloads() {
        assert_eq!(
            CommandError::validation("title", "请输入日程标题。"),
            CommandError {
                code: "validation_error".into(),
                message: "请输入日程标题。".into(),
                field: Some("title".into()),
            }
        );
        assert_eq!(
            CommandError::not_found("未找到该日程。"),
            CommandError {
                code: "not_found".into(),
                message: "未找到该日程。".into(),
                field: None,
            }
        );
        assert_eq!(
            CommandError::conflict("日程关联已变化，请重试。"),
            CommandError {
                code: "conflict".into(),
                message: "日程关联已变化，请重试。".into(),
                field: None,
            }
        );
    }
}
