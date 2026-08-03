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
