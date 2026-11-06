//! Caché de la biblioteca en disco.

use super::*;

pub fn library_cache_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let storage_directory = active_storage_directory(app)?;
    let directory = storage_directory.join("library-cache");
    let legacy_directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("library-cache");
    if !directory.exists() && legacy_directory.exists() && legacy_directory != directory {
        copy_directory_contents(&legacy_directory, &directory)?;
    }
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

#[tauri::command]
pub async fn get_cached_music_library(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
    // Fuente de verdad: SQLite (conexión reutilizada; migra library.json si hace falta).
    // Se ejecuta fuera del hilo principal para no congelar la ventana al leer bibliotecas grandes.
    crate::db::run_blocking(move || crate::db::with_db(&app, |conn| crate::db::load_all_tracks(conn))).await
}

/// Guarda pistas en la base de datos (y extrae las carátulas que falten).
/// `partial` = true: solo actualiza las pistas recibidas (no borra ninguna); lo normal.
/// `partial` = false: reemplazo completo (borra las que ya no están, con protección contra borrados masivos).
#[tauri::command]
pub async fn save_cached_music_library(
    app: AppHandle,
    tracks: Vec<serde_json::Value>,
    allow_shrink: Option<bool>,
    partial: Option<bool>,
) -> Result<Vec<Option<String>>, String> {
    crate::db::run_blocking(move || save_cached_music_library_blocking(app, tracks, allow_shrink, partial)).await
}

fn save_cached_music_library_blocking(
    app: AppHandle,
    mut tracks: Vec<serde_json::Value>,
    allow_shrink: Option<bool>,
    partial: Option<bool>,
) -> Result<Vec<Option<String>>, String> {
    use base64::Engine;
    use lofty::prelude::*;

    let cache_directory = library_cache_directory(&app)?;
    let covers_directory = cache_directory.join("covers");
    fs::create_dir_all(&covers_directory).map_err(|error| {
        format!(
            "No se pudo crear la carpeta de carátulas {}: {error}",
            covers_directory.display()
        )
    })?;
    app.asset_protocol_scope()
        .allow_directory(&covers_directory, true)
        .map_err(|error| error.to_string())?;

    // 1. Convertir cualquier data:image/... en archivo deduplicado y redimensionado (512x512)
    for track in &mut tracks {
        let Some(track_object) = track.as_object_mut() else {
            continue;
        };
        let Some(cover_url) = track_object
            .get("coverUrl")
            .and_then(serde_json::Value::as_str)
        else {
            continue;
        };
        let Some(data_url) = cover_url.strip_prefix("data:image/") else {
            continue;
        };
        let Some((image_header, encoded_image)) = data_url.split_once(',') else {
            return Err("La carátula de la biblioteca no contiene datos válidos.".to_string());
        };
        if !image_header.ends_with(";base64") {
            continue;
        }
        let Some(track_path) = track_object
            .get("path")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
        else {
            continue;
        };
        let image_bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded_image)
            .map_err(|error| {
                format!("No se pudo decodificar una carátula de la biblioteca: {error}")
            })?;
        if let Ok(saved_cover_path) = save_scanned_cover_to_cache(&app, &track_path, &image_bytes) {
            track_object.insert(
                "coverUrl".to_string(),
                serde_json::Value::String(saved_cover_path),
            );
        }
    }

    // 2. Solo extraer carátula del archivo si nunca se inspeccionó antes (no es "none" ni existe en disco)
    for track in &mut tracks {
        let Some(track_object) = track.as_object_mut() else {
            continue;
        };
        if let Some(existing_cover) = track_object
            .get("coverUrl")
            .and_then(serde_json::Value::as_str)
        {
            if existing_cover == "none" || Path::new(existing_cover).is_file() {
                continue;
            }
        }
        let Some(track_path) = track_object
            .get("path")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
        else {
            continue;
        };
        let source_path = match ensure_path_in_library(&app, &track_path) {
            Ok(path) => path,
            Err(error) => {
                eprintln!("No se pudo acceder al archivo al guardar su carátula: {error}");
                continue;
            }
        };
        let tagged_file = match lofty::read_from_path(&source_path) {
            Ok(tagged_file) => tagged_file,
            Err(error) => {
                eprintln!(
                    "No se pudieron leer las carátulas de {}: {error}",
                    source_path.display()
                );
                track_object.insert(
                    "coverUrl".to_string(),
                    serde_json::Value::String("none".to_string()),
                );
                continue;
            }
        };
        let Some(picture) = tagged_file
            .tags()
            .iter()
            .flat_map(|tag| tag.pictures())
            .next()
        else {
            // Marcar como "none" para no reabrir el archivo con lofty en futuros guardados
            track_object.insert(
                "coverUrl".to_string(),
                serde_json::Value::String("none".to_string()),
            );
            continue;
        };
        let image_bytes = picture.data();
        match save_scanned_cover_to_cache(&app, &track_path, image_bytes) {
            Ok(saved_path) => {
                track_object.insert(
                    "coverUrl".to_string(),
                    serde_json::Value::String(saved_path),
                );
            }
            Err(error) => {
                eprintln!(
                    "No se pudo guardar la carátula de {}: {error}",
                    source_path.display()
                );
                track_object.insert(
                    "coverUrl".to_string(),
                    serde_json::Value::String("none".to_string()),
                );
            }
        }
    }

    let cover_paths = tracks
        .iter()
        .map(|track| {
            track
                .get("coverUrl")
                .and_then(serde_json::Value::as_str)
                .filter(|cover_path| *cover_path == "none" || Path::new(cover_path).is_file())
                .map(str::to_string)
        })
        .collect();
    // Persistir en SQLite (transaccional; reemplaza el antiguo library.json)
    let partial = partial.unwrap_or(false);
    crate::db::with_db(&app, |conn| {
        if partial {
            crate::db::upsert_tracks(conn, &tracks)
        } else {
            crate::db::replace_all_tracks(conn, &tracks, allow_shrink.unwrap_or(false))
        }
    })?;
    Ok(cover_paths)
}

