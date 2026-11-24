use std::path::Path;

// Bake the OAuth client credentials into the binary at compile time. The values
// come from `oauth-credentials.json` (gitignored, holds the real ids/secret) and
// are exposed to the crate as compile-time env vars read with `option_env!`.
// When the file is absent (fresh clone, CI) the vars are simply empty and the
// OAuth commands report "未配置" instead of failing the build.
fn emit_oauth_credentials() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default();
    let path = Path::new(&manifest_dir).join("oauth-credentials.json");
    println!("cargo:rerun-if-changed=oauth-credentials.json");

    let (google_id, google_secret, microsoft_id) = std::fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .map(|json| {
            let pick = |group: &str, key: &str| {
                json.get(group)
                    .and_then(|g| g.get(key))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_owned()
            };
            (
                pick("google", "clientId"),
                pick("google", "clientSecret"),
                pick("microsoft", "clientId"),
            )
        })
        .unwrap_or_default();

    println!("cargo:rustc-env=NOWLY_GOOGLE_CLIENT_ID={google_id}");
    println!("cargo:rustc-env=NOWLY_GOOGLE_CLIENT_SECRET={google_secret}");
    println!("cargo:rustc-env=NOWLY_MICROSOFT_CLIENT_ID={microsoft_id}");
}

fn main() {
    emit_oauth_credentials();
    tauri_build::build();
}
