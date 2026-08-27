//! 前端简单重复结构 `Recurrence` 与标准 RFC 5545 RRULE 串之间的双向桥接。
//! 写库时把 `Recurrence` 翻译成 RRULE 串；读出时尽力反向翻译供前端编辑，
//! 无法用简单模型表达的复杂 RRULE 反向返回 None，前端据此只读展示。

use crate::recurrence::{Freq, Recurrence, RecurrenceEnd};

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
            "COUNT" => {
                end = RecurrenceEnd::Count {
                    count: value.parse().ok()?,
                }
            }
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
            end: RecurrenceEnd::Until {
                date: "2026-09-30".into(),
            },
        };
        // UNTIL 以日期末尾 23:59 的 UTC 标记（分钟精度）表达，保证包含当天。
        assert_eq!(
            recurrence_to_rrule(&rule),
            "FREQ=MONTHLY;UNTIL=20260930T235900Z"
        );
    }

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
        assert_eq!(
            parsed.end,
            RecurrenceEnd::Until {
                date: "2026-09-30".into()
            }
        );
    }
}
