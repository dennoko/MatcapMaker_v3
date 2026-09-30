//! Rotating file log in %LOCALAPPDATA%\MatcapMaker\logs (daily files, the
//! newest few kept) plus panic capture.

use tracing_appender::non_blocking::WorkerGuard;

const KEEP_FILES: usize = 7;

pub fn init() -> Option<WorkerGuard> {
    let dir = crate::paths::logs();
    std::fs::create_dir_all(&dir).ok()?;
    let appender = tracing_appender::rolling::Builder::new()
        .rotation(tracing_appender::rolling::Rotation::DAILY)
        .filename_prefix("matcap-maker")
        .filename_suffix("log")
        .max_log_files(KEEP_FILES)
        .build(&dir)
        .ok()?;
    let (writer, guard) = tracing_appender::non_blocking(appender);
    tracing_subscriber::fmt()
        .with_writer(writer)
        .with_ansi(false)
        .with_max_level(tracing::Level::INFO)
        .init();

    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        tracing::error!("panic: {info}");
        let crash = crate::paths::logs().join("crash.log");
        let _ = std::fs::write(crash, format!("{info}\n"));
        default_hook(info);
    }));
    tracing::info!("Matcap Maker {} starting", env!("APP_VERSION"));
    Some(guard)
}
