use crate::error::CommandError;
use crate::net;
use serde::Serialize;

// Software update check.
//
// The app ships with a fixed version (from Cargo at build time). On launch the
// frontend asks this layer whether a newer release exists on GitHub. We read the
// project's "latest release" from the public GitHub Releases API, compare its
// semantic version against the running one, and hand back the current version,
// the latest version, whether an update is available, plus the release notes and
// the page URL so the About dialog can show the newest changelog.
//
// The request goes through the same hardened https fetch used elsewhere
// (https-only, no private IPs, no redirects, size-capped, short timeout). A
// failure to reach GitHub is not fatal: the command returns an error the
// frontend treats as "no update info", so the About dialog still shows the
// current version offline.

const LATEST_RELEASE_API: &str = "https://api.github.com/repos/greywen/nowly/releases/latest";
const RELEASES_PAGE_URL: &str = "https://github.com/greywen/nowly/releases";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    // The version the running app was built with.
    pub current_version: String,
    // The latest published release version, when it could be fetched.
    pub latest_version: Option<String>,
    // True only when a strictly newer release exists.
    pub update_available: bool,
    // The latest release's notes / changelog body, when available.
    pub release_notes: Option<String>,
    // The human-facing release page to open.
    pub release_url: String,
    // The latest release's published date (ISO-8601), when available.
    pub published_at: Option<String>,
}

// Parse a semantic version like "1.2.3" (with an optional leading "v") into its
// numeric components. Missing or non-numeric parts read as 0, so "1.2" parses to
// (1, 2, 0). Anything after a pre-release/build separator ("-", "+") is ignored.
fn parse_version(raw: &str) -> (u64, u64, u64) {
    let trimmed = raw.trim();
    let without_v = trimmed
        .strip_prefix('v')
        .or_else(|| trimmed.strip_prefix('V'))
        .unwrap_or(trimmed);
    // Drop any pre-release/build metadata so "1.2.3-beta.1" compares as 1.2.3.
    let core = without_v.split(['-', '+']).next().unwrap_or(without_v);
    let mut parts = core
        .split('.')
        .map(|part| part.trim().parse::<u64>().unwrap_or(0));
    let major = parts.next().unwrap_or(0);
    let minor = parts.next().unwrap_or(0);
    let patch = parts.next().unwrap_or(0);
    (major, minor, patch)
}

// True when `latest` is strictly newer than `current`.
fn is_newer(latest: &str, current: &str) -> bool {
    parse_version(latest) > parse_version(current)
}

// Pull the pieces we need out of the GitHub release JSON without a full typed
// model: the tag name (version), the notes body, and the published date.
fn parse_release(json: &str) -> Result<(String, Option<String>, Option<String>), CommandError> {
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|_| CommandError::system("invalid release payload"))?;
    let tag = value
        .get("tag_name")
        .and_then(|v| v.as_str())
        .map(str::to_owned)
        .ok_or_else(|| CommandError::system("release payload missing tag_name"))?;
    let notes = value
        .get("body")
        .and_then(|v| v.as_str())
        .map(str::to_owned)
        .filter(|s| !s.trim().is_empty());
    let published = value
        .get("published_at")
        .and_then(|v| v.as_str())
        .map(str::to_owned);
    Ok((tag, notes, published))
}

fn run_check(current_version: String) -> Result<UpdateInfo, CommandError> {
    let body = net::fetch_public_text(LATEST_RELEASE_API)?;
    let (tag, notes, published) = parse_release(&body)?;
    let update_available = is_newer(&tag, &current_version);
    Ok(UpdateInfo {
        current_version,
        latest_version: Some(tag),
        update_available,
        release_notes: notes,
        release_url: RELEASES_PAGE_URL.to_owned(),
        published_at: published,
    })
}

#[tauri::command]
pub fn check_for_update() -> Result<UpdateInfo, CommandError> {
    run_check(env!("CARGO_PKG_VERSION").to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_versions_with_optional_v_prefix() {
        assert_eq!(parse_version("1.2.3"), (1, 2, 3));
        assert_eq!(parse_version("v1.2.3"), (1, 2, 3));
        assert_eq!(parse_version("V2.0"), (2, 0, 0));
        assert_eq!(parse_version(" 0.1.1 "), (0, 1, 1));
    }

    #[test]
    fn ignores_prerelease_and_build_metadata() {
        assert_eq!(parse_version("1.2.3-beta.1"), (1, 2, 3));
        assert_eq!(parse_version("1.2.3+build.9"), (1, 2, 3));
    }

    #[test]
    fn detects_strictly_newer_releases() {
        assert!(is_newer("0.1.2", "0.1.1"));
        assert!(is_newer("1.0.0", "0.9.9"));
        assert!(is_newer("v0.2.0", "0.1.9"));
        assert!(!is_newer("0.1.1", "0.1.1"));
        assert!(!is_newer("0.1.0", "0.1.1"));
    }

    #[test]
    fn extracts_release_fields() {
        let json = r#"{
            "tag_name": "v0.2.0",
            "body": "Changelog: new stuff",
            "published_at": "2025-01-01T00:00:00Z"
        }"#;
        let (tag, notes, published) = parse_release(json).unwrap();
        assert_eq!(tag, "v0.2.0");
        assert_eq!(notes.as_deref(), Some("Changelog: new stuff"));
        assert_eq!(published.as_deref(), Some("2025-01-01T00:00:00Z"));
    }

    #[test]
    fn treats_blank_body_as_no_notes() {
        let json = r#"{ "tag_name": "v0.2.0", "body": "   " }"#;
        let (tag, notes, _) = parse_release(json).unwrap();
        assert_eq!(tag, "v0.2.0");
        assert_eq!(notes, None);
    }

    #[test]
    fn missing_tag_is_an_error() {
        let json = r#"{ "body": "notes" }"#;
        assert!(parse_release(json).is_err());
    }
}
