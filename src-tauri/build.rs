fn main() {
    // version.json is the single source of truth for the app version
    println!("cargo:rerun-if-changed=../version.json");
    let json = std::fs::read_to_string("../version.json").expect("read ../version.json");
    let v: serde_json::Value = serde_json::from_str(&json).expect("parse ../version.json");
    let version = v["version"].as_str().expect("version.json: \"version\" must be a string");
    println!("cargo:rustc-env=APP_VERSION={version}");
    tauri_build::build()
}
