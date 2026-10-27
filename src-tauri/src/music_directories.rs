//! Carpetas de música: añadir, quitar, subcarpetas, vigilancia y comprobaciones de ruta.

use super::*;

#[tauri::command]
pub fn get_music_directories(app: AppHandle) -> Result<Vec<MusicDirectory>, String> {
    let directories = read_music_directories(&app)?;
    for directory in &directories {
        let path = PathBuf::from(&directory.path);
        if path.is_dir() {
            app.asset_protocol_scope()
                .allow_directory(&path, true)
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(directories)
}

#[tauri::command]
pub fn configure_music_watcher(
    app: AppHandle,
    watcher_state: State<'_, MusicWatcher>,
    enabled: bool,
) -> Result<(), String> {
    let mut current = watcher_state
        .0
        .lock()
        .map_err(|_| "No se pudo acceder al monitor de carpetas.".to_string())?;
    *current = None;
    if !enabled {
        return Ok(());
    }

    let directories = read_music_directories(&app)?;
    let event_app = app.clone();
    let mut watcher =
        notify::recommended_watcher(move |result: notify::Result<notify::Event>| match result {
            Ok(event)
                if matches!(
                    &event.kind,
                    EventKind::Create(_)
                        | EventKind::Remove(_)
                        | EventKind::Modify(ModifyKind::Name(_))
                ) && event.paths.iter().any(|path| {
                    matches!(
                        path.extension()
                            .and_then(|extension| extension.to_str())
                            .unwrap_or_default()
                            .to_ascii_lowercase()
                            .as_str(),
                        "mp3" | "flac" | "wav" | "ogg" | "opus" | "m4a" | "mp4" | "aac"
                    )
                }) =>
            {
                if let Err(error) = event_app.emit("music-library-filesystem-changed", ()) {
                    eprintln!("No se pudo emitir el cambio de biblioteca: {error}");
                }
            }
            Ok(_) => {}
            Err(error) => eprintln!("Error del monitor de carpetas: {error}"),
        })
        .map_err(|error| error.to_string())?;

    for directory in directories {
        let path = PathBuf::from(directory.path);
        if path.is_dir() {
            watcher
                .watch(&path, RecursiveMode::Recursive)
                .map_err(|error| format!("No se pudo monitorear {}: {error}", path.display()))?;
        }
    }
    *current = Some(watcher);
    Ok(())
}


pub fn normalized_directory(path: &Path) -> Result<MusicDirectory, String> {
    let path = path.canonicalize().map_err(|error| error.to_string())?;
    if !path.is_dir() {
        return Err("La ruta seleccionada no es una carpeta.".to_string());
    }
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Música")
        .to_string();
    Ok(MusicDirectory {
        path: path.to_string_lossy().into_owned(),
        name,
        excluded_subfolders: Vec::new(),
    })
}

#[tauri::command]
pub fn list_music_subfolders(app: AppHandle, path: String) -> Result<Vec<MusicSubfolder>, String> {
    let directories = read_music_directories(&app)?;
    let root = directories
        .iter()
        .find(|directory| directory.path == path)
        .ok_or_else(|| "La carpeta no está vinculada a la biblioteca.".to_string())?;
    let root_path = PathBuf::from(&root.path);
    if !root_path.is_dir() {
        return Err("La carpeta vinculada no existe.".to_string());
    }
    let excluded: std::collections::HashSet<String> = root
        .excluded_subfolders
        .iter()
        .map(|item| normalize_path_key(item))
        .collect();
    let mut children = Vec::new();
    let entries = fs::read_dir(&root_path).map_err(|error| error.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if !file_type.is_dir() {
            continue;
        }
        let child_path = entry.path();
        let name = entry
            .file_name()
            .to_string_lossy()
            .into_owned();
        // Omitir carpetas ocultas típicas
        if name.starts_with('.') {
            continue;
        }
        let path_string = child_path.to_string_lossy().into_owned();
        let key = normalize_path_key(&path_string);
        children.push(MusicSubfolder {
            name,
            path: path_string,
            excluded: excluded.contains(&key),
        });
    }
    children.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(children)
}

#[tauri::command]
pub fn set_music_subfolder_excluded(
    app: AppHandle,
    root_path: String,
    subfolder_path: String,
    excluded: bool,
) -> Result<MusicDirectory, String> {
    let mut directories = read_music_directories(&app)?;
    let directory = directories
        .iter_mut()
        .find(|item| item.path == root_path)
        .ok_or_else(|| "La carpeta no está vinculada a la biblioteca.".to_string())?;
    let sub_key = normalize_path_key(&subfolder_path);
    directory.excluded_subfolders.retain(|item| normalize_path_key(item) != sub_key);
    if excluded {
        directory.excluded_subfolders.push(subfolder_path);
    }
    directory.excluded_subfolders.sort();
    directory.excluded_subfolders.dedup();
    write_music_directories(&app, &directories)?;
    directories
        .into_iter()
        .find(|item| item.path == root_path)
        .ok_or_else(|| "No se pudo actualizar la carpeta.".to_string())
}

pub fn normalize_path_key(path: &str) -> String {
    path.replace("\\", "/")
        .trim_end_matches('/')
        .to_lowercase()
}

#[tauri::command]
pub fn add_music_directory(app: AppHandle) -> Result<Option<MusicDirectory>, String> {
    let Some(selected_path) = rfd::FileDialog::new()
        .set_title("Seleccionar carpeta de música")
        .pick_folder()
    else {
        return Ok(None);
    };
    let directory = normalized_directory(&selected_path)?;
    app.asset_protocol_scope()
        .allow_directory(&directory.path, true)
        .map_err(|error| error.to_string())?;

    let mut directories = read_music_directories(&app)?;
    if !directories
        .iter()
        .any(|saved| saved.path.eq_ignore_ascii_case(&directory.path))
    {
        directories.push(directory.clone());
        write_music_directories(&app, &directories)?;
    }
    Ok(Some(directory))
}

#[tauri::command]
pub fn select_music_file(app: AppHandle) -> Result<Option<String>, String> {
    let directories = read_music_directories(&app)?;
    let configured_paths = directories
        .iter()
        .filter_map(|directory| fs::canonicalize(&directory.path).ok())
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();
    let Some(initial_directory) = configured_paths.first() else {
        return Err("No hay carpetas de música configuradas.".to_string());
    };

    let Some(selected_path) = rfd::FileDialog::new()
        .set_title("Seleccionar canción de una carpeta de música")
        .set_directory(initial_directory)
        .add_filter(
            "Archivos de audio",
            &["mp3", "flac", "wav", "ogg", "opus", "m4a", "mp4", "aac"],
        )
        .pick_file()
    else {
        return Ok(None);
    };
    let selected_path = selected_path
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let is_audio_file = selected_path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            ["mp3", "flac", "wav", "ogg", "opus", "m4a", "mp4", "aac"]
                .iter()
                .any(|supported| extension.eq_ignore_ascii_case(supported))
        });
    if !selected_path.is_file()
        || !is_audio_file
        || !configured_paths
            .iter()
            .any(|directory| selected_path.starts_with(directory))
    {
        return Err(
            "Selecciona un archivo de audio dentro de una carpeta de música configurada."
                .to_string(),
        );
    }
    Ok(Some(selected_path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn remove_music_directory(app: AppHandle, path: String) -> Result<(), String> {
    let mut directories = read_music_directories(&app)?;
    directories.retain(|directory| !directory.path.eq_ignore_ascii_case(&path));
    write_music_directories(&app, &directories)
}

#[tauri::command]
pub fn replace_music_directories(
    app: AppHandle,
    directories: Vec<MusicDirectory>,
) -> Result<(), String> {
    if directories.len() > 1_000 {
        return Err("La copia contiene demasiadas carpetas de música.".to_string());
    }
    let mut normalized = Vec::with_capacity(directories.len());
    let mut seen_paths = HashSet::new();
    for directory in directories {
        let path = PathBuf::from(&directory.path);
        if !path.is_absolute() || directory.path.len() > 32_768 || directory.name.len() > 1_024 {
            return Err("La copia contiene una ruta o nombre de carpeta no válido.".to_string());
        }
        if !seen_paths.insert(directory.path.to_lowercase()) {
            continue;
        }
        if path.is_dir() {
            app.asset_protocol_scope()
                .allow_directory(&path, true)
                .map_err(|error| error.to_string())?;
        }
        normalized.push(directory);
    }
    write_music_directories(&app, &normalized)
}

#[tauri::command]
pub fn delete_music_file(app: AppHandle, path: String) -> Result<(), String> {
    let file_path = ensure_path_in_library(&app, &path)?;
    let extension = file_path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !["mp3", "flac", "wav", "ogg", "opus", "m4a", "mp4", "aac"].contains(&extension.as_str()) {
        return Err("El archivo no tiene un formato de música compatible.".to_string());
    }

    fs::remove_file(file_path).map_err(|error| format!("No se pudo borrar el archivo: {error}"))
}

pub fn canonical_music_roots(app: &AppHandle) -> Result<Vec<PathBuf>, String> {
    let directories = read_music_directories(app)?;
    Ok(directories
        .iter()
        .filter_map(|directory| Path::new(&directory.path).canonicalize().ok())
        .collect())
}

pub fn ensure_path_in_roots(raw_path: &str, canonical_roots: &[PathBuf]) -> Result<PathBuf, String> {
    let file_path = PathBuf::from(raw_path)
        .canonicalize()
        .map_err(|error| format!("No se pudo acceder al archivo: {error}"))?;
    if !file_path.is_file() {
        return Err("La ruta seleccionada no es un archivo.".to_string());
    }
    if !canonical_roots.iter().any(|root| file_path.starts_with(root)) {
        return Err("El archivo no pertenece a una carpeta de música vinculada.".to_string());
    }
    Ok(file_path)
}

pub fn ensure_path_in_library(app: &AppHandle, raw_path: &str) -> Result<PathBuf, String> {
    let roots = canonical_music_roots(app)?;
    ensure_path_in_roots(raw_path, &roots)
}
