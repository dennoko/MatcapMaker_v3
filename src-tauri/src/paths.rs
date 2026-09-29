//! Well-known locations. The portable exe never writes next to itself:
//! settings / logs / recovery live in %LOCALAPPDATA%\MatcapMaker, user data
//! (presets, plugins) in Documents\MatcapMaker.

use std::path::PathBuf;

const APP_DIR: &str = "MatcapMaker";

pub fn local_data() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(APP_DIR)
}

pub fn logs() -> PathBuf {
    local_data().join("logs")
}

pub fn recovery() -> PathBuf {
    local_data().join("recovery")
}

pub fn settings_file() -> PathBuf {
    local_data().join("settings.json")
}

pub fn documents() -> PathBuf {
    dirs::document_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(std::env::temp_dir)
        .join(APP_DIR)
}

pub fn presets() -> PathBuf {
    documents().join("presets")
}

pub fn plugins() -> PathBuf {
    documents().join("plugins")
}

pub fn output() -> PathBuf {
    documents().join("output")
}
