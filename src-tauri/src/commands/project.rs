//! `.mcproj` = zip { project.json, assets/<hash>.<ext>, thumbnail.png }.
//! Assets are content-addressed, so identical images are stored once.

use crate::util::{pack, unpack};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::Path;
use tauri::ipc::{InvokeBody, Request, Response};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BlobRef {
    pub file: String,
    pub offset: usize,
    pub len: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMeta {
    pub path: String,
    pub project: String,
    pub assets: Vec<BlobRef>,
    pub thumbnail: Option<BlobRef>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadMeta {
    pub project: String,
    pub assets: Vec<BlobRef>,
}

fn is_safe_entry(name: &str) -> bool {
    !name.contains("..") && !name.starts_with('/') && !name.starts_with('\\') && !name.contains(':')
}

pub fn write_bundle(meta: &SaveMeta, blobs: &[u8]) -> Result<(), String> {
    let path = Path::new(&meta.path);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("mcproj-tmp");
    {
        let file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipWriter::new(std::io::BufWriter::new(file));
        let deflate = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        let stored = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);

        zip.start_file("project.json", deflate).map_err(|e| e.to_string())?;
        zip.write_all(meta.project.as_bytes()).map_err(|e| e.to_string())?;

        let mut entries: Vec<&BlobRef> = meta.assets.iter().collect();
        if let Some(t) = &meta.thumbnail {
            entries.push(t);
        }
        for b in entries {
            if !is_safe_entry(&b.file) {
                return Err(format!("invalid entry name: {}", b.file));
            }
            let data = blobs
                .get(b.offset..b.offset + b.len)
                .ok_or("blob out of range")?;
            // png/jpg are already compressed
            let opts = if b.file.ends_with(".png") || b.file.ends_with(".jpg") || b.file.ends_with(".webp") {
                stored
            } else {
                deflate
            };
            zip.start_file(&b.file, opts).map_err(|e| e.to_string())?;
            zip.write_all(data).map_err(|e| e.to_string())?;
        }
        let mut inner = zip.finish().map_err(|e| e.to_string())?;
        inner.flush().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

pub fn read_bundle(path: &Path) -> Result<Vec<u8>, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(file)).map_err(|e| e.to_string())?;
    let mut project = String::new();
    let mut assets = Vec::new();
    let mut blob = Vec::new();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().replace('\\', "/");
        if name == "project.json" {
            entry.read_to_string(&mut project).map_err(|e| e.to_string())?;
        } else if name.starts_with("assets/") && is_safe_entry(&name) {
            let offset = blob.len();
            entry.read_to_end(&mut blob).map_err(|e| e.to_string())?;
            assets.push(BlobRef {
                file: name,
                offset,
                len: blob.len() - offset,
            });
        }
    }
    if project.is_empty() {
        return Err("project.json not found in archive".into());
    }
    let meta = serde_json::to_string(&LoadMeta { project, assets }).map_err(|e| e.to_string())?;
    Ok(pack(&meta, &[&blob]))
}

/// Raw-body command: body = pack(SaveMeta json, blobs).
#[tauri::command]
pub async fn save_project(request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(body) = request.body() else {
        return Err("expected raw body".into());
    };
    let (json, blobs) = unpack(body)?;
    let meta: SaveMeta = serde_json::from_str(json).map_err(|e| e.to_string())?;
    write_bundle(&meta, blobs)?;
    tracing::info!("saved project {}", meta.path);
    Ok(())
}

#[tauri::command]
pub async fn load_project(path: String) -> Result<Response, String> {
    let data = read_bundle(Path::new(&path))?;
    tracing::info!("loaded project {}", path);
    Ok(Response::new(data))
}

#[tauri::command]
pub async fn read_file(path: String) -> Result<Response, String> {
    let data = std::fs::read(&path).map_err(|e| format!("{path}: {e}"))?;
    Ok(Response::new(data))
}

/// Raw-body command: header `x-path` (URI-encoded), body = bytes.
#[tauri::command]
pub async fn write_file(request: Request<'_>) -> Result<(), String> {
    let path = request
        .headers()
        .get("x-path")
        .ok_or("missing x-path")?
        .to_str()
        .map_err(|e| e.to_string())?;
    let path = crate::util::percent_decode(path);
    let InvokeBody::Raw(body) = request.body() else {
        return Err("expected raw body".into());
    };
    if let Some(dir) = Path::new(&path).parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, body).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn file_exists(path: String) -> bool {
    Path::new(&path).is_file()
}

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub modified: u64,
}

