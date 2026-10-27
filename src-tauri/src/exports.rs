//! Exportaciones: portadas de playlist, listas M3U8 y copias de seguridad de ajustes.

use super::*;

#[tauri::command]
pub fn save_playlist_cover(
    app: AppHandle,
    playlist_id: String,
    image_data: Vec<u8>,
    extension: String,
) -> Result<String, String> {
    if playlist_id.is_empty()
        || playlist_id.len() > 80
        || !playlist_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
    {
        return Err("El identificador de la playlist no es válido.".to_string());
    }
    if image_data.is_empty() {
        return Err("La imagen de portada está vacía.".to_string());
    }
    let extension = extension.trim_start_matches('.').to_ascii_lowercase();
    if !matches!(extension.as_str(), "jpg" | "jpeg" | "png" | "webp" | "gif") {
        return Err("Formato de imagen no válido para la portada de playlist.".to_string());
    }

    let covers_directory = active_storage_directory(&app)?
        .join("covers")
        .join("playlists");
    fs::create_dir_all(&covers_directory).map_err(|error| {
        format!(
            "No se pudo crear la carpeta de portadas {}: {error}",
            covers_directory.display()
        )
    })?;
    let cover_path = covers_directory.join(format!("{playlist_id}.{extension}"));
    fs::write(&cover_path, image_data)
        .map_err(|error| format!("No se pudo guardar la portada: {error}"))?;
    app.asset_protocol_scope()
        .allow_directory(&covers_directory, true)
        .map_err(|error| error.to_string())?;
    Ok(cover_path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn save_m3u8_file(file_name: String, contents: String) -> Result<bool, String> {
    let Some(selected_path) = rfd::FileDialog::new()
        .set_title("Guardar playlist M3U8")
        .add_filter("Playlist M3U8", &["m3u8"])
        .set_file_name(&file_name)
        .save_file()
    else {
        return Ok(false);
    };

    let output_path = if selected_path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("m3u8"))
    {
        selected_path
    } else {
        selected_path.with_extension("m3u8")
    };
    fs::write(output_path, contents.as_bytes()).map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn save_settings_backup(contents: String) -> Result<bool, String> {
    if contents.len() > 32 * 1024 * 1024 {
        return Err("La copia de seguridad supera el tamaño máximo de 32 MiB.".to_string());
    }
    serde_json::from_str::<serde_json::Value>(&contents)
        .map_err(|error| format!("El archivo de respaldo no contiene JSON válido: {error}"))?;
    let Some(selected_path) = rfd::FileDialog::new()
        .set_title("Exportar configuración de Resonance")
        .add_filter("Respaldo de Resonance", &["json"])
        .set_file_name("resonance-settings.json")
        .save_file()
    else {
        return Ok(false);
    };
    let output_path = if selected_path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
    {
        selected_path
    } else {
        selected_path.with_extension("json")
    };
    fs::write(output_path, contents.as_bytes()).map_err(|error| error.to_string())?;
    Ok(true)
}
