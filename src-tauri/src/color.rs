pub fn normalize_hex(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    if bytes.len() != 7 || bytes[0] != b'#' || !bytes[1..].iter().all(u8::is_ascii_hexdigit) {
        return None;
    }
    Some(value.to_ascii_uppercase())
}

#[cfg(test)]
mod tests {
    #[test]
    fn normalizes_only_six_digit_hex() {
        assert_eq!(super::normalize_hex("#7c5cfc"), Some("#7C5CFC".into()));
        assert_eq!(super::normalize_hex("#fff"), None);
        assert_eq!(super::normalize_hex("purple"), None);
    }
}
