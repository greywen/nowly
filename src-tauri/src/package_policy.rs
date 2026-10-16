pub fn store_url(product_id: Option<&str>) -> Option<String> {
    product_id
        .filter(|id| !id.is_empty())
        .map(|id| format!("https://apps.microsoft.com/detail/{id}"))
}

pub fn background_launch<'a>(args: impl IntoIterator<Item = &'a str>) -> bool {
    args.into_iter().any(|arg| arg == "--background")
}
