use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
    pub field: Option<String>,
}

impl CommandError {
    pub fn database(error: impl std::fmt::Display) -> Self {
        eprintln!("database operation failed: {error}");
        Self {
            code: "database_error".to_string(),
            message: "无法读取本地数据，请重试。".to_string(),
            field: None,
        }
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
}
