use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub local_data: String,
    pub logs: String,
    pub documents: String,
    pub presets: String,
    pub plugins: String,
    pub output: String,
}

fn s(p: std::path::PathBuf) -> String {
    p.to_string_lossy().into_owned()
}

#[tauri::command]
pub fn app_paths() -> AppPaths {
    let _ = std::fs::create_dir_all(crate::paths::output());
    AppPaths {
        local_data: s(crate::paths::local_data()),
        logs: s(crate::paths::logs()),
        documents: s(crate::paths::documents()),
        presets: s(crate::paths::presets()),
        plugins: s(crate::paths::plugins()),
        output: s(crate::paths::output()),
    }
}

#[tauri::command]
pub fn settings_load() -> Option<String> {
    std::fs::read_to_string(crate::paths::settings_file()).ok()
}

#[tauri::command]
pub fn settings_save(json: String) -> Result<(), String> {
    let p = crate::paths::settings_file();
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

/// Frontend errors / messages go to the same rotating log as Rust.
#[tauri::command]
pub fn log_message(level: String, message: String) {
    match level.as_str() {
        "error" => tracing::error!(target: "frontend", "{message}"),
        "warn" => tracing::warn!(target: "frontend", "{message}"),
        _ => tracing::info!(target: "frontend", "{message}"),
    }
}

/// File passed on the command line (file association / "Open with").
#[tauri::command]
pub fn launch_file() -> Option<String> {
    std::env::args().skip(1).find(|a| {
        let p = std::path::Path::new(a);
        p.is_file()
            && p.extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("mcproj") || e.eq_ignore_ascii_case("json"))
                .unwrap_or(false)
    })
}
