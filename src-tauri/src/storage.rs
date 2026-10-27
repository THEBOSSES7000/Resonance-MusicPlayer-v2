//! Almacenamiento: modo portable/AppData, copia de datos y ubicación de ajustes.

use super::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub mode: String,
    pub path: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

pub const WINDOW_BOUNDS_SETTING: &str = "pn_window_bounds";
pub const MIN_WINDOW_WIDTH: u32 = 760;
pub const MIN_WINDOW_HEIGHT: u32 = 540;
pub const MAX_WINDOW_DIMENSION: u32 = 8192;

pub fn portable_storage_directory() -> Result<PathBuf, String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let executable_directory = executable
        .parent()
        .ok_or_else(|| "No se pudo determinar la carpeta de la aplicación.".to_string())?;
    Ok(executable_directory.join("data"))
}

pub fn app_data_storage_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let legacy_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let parent = legacy_directory
        .parent()
        .ok_or_else(|| "No se pudo determinar la carpeta AppData de Resonance.".to_string())?
        .to_path_buf();
    let storage_directory = parent.join("ResonanceMusicPlayer");
    let legacy_directories = [
        legacy_directory,
        parent.join("Resonance"),
        parent.join("com.purplenote.app"),
    ];
    for source in legacy_directories {
        if source != storage_directory {
            copy_directory_contents_if_missing(&source, &storage_directory)?;
        }
    }

    let cache_directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?;
    let cache_parent = cache_directory
        .parent()
        .ok_or_else(|| "No se pudo determinar la carpeta de caché de Resonance.".to_string())?;
    let legacy_cache_directories = [
        cache_directory.join("library-cache"),
        cache_parent
            .join("com.purplenote.app")
            .join("library-cache"),
    ];
    for source in legacy_cache_directories {
        let destination = storage_directory.join("library-cache");
        if source != destination {
            copy_directory_contents_if_missing(&source, &destination)?;
        }
    }

    Ok(storage_directory)
}

pub fn active_storage_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let portable_directory = portable_storage_directory()?;
    if portable_directory.is_dir() {
        Ok(portable_directory)
    } else {
        app_data_storage_directory(app)
    }
}

pub fn copy_directory_contents(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }
    fs::create_dir_all(destination)
        .map_err(|error| format!("No se pudo crear {}: {error}", destination.display()))?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("No se pudo leer {}: {error}", source.display()))?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_dir() {
            copy_directory_contents(&source_path, &destination_path)?;
        } else if file_type.is_file() {
            if let Some(parent) = destination_path.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            fs::copy(&source_path, &destination_path).map_err(|error| {
                format!(
                    "No se pudo copiar {} a {}: {error}",
                    source_path.display(),
                    destination_path.display()
                )
            })?;
        } else {
            return Err(format!(
                "No se puede migrar el elemento especial {}.",
                source_path.display()
            ));
        }
    }
    Ok(())
}

