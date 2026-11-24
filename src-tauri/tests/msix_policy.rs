#[path = "../src/package_policy.rs"]
mod package_policy;

#[test]
fn packaged_updates_never_offer_a_github_installer() {
    assert_eq!(
        package_policy::store_url(Some("9ABC123")),
        Some("https://apps.microsoft.com/detail/9ABC123".to_owned())
    );
    assert_eq!(package_policy::store_url(None), None);
}

#[test]
fn only_explicit_background_launches_are_hidden() {
    assert!(package_policy::background_launch([
        "nowly.exe",
        "--background"
    ]));
    assert!(!package_policy::background_launch(["nowly.exe"]));
}

#[test]
fn store_links_reject_protocol_and_query_injection() {
    assert_eq!(package_policy::store_url(Some("9ABC&other=1")), None);
    assert_eq!(package_policy::store_url(Some("../other")), None);
}

#[test]
fn only_the_current_main_package_triggers_an_update_badge() {
    assert!(package_policy::is_main_update(
        "Nowly_abc",
        "Nowly_abc",
        false,
        false
    ));
    assert!(!package_policy::is_main_update(
        "Nowly_abc",
        "Addon_abc",
        false,
        false
    ));
    assert!(!package_policy::is_main_update(
        "Nowly_abc",
        "Nowly_abc",
        true,
        false
    ));
    assert!(!package_policy::is_main_update(
        "Nowly_abc",
        "Nowly_abc",
        false,
        true
    ));
}
