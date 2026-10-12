use serde::{Deserialize, Serialize};

/// Одна запись о файле игры. `path` — относительный путь от корня игры,
/// всегда с `/` как разделителем (даже на Windows).
/// `mtime` — время изменения (unix-секунды) на момент генерации манифеста:
/// лаунчер пропускает хеширование, если совпали размер и mtime.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub size: u64,
    pub sha256: String,
    #[serde(default)]
    pub mtime: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub version: String,
    pub generated_at: String,
    pub files: Vec<FileEntry>,
}

fn now_rfc3339() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Без chrono — отдаём epoch + пометку. Лаунчеру важен только `version`.
    format!("{}", secs)
}

/// Рекурсивно сканирует `game_dir`, считает sha256 каждого файла.
/// Пропускает сам `manifest.json` и временные `*.tmp` / `*.part` файлы.
pub fn generate_manifest(
    game_dir: &std::path::Path,
    version: String,
) -> Result<Manifest, String> {
    let mut files = Vec::new();

    let walker = walkdir::WalkDir::new(game_dir)
        .follow_links(false)
        .into_iter();

    for entry in walker {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().is_file() {
            continue;
        }
        let abs = entry.path();

        let rel = abs
            .strip_prefix(game_dir)
            .map_err(|e| e.to_string())?;
        // нормализуем в unix-стиль
        let rel_str = rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/");

        if rel_str == "manifest.json" {
            continue;
        }
        // Служебные/скрытые файлы (`.gitkeep`, `.DS_Store`, ...) не раздаём.
        if rel_str.split('/').any(|seg| seg.starts_with('.')) {
            continue;
        }
        if rel_str.ends_with(".tmp") || rel_str.ends_with(".part") {
            continue;
        }

        let (size, sha256) = hash_file(abs).map_err(|e| e.to_string())?;
        let mtime = abs
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        files.push(FileEntry {
            path: rel_str,
            size,
            sha256,
            mtime,
        });
    }

    files.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(Manifest {
        version,
        generated_at: now_rfc3339(),
        files,
    })
}

fn hash_file(path: &std::path::Path) -> std::io::Result<(u64, String)> {
    use sha2::{Digest, Sha256};
    use std::io::Read;

    let mut f = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 128 * 1024];
    let mut total: u64 = 0;
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        total += n as u64;
        hasher.update(&buf[..n]);
    }
    Ok((total, hex::encode(hasher.finalize())))
}