pub fn copy_directory_contents_if_missing(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.is_dir() {
        return Ok(());
    }
    fs::create_dir_all(destination)
        .map_err(|error| format!("No se pudo crear {}: {error}", destination.display()))?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("No se pudo leer {}: {error}", source.display()))?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if destination_path.exists() {
            if file_type.is_dir() && destination_path.is_dir() {
                copy_directory_contents_if_missing(&source_path, &destination_path)?;
            }
        } else if file_type.is_dir() {
            copy_directory_contents_if_missing(&source_path, &destination_path)?;
        } else if file_type.is_file() {
            fs::copy(&source_path, &destination_path).map_err(|error| {
                format!(
                    "No se pudo copiar {} a {}: {error}",
                    source_path.display(),
                    destination_path.display()
                )
            })?;
        } else {
            return Err(format!(
                "No se puede migrar el elemento especial {}.",
                source_path.display()
            ));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_storage_info(app: AppHandle) -> Result<StorageInfo, String> {
    let portable_directory = portable_storage_directory()?;
    let (mode, path) = if portable_directory.is_dir() {
        ("portable", portable_directory)
    } else {
        ("appdata", app_data_storage_directory(&app)?)
    };
    Ok(StorageInfo {
        mode: mode.to_string(),
        path: path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn open_storage_directory(app: AppHandle) -> Result<(), String> {
    let directory = active_storage_directory(&app)?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("No se pudo crear {}: {error}", directory.display()))?;
    app.opener()
        .open_path(directory.to_string_lossy().into_owned(), None::<String>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_storage_location(
    app: AppHandle,
    use_portable: bool,
    move_existing_files: bool,
) -> Result<String, String> {
    let current_directory = active_storage_directory(&app)?;
    let portable_directory = portable_storage_directory()?;
    let app_data_directory = app_data_storage_directory(&app)?;
    let target_directory = if use_portable {
        &portable_directory
    } else {
        &app_data_directory
    };
    let target_existed = target_directory.exists();

    if current_directory == *target_directory {
        fs::create_dir_all(target_directory).map_err(|error| error.to_string())?;
        return Ok(target_directory.to_string_lossy().into_owned());
    }
    if !use_portable && !move_existing_files && current_directory == portable_directory {
        return Err(
            "Para cambiar desde el modo portable es necesario mover los datos a AppData."
                .to_string(),
        );
    }

    let staging_directory = if use_portable && !target_existed && move_existing_files {
        let unique_suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_nanos();
        Some(portable_directory.with_file_name(format!(
            "data.migrating-{}-{unique_suffix}",
            std::process::id()
        )))
    } else {
        None
    };
    if let Some(staging_directory) = &staging_directory {
        if staging_directory.exists() {
            return Err(format!(
                "Ya existe una migración pendiente en {}. Revisa esa carpeta antes de volver a intentarlo.",
                staging_directory.display()
            ));
        }
    }
    let migration_destination = staging_directory.as_ref().unwrap_or(target_directory);
    if let Err(error) = fs::create_dir_all(migration_destination) {
        let message = format!(
            "No se pudo acceder a {}: {error}",
            migration_destination.display()
        );
        if let Some(staging_directory) = &staging_directory {
            if staging_directory.is_dir() {
                let _ = fs::remove_dir_all(staging_directory);
            }
        } else if use_portable && !target_existed && portable_directory.is_dir() {
            if let Err(cleanup_error) = fs::remove_dir_all(&portable_directory) {
                return Err(format!(
                    "{message} Además, no se pudo limpiar la carpeta portable incompleta: {cleanup_error}"
                ));
            }
        }
        return Err(message);
    }

    let migration_result = (|| {
        if move_existing_files {
            copy_directory_contents(&current_directory, migration_destination)?;

            let legacy_cache_directory = app
                .path()
                .app_cache_dir()
                .map_err(|error| error.to_string())?
                .join("library-cache");
            let target_cache_directory = migration_destination.join("library-cache");
            if legacy_cache_directory != current_directory.join("library-cache")
                && legacy_cache_directory != target_cache_directory
            {
                copy_directory_contents(&legacy_cache_directory, &target_cache_directory)?;
            }
        }
        Ok::<(), String>(())
    })();
    if let Err(error) = migration_result {
        if let Some(staging_directory) = &staging_directory {
            if let Err(cleanup_error) = fs::remove_dir_all(staging_directory) {
                return Err(format!(
                    "{error} Además, no se pudo limpiar la migración incompleta: {cleanup_error}"
                ));
            }
        } else if use_portable && !target_existed && portable_directory.exists() {
            if let Err(cleanup_error) = fs::remove_dir_all(&portable_directory) {
                return Err(format!(
                    "{error} Además, no se pudo limpiar la carpeta portable incompleta: {cleanup_error}"
                ));
            }
        }
        return Err(error);
    }

    if let Some(staging_directory) = &staging_directory {
        if let Err(error) = fs::rename(staging_directory, &portable_directory) {
            let message = format!(
                "Los datos se copiaron, pero no se pudo activar la carpeta portable {}: {error}",
                portable_directory.display()
            );
            if let Err(cleanup_error) = fs::remove_dir_all(staging_directory) {
                return Err(format!(
                    "{message} Además, no se pudo limpiar la migración: {cleanup_error}"
                ));
            }
            return Err(message);
        }
    }

    if !use_portable && current_directory == portable_directory {
        fs::remove_dir_all(&portable_directory).map_err(|error| {
            format!(
                "Los datos se copiaron a AppData, pero no se pudo quitar {}: {error}",
                portable_directory.display()
            )
        })?;
    }

    Ok(target_directory.to_string_lossy().into_owned())
}

pub(crate) fn directory_store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let storage_directory = active_storage_directory(app)?;
    fs::create_dir_all(&storage_directory).map_err(|error| error.to_string())?;
    Ok(storage_directory.join("music-directories.json"))
}

pub fn read_music_directories(app: &AppHandle) -> Result<Vec<MusicDirectory>, String> {
    let store_path = directory_store_path(app)?;
    if !store_path.exists() {
        return Ok(Vec::new());
    }
    let contents = fs::read_to_string(store_path).map_err(|error| error.to_string())?;
    serde_json::from_str(&contents).map_err(|error| error.to_string())
}

pub fn write_music_directories(app: &AppHandle, directories: &[MusicDirectory]) -> Result<(), String> {
    let contents = serde_json::to_vec_pretty(directories).map_err(|error| error.to_string())?;
    fs::write(directory_store_path(app)?, contents).map_err(|error| error.to_string())
}

pub fn settings_store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let storage_directory = active_storage_directory(app)?;
    fs::create_dir_all(&storage_directory).map_err(|error| error.to_string())?;
    Ok(storage_directory.join("settings.json"))
}
