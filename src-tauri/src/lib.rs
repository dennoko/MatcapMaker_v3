mod commands;
mod log;
mod paths;
mod util;

use tauri::Emitter;

const WEBVIEW2_URL: &str = "https://developer.microsoft.com/microsoft-edge/webview2/";

/// Friendly message instead of Tauri's generic failure when the WebView2
/// runtime is missing (portable exe on a stripped-down Windows install).
fn ensure_webview2() -> bool {
    if tauri::webview_version().is_ok() {
        return true;
    }
    tracing::error!("WebView2 runtime not found");
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, IDYES, MB_ICONERROR, MB_YESNO};
        let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
        let text = wide(
            "Microsoft Edge WebView2 Runtime is required to run Matcap Maker.\n\
             Open the download page now?\n\n\
             Matcap Maker の実行には Microsoft Edge WebView2 ランタイムが必要です。\n\
             ダウンロードページを開きますか？",
        );
        let title = wide("Matcap Maker");
        let r = MessageBoxW(std::ptr::null_mut(), text.as_ptr(), title.as_ptr(), MB_YESNO | MB_ICONERROR);
        if r == IDYES {
            let _ = std::process::Command::new("explorer.exe").arg(WEBVIEW2_URL).spawn();
        }
    }
    false
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _log_guard = log::init();
    if !ensure_webview2() {
        return;
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // forward "Open with" of a second launch to the running window
            if let Some(file) = argv.iter().skip(1).find(|a| std::path::Path::new(a).is_file()) {
                let _ = app.emit("open-file", file.clone());
            }
            if let Some(w) = tauri::Manager::get_webview_window(app, "main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::image::write_image,
            commands::project::save_project,
            commands::project::load_project,
            commands::project::read_file,
            commands::project::write_file,
            commands::project::file_exists,
            commands::project::presets_list,
            commands::project::plugins_list,
            commands::project::recovery_path,
            commands::project::recovery_check,
            commands::project::recovery_clear,
            commands::system::app_paths,
            commands::system::settings_load,
            commands::system::settings_save,
            commands::system::log_message,
            commands::system::launch_file,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            tracing::error!("failed to run app: {e}");
        });
}
