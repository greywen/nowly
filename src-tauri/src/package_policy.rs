pub const STORE_PRODUCT_ID: &str = "9NZ6S35M4CL2";

pub fn store_url(product_id: Option<&str>) -> Option<String> {
    product_id
        .filter(|id| !id.is_empty() && id.bytes().all(|c| c.is_ascii_alphanumeric()))
        .map(|id| format!("https://apps.microsoft.com/detail/{id}"))
}

pub fn is_main_update(current_family: &str, family: &str, resource: bool, framework: bool) -> bool {
    current_family == family && !resource && !framework
}

pub fn background_launch<'a>(args: impl IntoIterator<Item = &'a str>) -> bool {
    args.into_iter().any(|arg| arg == "--background")
}