pub fn directory_size(path: &Path) -> Result<u64, String> {
    if !path.exists() {
        return Ok(0);
    }
    let mut total = 0_u64;
    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        if metadata.is_dir() {
            total = total.saturating_add(directory_size(&entry.path())?);
        } else {
            total = total.saturating_add(metadata.len());
        }
    }
    Ok(total)
}

#[tauri::command]
pub fn get_library_cache_size(app: AppHandle) -> Result<u64, String> {
    directory_size(&library_cache_directory(&app)?)
}

#[tauri::command]
pub async fn clear_library_cache(app: AppHandle) -> Result<(), String> {
    crate::db::run_blocking(move || clear_library_cache_blocking(app)).await
}

fn clear_library_cache_blocking(app: AppHandle) -> Result<(), String> {
    let path = library_cache_directory(&app)?;
    // 1) Vaciar la caché de pistas DENTRO de la base de datos. El archivo no se borra: la conexión
    //    sigue abierta (en Windows no se puede borrar) y la base también guarda las playlists.
    crate::db::with_db(&app, |conn| crate::db::clear_cache_tables(conn))?;

    // 2) Borrar el resto de la caché (carátulas, library.json antiguo...), conservando la base de datos.
    let db_name = crate::db::DB_NAME;
    let db_prefix = format!("{}-", db_name);
    if path.exists() {
        for entry in fs::read_dir(&path).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let entry_path = entry.path();
            let file_name = entry.file_name().to_string_lossy().to_string();
            if file_name == db_name || file_name.starts_with(&db_prefix) {
                continue;
            }
            if entry_path.is_dir() {
                fs::remove_dir_all(&entry_path).map_err(|error| error.to_string())?;
            } else {
                fs::remove_file(&entry_path).map_err(|error| error.to_string())?;
            }
        }
    }
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    let legacy_directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("library-cache");
    if legacy_directory != path && legacy_directory.exists() {
        fs::remove_dir_all(legacy_directory).map_err(|error| error.to_string())?;
    }
    Ok(())
}
