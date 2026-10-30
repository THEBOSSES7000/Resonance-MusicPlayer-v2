//! Escaneo de la biblioteca de música.

use rayon::prelude::*;
use super::*;

pub static CANCEL_MUSIC_LIBRARY_SCAN: AtomicBool = AtomicBool::new(false);

pub fn collect_music_files(
    root: &Path,
    current: &Path,
    root_name: &str,
    files: &mut Vec<MusicFile>,
    excluded: &std::collections::HashSet<String>,
) -> Result<(), String> {
    if CANCEL_MUSIC_LIBRARY_SCAN.load(Ordering::Relaxed) {
        return Ok(());
    }
    let entries = fs::read_dir(current).map_err(|error| error.to_string())?;
    for entry in entries {
        if CANCEL_MUSIC_LIBRARY_SCAN.load(Ordering::Relaxed) {
            break;
        }
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_dir() {
            let key = normalize_path_key(&path.to_string_lossy());
            if excluded.contains(&key) {
                continue;
            }
            collect_music_files(root, &path, root_name, files, excluded)?;
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        let extension = path
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !["mp3", "flac", "wav", "ogg", "opus", "m4a", "mp4", "aac"].contains(&extension.as_str())
        {
            continue;
        }

        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
            .unwrap_or_default();
        let relative = path
            .strip_prefix(root)
            .map_err(|error| error.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        let relative_path = format!("{root_name}/{relative}");
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "No se pudo leer el nombre de un archivo de música.".to_string())?
            .to_string();
        files.push(MusicFile {
            name,
            path: path.to_string_lossy().into_owned(),
            directory_path: root.to_string_lossy().into_owned(),
            relative_path,
            size: metadata.len(),
            last_modified: modified,
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn scan_music_library(app: AppHandle) -> Result<MusicLibrary, String> {
    CANCEL_MUSIC_LIBRARY_SCAN.store(false, Ordering::Relaxed);
    tauri::async_runtime::spawn_blocking(move || {
        let directories = read_music_directories(&app)?;
        // Permitir cada raíz antes del recorrido paralelo
        for directory in &directories {
            let root = PathBuf::from(&directory.path);
            if root.is_dir() {
                app.asset_protocol_scope()
                    .allow_directory(&root, true)
                    .map_err(|error| error.to_string())?;
            }
        }
        // Recorrer varias carpetas raíz en paralelo (rayon)
        let partials: Vec<Result<Vec<MusicFile>, String>> = directories
            .par_iter()
            .map(|directory| -> Result<Vec<MusicFile>, String> {
                if CANCEL_MUSIC_LIBRARY_SCAN.load(Ordering::Relaxed) {
                    return Ok(Vec::new());
                }
                let root = PathBuf::from(&directory.path);
                if !root.is_dir() {
                    return Ok(Vec::new());
                }
                let excluded: std::collections::HashSet<String> = directory
                    .excluded_subfolders
                    .iter()
                    .map(|item| normalize_path_key(item))
                    .collect();
                let mut local_files = Vec::new();
                // Un error de lectura aborta el escaneo (como antes): así no se confunde
                // "no pude leer la carpeta" con "la carpeta está vacía".
                collect_music_files(&root, &root, &directory.name, &mut local_files, &excluded)?;
                Ok(local_files)
            })
            .collect();
        let mut files: Vec<MusicFile> = Vec::new();
        for partial in partials {
            files.extend(partial?);
        }
        files.sort_by(|left, right| right.last_modified.cmp(&left.last_modified));
        Ok(MusicLibrary { directories, files })
    })
    .await
    .map_err(|error| format!("No se pudo completar el escaneo de la biblioteca: {error}"))?
}

#[tauri::command]
pub fn cancel_music_library_scan() {
    CANCEL_MUSIC_LIBRARY_SCAN.store(true, Ordering::Relaxed);
}
