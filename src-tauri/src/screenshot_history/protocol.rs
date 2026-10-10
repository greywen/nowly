use super::HistoryState;
use tauri::Manager;
/// Register with `register_asynchronous_uri_scheme_protocol("screenshot-history", ...)`.
pub fn respond<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    caller: String,
    request: tauri::http::Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    std::thread::spawn(move || {
        let result =
            if matches!(caller.as_str(), "screenshot-history" | "quick-panel-handle")
                && request.method() == tauri::http::Method::GET
            {
                let path = percent_encoding::percent_decode_str(request.uri().path())
                    .decode_utf8()
                    .ok();
                path.and_then(|p| {
                    let id = p.strip_prefix('/').unwrap_or(&p);
                    super::store::validate_id(id).ok()?;
                    app.try_state::<HistoryState>()?
                        .0
                        .thumbnail(&app.state::<crate::db::AppDb>().0, id)
                        .ok()
                })
            } else {
                None
            };
        let (status, body) = match result {
            Some(bytes) => (200, bytes),
            None => (404, Vec::new()),
        };
        responder.respond(
            tauri::http::Response::builder()
                .status(status)
                .header("Content-Type", "image/png")
                .header("Cache-Control", "no-store")
                .header("X-Content-Type-Options", "nosniff")
                .body(body)
                .unwrap(),
        );
    });
}