pub fn list_files(dir: &Path, ext: &str) -> Vec<FileEntry> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(dir) else {
        return out;
    };
    for e in rd.flatten() {
        let p = e.path();
        if p.extension().and_then(|x| x.to_str()).map(|x| x.eq_ignore_ascii_case(ext)) != Some(true) {
            continue;
        }
        let modified = e
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        out.push(FileEntry {
            name: p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
            path: p.to_string_lossy().into_owned(),
            modified,
        });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

#[tauri::command]
pub fn presets_list() -> Vec<FileEntry> {
    let dir = crate::paths::presets();
    let _ = std::fs::create_dir_all(&dir);
    list_files(&dir, "mcproj")
}

#[derive(Serialize)]
pub struct PluginSource {
    pub id: String,
    pub json: String,
    pub glsl: Vec<String>,
}

/// Declarative layer plugins: Documents/MatcapMaker/plugins/<id>/layer.json
/// (+ layer.glsl or pass0.glsl, pass1.glsl ...). No code is executed.
#[tauri::command]
pub fn plugins_list() -> Vec<PluginSource> {
    let dir = crate::paths::plugins();
    let _ = std::fs::create_dir_all(&dir);
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(&dir) else {
        return out;
    };
    for e in rd.flatten() {
        let p = e.path();
        if !p.is_dir() {
            continue;
        }
        let Ok(json) = std::fs::read_to_string(p.join("layer.json")) else {
            continue;
        };
        let mut glsl = Vec::new();
        if let Ok(s) = std::fs::read_to_string(p.join("layer.glsl")) {
            glsl.push(s);
        } else {
            for i in 0..8 {
                match std::fs::read_to_string(p.join(format!("pass{i}.glsl"))) {
                    Ok(s) => glsl.push(s),
                    Err(_) => break,
                }
            }
        }
        out.push(PluginSource {
            id: e.file_name().to_string_lossy().into_owned(),
            json,
            glsl,
        });
    }
    out
}

// --- crash recovery ----------------------------------------------------------

fn recovery_file() -> std::path::PathBuf {
    crate::paths::recovery().join("autosave.mcproj")
}

#[derive(Serialize)]
pub struct RecoveryInfo {
    pub path: String,
    pub modified: u64,
}

#[tauri::command]
pub fn recovery_path() -> String {
    recovery_file().to_string_lossy().into_owned()
}

#[tauri::command]
pub fn recovery_check() -> Option<RecoveryInfo> {
    let p = recovery_file();
    let m = std::fs::metadata(&p).ok()?;
    let modified = m
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs();
    Some(RecoveryInfo {
        path: p.to_string_lossy().into_owned(),
        modified,
    })
}

#[tauri::command]
pub fn recovery_clear() {
    let _ = std::fs::remove_file(recovery_file());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundle_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.mcproj");
        let blobs = b"PNGDATAthumb".to_vec();
        let meta = SaveMeta {
            path: path.to_string_lossy().into(),
            project: "{\"schemaVersion\":1}".into(),
            assets: vec![BlobRef {
                file: "assets/abc.png".into(),
                offset: 0,
                len: 7,
            }],
            thumbnail: Some(BlobRef {
                file: "thumbnail.png".into(),
                offset: 7,
                len: 5,
            }),
        };
        write_bundle(&meta, &blobs).unwrap();
        let packed = read_bundle(&path).unwrap();
        let (json, rest) = unpack(&packed).unwrap();
        let v: serde_json::Value = serde_json::from_str(json).unwrap();
        assert_eq!(v["project"], "{\"schemaVersion\":1}");
        assert_eq!(v["assets"][0]["file"], "assets/abc.png");
        assert_eq!(&rest[..7], b"PNGDATA");
    }

    #[test]
    fn rejects_path_traversal() {
        let dir = tempfile::tempdir().unwrap();
        let meta = SaveMeta {
            path: dir.path().join("x.mcproj").to_string_lossy().into(),
            project: "{}".into(),
            assets: vec![BlobRef {
                file: "../evil".into(),
                offset: 0,
                len: 0,
            }],
            thumbnail: None,
        };
        assert!(write_bundle(&meta, &[]).is_err());
    }
}
