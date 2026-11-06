//! Discord Rich Presence y caché de carátulas.

use super::*;

#[derive(Default)]
pub struct DiscordRpcState(pub Mutex<DiscordRpcClientState>);

#[derive(Default)]
pub struct DiscordCoverCache {
    pub entries: RwLock<HashMap<String, String>>,
    pub pending: Mutex<HashSet<String>>,
    pub retry_after: Mutex<HashMap<String, std::time::Instant>>,
    pub path: Mutex<Option<PathBuf>>,
    pub upload_failures: Mutex<Vec<DiscordCoverUploadFailure>>,
    pub upload_failures_path: Mutex<Option<PathBuf>>,
}

#[derive(Default)]
pub struct DiscordRpcClientState {
    pub enabled: bool,
    pub client: Option<DiscordIpcClient>,
    pub presence_visible: bool,
    pub pause_generation: u64,
    pub current_cover_path: Option<String>,
    pub current_cover_source_path: Option<String>,
    pub current_cover_url: Option<String>,
    pub cover_generation: u64,
    pub cover_resolving: bool,
    pub cover_attempted: bool,
    pub cover_retry_at: Option<std::time::Instant>,
    pub latest_update: Option<DiscordPresenceUpdate>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordPresenceUpdate {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub large_image: Option<String>,
    pub artwork_mode: Option<String>,
    pub file_path: Option<String>,
    pub cover_path: Option<String>,
    pub playing: bool,
    pub position_seconds: f64,
    pub duration_seconds: f64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordCoverUploadFailure {
    pub path: String,
    pub title: String,
    pub artist: String,
    pub error: String,
    pub failed_at: u64,
}

pub const DISCORD_APPLICATION_ID: &str = "1556755582961066126";
pub const DISCORD_PAUSE_HIDE_DELAY: std::time::Duration = std::time::Duration::from_secs(30);
pub const DISCORD_COVER_RETRY_DELAY: std::time::Duration = std::time::Duration::from_secs(125);
const DISCORD_COVER_FAILURE_HISTORY_LIMIT: usize = 100;

pub fn connect_discord_client(state: &mut DiscordRpcClientState) -> Result<(), String> {
    if state.client.is_none() {
        let mut client = DiscordIpcClient::new(DISCORD_APPLICATION_ID)
            .map_err(|error| format!("No se pudo crear el cliente de Discord: {error}"))?;
        client
            .connect()
            .map_err(|error| format!("No se pudo conectar con Discord Rich Presence: {error}"))?;
        state.client = Some(client);
    }
    Ok(())
}

#[tauri::command]
pub fn set_discord_rpc_enabled(
    enabled: bool,
    rpc_state: State<'_, DiscordRpcState>,
) -> Result<(), String> {
    let mut state = rpc_state
        .0
        .lock()
        .map_err(|error| format!("No se pudo acceder al cliente de Discord: {error}"))?;

    if enabled {
        connect_discord_client(&mut state)?;
        state.enabled = true;
        return Ok(());
    }

    let mut errors = Vec::new();
    if let Some(mut client) = state.client.take() {
        if let Err(error) = client.clear_activity() {
            errors.push(format!(
                "No se pudo limpiar la actividad de Discord: {error}"
            ));
        }
        if let Err(error) = client.close() {
            errors.push(format!(
                "No se pudo cerrar la conexión con Discord: {error}"
            ));
        }
    }
    state.enabled = false;
    state.presence_visible = false;
    state.pause_generation = state.pause_generation.wrapping_add(1);
    state.cover_generation = state.cover_generation.wrapping_add(1);
    state.current_cover_path = None;
    state.current_cover_source_path = None;
    state.current_cover_url = None;
    state.cover_resolving = false;
    state.cover_attempted = false;
    state.cover_retry_at = None;
    state.latest_update = None;
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join(" "))
    }
}

pub fn set_discord_activity(
    state: &mut DiscordRpcClientState,
    update: &DiscordPresenceUpdate,
    large_image: &str,
) -> Result<(), String> {
    let Some(title) = update
        .title
        .as_deref()
        .filter(|title| !title.trim().is_empty())
    else {
        if let Some(client) = state.client.as_mut() {
            client
                .clear_activity()
                .map_err(|error| format!("No se pudo limpiar la actividad de Discord: {error}"))?;
        }
        return Ok(());
    };

    let title: String = title.chars().take(128).collect();
    let artist: String = update
        .artist
        .as_deref()
        .filter(|artist| !artist.trim().is_empty())
        .unwrap_or("Artista desconocido")
        .chars()
        .take(128)
        .collect();
    let status = if update.playing {
        "Reproduciendo"
    } else {
        "En pausa"
    };
    let timestamp = if update.playing
        && update.duration_seconds.is_finite()
        && update.duration_seconds > 0.0
        && update.position_seconds.is_finite()
    {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| format!("No se pudo obtener la hora del sistema: {error}"))?
            .as_secs() as i64;
        let duration = update.duration_seconds.round() as i64;
        let position = update
            .position_seconds
            .max(0.0)
            .min(update.duration_seconds)
            .round() as i64;
        let start = now - position;
        Some((start, start + duration))
    } else {
        None
    };
    let build_activity = || {
        let mut activity = Activity::new()
            .activity_type(ActivityType::Listening)
            .details(&title)
            .state(&artist)
            .assets(
                Assets::new()
                    .large_image(large_image)
                    .small_image(if update.playing {
                        "play_icon"
                    } else {
                        "pause_icon"
                    })
                    .small_text(status),
            );
        if let Some((start, end)) = timestamp {
            activity = activity.timestamps(Timestamps::new().start(start).end(end));
        }
        activity
    };

    connect_discord_client(state)?;
    let first_result = state
        .client
        .as_mut()
        .ok_or_else(|| "El cliente de Discord no está conectado.".to_string())?
        .set_activity(build_activity());
    let first_error = match first_result {
        Ok(()) => return Ok(()),
        Err(error) => error,
    };
    if let Some(mut stale_client) = state.client.take() {
        let _ = stale_client.close();
    }
    connect_discord_client(state).map_err(|reconnect_error| {
        format!(
            "No se pudo actualizar Discord Rich Presence ({first_error}) ni reconectar ({reconnect_error})."
        )
    })?;
    state
        .client
        .as_mut()
        .ok_or_else(|| {
            "El cliente de Discord no está conectado después de reconectar.".to_string()
        })?
        .set_activity(build_activity())
        .map_err(|error| {
            format!("No se pudo actualizar Discord Rich Presence después de reconectar: {error}")
        })
}

pub fn initialize_discord_cover_cache(
    app: &AppHandle,
    cache: &DiscordCoverCache,
) -> Result<(), String> {
    let directory = app_data_storage_directory(app)?;
    fs::create_dir_all(&directory).map_err(|error| {
        format!("No se pudo crear la carpeta de la caché de carátulas de Discord: {error}")
    })?;
    let path = directory.join("discord_covers_cache.json");
    let failures_path = directory.join("discord_cover_upload_errors.json");
    let entries = if path.exists() {
        match fs::read_to_string(&path) {
            Ok(contents) => match serde_json::from_str::<HashMap<String, String>>(&contents) {
                Ok(entries) => entries,
                Err(error) => {
                    eprintln!("La caché de carátulas de Discord no es válida: {error}");
                    HashMap::new()
                }
            },
            Err(error) => {
                eprintln!("No se pudo leer la caché de carátulas de Discord: {error}");
                HashMap::new()
            }
        }
    } else {
        HashMap::new()
    };
    *cache
        .entries
        .write()
        .map_err(|error| format!("No se pudo cargar la caché de Discord: {error}"))? = entries;
    *cache.path.lock().map_err(|error| {
        format!("No se pudo inicializar la ruta de caché de Discord: {error}")
    })? = Some(path);
    let failures = if failures_path.exists() {
        match fs::read_to_string(&failures_path) {
            Ok(contents) => match serde_json::from_str::<Vec<DiscordCoverUploadFailure>>(&contents)
            {
                Ok(mut failures) => {
                    failures.truncate(DISCORD_COVER_FAILURE_HISTORY_LIMIT);
                    failures
                }
                Err(error) => {
                    eprintln!(
                        "El historial de subidas de carátulas de Discord no es válido: {error}"
                    );
                    Vec::new()
                }
            },
            Err(error) => {
                eprintln!(
                    "No se pudo leer el historial de subidas de carátulas de Discord: {error}"
                );
                Vec::new()
            }
        }
    } else {
        Vec::new()
    };
    *cache.upload_failures.lock().map_err(|error| {
        format!("No se pudo cargar el historial de carátulas de Discord: {error}")
    })? = failures;
    *cache.upload_failures_path.lock().map_err(|error| {
        format!("No se pudo inicializar la ruta del historial de Discord: {error}")
    })? = Some(failures_path);
    Ok(())
}

pub fn extract_embedded_cover(file_path: PathBuf) -> Result<Option<Vec<u8>>, String> {
    use lofty::prelude::*;

    let tagged_file = lofty::read_from_path(&file_path)
        .map_err(|error| format!("No se pudieron leer los metadatos de la pista: {error}"))?;
    Ok(tagged_file
        .tags()
        .iter()
        .flat_map(|tag| tag.pictures())
        .next()
        .map(|picture| picture.data().to_vec()))
}

fn read_local_cover(app: &AppHandle, raw_path: &str) -> Result<Vec<u8>, String> {
    let path = PathBuf::from(raw_path)
        .canonicalize()
        .map_err(|error| format!("No se pudo acceder a la carátula local: {error}"))?;
    if !path.is_file() {
        return Err("La ruta de la carátula local no es un archivo.".to_string());
    }

    let roots = canonical_music_roots(app)?;
    let covers_directory = crate::metadata::prepare_covers_cache_directory(app)?
        .canonicalize()
        .map_err(|error| format!("No se pudo validar la caché de carátulas: {error}"))?;
    let is_allowed =
        roots.iter().any(|root| path.starts_with(root)) || path.starts_with(covers_directory);
    if !is_allowed {
        return Err("La carátula no pertenece a una carpeta de música vinculada ni a la caché de Resonance.".to_string());
    }

    let bytes =
        fs::read(&path).map_err(|error| format!("No se pudo leer la carátula local: {error}"))?;
    if bytes.is_empty() || bytes.len() > 25 * 1024 * 1024 {
        return Err(
            "La carátula local está vacía o supera el límite de lectura de 25 MB.".to_string(),
        );
    }
    Ok(bytes)
}

pub fn encode_discord_cover(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| format!("No se pudo reconocer la carátula incrustada: {error}"))?;
    let (width, height) = reader
        .into_dimensions()
        .map_err(|error| format!("No se pudo leer el tamaño de la carátula: {error}"))?;
    if width == 0
        || height == 0
        || width > 12_000
        || height > 12_000
        || u64::from(width) * u64::from(height) > 60_000_000
    {
        return Err("Las dimensiones de la carátula están fuera de los límites permitidos.".into());
    }
    let image = image::load_from_memory(bytes)
        .map_err(|error| format!("La carátula incrustada no es una imagen válida: {error}"))?;
    for dimension in [512, 448, 384, 320, 256] {
        let resized = image.resize(dimension, dimension, image::imageops::FilterType::Lanczos3);
        let rgb = resized.to_rgb8();
        for quality in [80, 70, 60, 50, 40, 30] {
            let mut output = Cursor::new(Vec::new());
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output, quality)
                .encode(
                    rgb.as_raw(),
                    rgb.width(),
                    rgb.height(),
                    image::ExtendedColorType::Rgb8,
                )
                .map_err(|error| format!("No se pudo comprimir la carátula: {error}"))?;
            if output.get_ref().len() <= 100 * 1024 {
                return Ok(output.into_inner());
            }
        }
    }
    Err("La carátula supera el límite de 100 KB incluso comprimida.".to_string())
}

pub async fn upload_discord_cover(bytes: Vec<u8>) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .http1_only()
        .user_agent("Resonance/1.0.0 (https://github.com/local/resonance)")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| format!("No se pudo iniciar la subida de la carátula: {error}"))?;

    let response = {
        let mut response = None;
        for attempt in 0..3 {
            let part = reqwest::multipart::Part::bytes(bytes.clone())
                .file_name("resonance-cover.jpg")
                .mime_str("image/jpeg")
                .map_err(|error| format!("No se pudo preparar la carátula: {error}"))?;
            let form = reqwest::multipart::Form::new()
                .text("reqtype", "fileupload")
                .part("fileToUpload", part);
            match client
                .post("https://catbox.moe/user/api.php")
                .header(reqwest::header::ACCEPT, "*/*")
                .multipart(form)
                .send()
                .await
            {
                Ok(result)
                    if attempt < 2
                        && (result.status().as_u16() == 429
                            || result.status().is_server_error()) =>
                {
                    tokio::time::sleep(std::time::Duration::from_millis(500 * (attempt + 1))).await;
                }
                Ok(result) => {
                    response = Some(result);
                    break;
                }
                Err(error)
                    if attempt < 2
                        && (error.is_connect() || error.is_timeout() || error.is_request()) =>
                {
                    tokio::time::sleep(std::time::Duration::from_millis(500 * (attempt + 1))).await;
                }
                Err(error) => {
                    let category = if error.is_timeout() {
                        "tiempo de espera agotado"
                    } else if error.is_connect() {
                        "no se pudo establecer conexión TLS/HTTPS"
                    } else {
                        "fallo de transporte HTTP"
                    };
                    let cause = std::error::Error::source(&error)
                        .map(|source| format!(" Causa: {source}"))
                        .unwrap_or_default();
                    return Err(format!(
                        "No se pudo subir la carátula ({category}): {error}.{cause}"
                    ));
                }
            }
        }
        response.ok_or_else(|| "Catbox no respondió a la subida de la carátula.".to_string())?
    };
    if !response.status().is_success() {
        return Err(format!(
            "El servicio de carátulas respondió con HTTP {}.",
            response.status()
        ));
    }
    let url = response
        .text()
        .await
        .map_err(|error| format!("No se pudo leer la respuesta de la subida: {error}"))?
        .trim()
        .to_string();
    if !url.starts_with("https://files.catbox.moe/") {
        return Err("El servicio de carátulas devolvió una URL no válida.".to_string());
    }
    Ok(url)
}

pub async fn resolve_discord_cover(
    app: AppHandle,
    raw_path: String,
    raw_cover_path: Option<String>,
) -> Result<Option<String>, String> {
    let file_path = ensure_path_in_library(&app, &raw_path)?;
    let local_cover = raw_cover_path.filter(|path| !path.trim().is_empty() && path != "none");
    let external_cover_result = if let Some(cover_path) = local_cover {
        let app_for_cover = app.clone();
        Some(
            tauri::async_runtime::spawn_blocking(move || {
                read_local_cover(&app_for_cover, &cover_path)
            })
            .await
            .map_err(|error| format!("No se pudo leer la carátula local: {error}"))?,
        )
    } else {
        None
    };
    let bytes = match external_cover_result {
        Some(Ok(bytes)) => Some(bytes),
        Some(Err(error)) => {
            eprintln!("{error} Se intentará usar la carátula incrustada en el audio.");
            tauri::async_runtime::spawn_blocking(move || extract_embedded_cover(file_path))
                .await
                .map_err(|error| format!("No se pudo analizar la carátula de la pista: {error}"))??
                .or_else(|| {
                    eprintln!("Discord Rich Presence: no se encontró una carátula incrustada como alternativa.");
                    None
                })
        }
        None => tauri::async_runtime::spawn_blocking(move || extract_embedded_cover(file_path))
            .await
            .map_err(|error| format!("No se pudo analizar la carátula de la pista: {error}"))??,
    };
    let Some(bytes) = bytes else {
        eprintln!(
            "Discord Rich Presence: no se encontró una carátula local ni una carátula incrustada."
        );
        return Ok(None);
    };
    if bytes.len() > 25 * 1024 * 1024 {
        return Err("La carátula incrustada supera el límite de lectura de 25 MB.".to_string());
    }
    let hash = format!("{:x}", Sha256::digest(&bytes));
    let cache = app.state::<DiscordCoverCache>();
    if let Some(url) = cache
        .entries
        .read()
        .map_err(|error| format!("No se pudo consultar la caché de Discord: {error}"))?
        .get(&hash)
        .cloned()
    {
        eprintln!("Discord Rich Presence: carátula local encontrada en caché.");
        return Ok(Some(url));
    }
    let retry_at = cache
        .retry_after
        .lock()
        .map_err(|error| format!("No se pudo consultar la espera de subida: {error}"))?
        .get(&hash)
        .copied();
    if retry_at.is_some_and(|retry_at| retry_at > std::time::Instant::now()) {
        return Ok(None);
    }
    if retry_at.is_some() {
        cache
            .retry_after
            .lock()
            .map_err(|error| format!("No se pudo actualizar la espera de subida: {error}"))?
            .remove(&hash);
    }
    let already_pending = {
        let mut pending = cache
            .pending
            .lock()
            .map_err(|error| format!("No se pudo consultar las subidas activas: {error}"))?;
        !pending.insert(hash.clone())
    };
    if already_pending {
        for _ in 0..950 {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            if let Some(url) = cache
                .entries
                .read()
                .map_err(|error| format!("No se pudo consultar la caché de Discord: {error}"))?
                .get(&hash)
                .cloned()
            {
                return Ok(Some(url));
            }
            if !cache
                .pending
                .lock()
                .map_err(|error| format!("No se pudo consultar las subidas activas: {error}"))?
                .contains(&hash)
            {
                return Err(
                    "Se agotó el tiempo de espera para otra subida de esta carátula.".to_string(),
                );
            }
        }
        return Ok(None);
    }

    let upload_result = async {
        let encoded = tauri::async_runtime::spawn_blocking(move || encode_discord_cover(&bytes))
            .await
            .map_err(|error| format!("No se pudo comprimir la carátula: {error}"))??;
        upload_discord_cover(encoded).await
    }
    .await;
    cache
        .pending
        .lock()
        .map_err(|error| format!("No se pudo actualizar el estado de la subida: {error}"))?
        .remove(&hash);
    let url = match upload_result {
        Ok(url) => {
            cache
                .retry_after
                .lock()
                .map_err(|error| format!("No se pudo actualizar el reintento de subida: {error}"))?
                .remove(&hash);
            eprintln!("Discord Rich Presence: carátula local alojada correctamente.");
            url
        }
        Err(error) => {
            cache
                .retry_after
                .lock()
                .map_err(|lock_error| {
                    format!("No se pudo programar el reintento de subida: {lock_error}")
                })?
                .insert(
                    hash,
                    std::time::Instant::now() + std::time::Duration::from_secs(120),
                );
            return Err(error);
        }
    };

    let mut entries = cache
        .entries
        .write()
        .map_err(|error| format!("No se pudo guardar la URL en la caché: {error}"))?;
    entries.insert(hash, url.clone());
    let path = cache
        .path
        .lock()
        .map_err(|error| format!("No se pudo consultar la ruta de caché: {error}"))?
        .clone()
        .ok_or_else(|| "La ruta de la caché de Discord no está inicializada.".to_string())?;
    let persist_result = (|| {
        let contents = serde_json::to_vec_pretty(&*entries)
            .map_err(|error| format!("No se pudo serializar la caché de Discord: {error}"))?;
        let temporary_path = path.with_extension("json.tmp");
        fs::write(&temporary_path, contents)
            .map_err(|error| format!("No se pudo escribir la caché de Discord: {error}"))?;
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|error| format!("No se pudo reemplazar la caché de Discord: {error}"))?;
        }
        fs::rename(&temporary_path, &path)
            .map_err(|error| format!("No se pudo finalizar la caché de Discord: {error}"))
    })();
    if let Err(error) = persist_result {
        eprintln!("{error}");
    }
    Ok(Some(url))
}

fn record_discord_cover_upload_failure(
    app: &AppHandle,
    path: String,
    title: String,
    artist: String,
    error: String,
) -> Result<(), String> {
    let cache = app.state::<DiscordCoverCache>();
    let failed_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("No se pudo obtener la hora del error de subida: {error}"))?
        .as_secs();
    let failure = DiscordCoverUploadFailure {
        path: path.clone(),
        title,
        artist,
        error,
        failed_at,
    };
    let mut failures = cache
        .upload_failures
        .lock()
        .map_err(|error| format!("No se pudo actualizar el historial de subidas: {error}"))?;
    let path_key = normalize_discord_path_key(&path);
    failures.retain(|entry| normalize_discord_path_key(&entry.path) != path_key);
    failures.insert(0, failure);
    failures.truncate(DISCORD_COVER_FAILURE_HISTORY_LIMIT);

    let history_path = cache
        .upload_failures_path
        .lock()
        .map_err(|error| format!("No se pudo consultar la ruta del historial de subidas: {error}"))?
        .clone()
        .ok_or_else(|| "La ruta del historial de subidas no está inicializada.".to_string())?;
    let contents = serde_json::to_vec_pretty(&*failures)
        .map_err(|error| format!("No se pudo serializar el historial de subidas: {error}"))?;
    let temporary_path = history_path.with_extension("json.tmp");
    fs::write(&temporary_path, contents)
        .map_err(|error| format!("No se pudo escribir el historial de subidas: {error}"))?;
    if history_path.exists() {
        fs::remove_file(&history_path)
            .map_err(|error| format!("No se pudo reemplazar el historial de subidas: {error}"))?;
    }
    fs::rename(&temporary_path, &history_path)
        .map_err(|error| format!("No se pudo finalizar el historial de subidas: {error}"))
}

#[tauri::command]
pub fn get_discord_cover_upload_errors(
    cache: State<'_, DiscordCoverCache>,
) -> Result<Vec<DiscordCoverUploadFailure>, String> {
    cache
        .upload_failures
        .lock()
        .map(|failures| failures.clone())
        .map_err(|error| format!("No se pudo consultar el historial de subidas: {error}"))
}

fn emit_discord_cover_status(
    app: &AppHandle,
    status: &str,
    title: &str,
    artist: &str,
    error: Option<&str>,
) {
    let payload = serde_json::json!({
        "status": status,
        "title": title,
        "artist": artist,
        "error": error,
    });
    if let Err(emit_error) = app.emit("discord-cover-upload-status", payload) {
        eprintln!("No se pudo informar el estado de la carátula de Discord: {emit_error}");
    }
}

#[tauri::command]
pub fn update_discord_presence(
    update: DiscordPresenceUpdate,
    app: AppHandle,
    rpc_state: State<'_, DiscordRpcState>,
) -> Result<(), String> {
    let mut state = rpc_state
        .0
        .lock()
        .map_err(|error| format!("No se pudo acceder al cliente de Discord: {error}"))?;
    if !state.enabled {
        return Ok(());
    }
    let local_artwork = update.artwork_mode.as_deref() == Some("local");
    let file_path = update.file_path.clone().filter(|path| !path.is_empty());
    let cover_path = update
        .cover_path
        .clone()
        .filter(|path| !path.trim().is_empty() && path != "none");
    let was_playing = state
        .latest_update
        .as_ref()
        .map(|latest| latest.playing)
        .unwrap_or(false);
    let has_title = update
        .title
        .as_deref()
        .is_some_and(|title| !title.trim().is_empty());
    let playing_changed = was_playing != update.playing;
    state.latest_update = Some(update.clone());
    // No forzar presence_visible=true en cada update en pausa: tras clear_activity
    // (30s) debe permanecer oculto hasta que se reanude la reproducción.
    if update.playing {
        state.presence_visible = has_title;
    } else if playing_changed {
        // Acaba de pausar: visible hasta que venza el temporizador
        state.presence_visible = has_title;
    }
    // still paused: conservar presence_visible (false si ya se ocultó)

    if playing_changed || update.playing {
        state.pause_generation = state.pause_generation.wrapping_add(1);
    }
    let pause_generation = state.pause_generation;
    let should_start_pause_timer = !update.playing && playing_changed && has_title;
    let skip_activity_while_hidden = !update.playing && !state.presence_visible;
    if local_artwork && file_path.is_none() && !state.cover_attempted {
        eprintln!("Discord Rich Presence: no se recibió una ruta local para resolver la carátula.");
        state.cover_attempted = true;
        emit_discord_cover_status(
            &app,
            "error",
            update.title.as_deref().unwrap_or_default(),
            update.artist.as_deref().unwrap_or_default(),
            Some("No se recibió la ruta local del archivo."),
        );
    }
    let (large_image, cover_task) = if local_artwork {
        if state.current_cover_path != file_path || state.current_cover_source_path != cover_path {
            state.cover_generation = state.cover_generation.wrapping_add(1);
            state.current_cover_path = file_path.clone();
            state.current_cover_source_path = cover_path.clone();
            state.current_cover_url = None;
            state.cover_resolving = false;
            state.cover_attempted = false;
            state.cover_retry_at = None;
        }
        let image = state
            .current_cover_url
            .clone()
            .unwrap_or_else(|| "music_default".to_string());
        let start_resolution = file_path.as_ref().is_some_and(|_| {
            !state.cover_resolving
                && state.current_cover_url.is_none()
                && (!state.cover_attempted
                    || state
                        .cover_retry_at
                        .is_some_and(|retry_at| retry_at <= std::time::Instant::now()))
        });
        if start_resolution {
            state.cover_resolving = true;
            state.cover_attempted = true;
            state.cover_retry_at = None;
        }
        let cover_task = if start_resolution {
            file_path.clone().map(|path| {
                (
                    path,
                    cover_path.clone(),
                    state.cover_generation,
                    update.title.clone().unwrap_or_default(),
                    update.artist.clone().unwrap_or_default(),
                )
            })
        } else {
            None
        };
        (image, cover_task)
    } else {
        if state.current_cover_path.is_some() || state.current_cover_url.is_some() {
            state.cover_generation = state.cover_generation.wrapping_add(1);
            state.current_cover_path = None;
            state.current_cover_source_path = None;
            state.current_cover_url = None;
            state.cover_resolving = false;
            state.cover_attempted = false;
            state.cover_retry_at = None;
        }
        (
            update
                .large_image
                .as_deref()
                .filter(|image| image.starts_with("https://"))
                .unwrap_or("music_default")
                .to_string(),
            None,
        )
    };
    if !skip_activity_while_hidden {
        set_discord_activity(&mut state, &update, &large_image)?;
    }
    if local_artwork && cover_task.is_some() {
        if let Some((_, _, _, title, artist)) = &cover_task {
            emit_discord_cover_status(&app, "uploading", title, artist, None);
        }
    }
    drop(state);

    if should_start_pause_timer {
        let app_for_pause_timer = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(DISCORD_PAUSE_HIDE_DELAY).await;
            let rpc_state = app_for_pause_timer.state::<DiscordRpcState>();
            let Ok(mut rpc_state) = rpc_state.0.lock() else {
                eprintln!("No se pudo comprobar la pausa de Discord Rich Presence.");
                return;
            };
            if !rpc_state.enabled
                || rpc_state.pause_generation != pause_generation
                || rpc_state
                    .latest_update
                    .as_ref()
                    .map_or(true, |latest_update| latest_update.playing)
            {
                return;
            }
            if let Some(client) = rpc_state.client.as_mut() {
                if let Err(error) = client.clear_activity() {
                    eprintln!("No se pudo ocultar la actividad pausada de Discord: {error}");
                    return;
                }
            }
            rpc_state.presence_visible = false;
        });
    }

    if let Some((file_path, cover_path, generation, title, artist)) = cover_task {
        let app_for_task = app.clone();
        tauri::async_runtime::spawn(async move {
            let resolved =
                resolve_discord_cover(app_for_task.clone(), file_path.clone(), cover_path).await;
            let (image_url, upload_failed) = match resolved {
                Ok(url) => {
                    if url.is_some() {
                        emit_discord_cover_status(&app_for_task, "success", &title, &artist, None);
                    } else {
                        emit_discord_cover_status(
                            &app_for_task,
                            "missing",
                            &title,
                            &artist,
                            Some("No se encontró una carátula local ni una imagen incrustada."),
                        );
                    }
                    (url, false)
                }
                Err(error) => {
                    eprintln!(
                        "No se pudo alojar la carátula local para Discord; se mantiene el icono predeterminado. {error}"
                    );
                    if let Err(history_error) = record_discord_cover_upload_failure(
                        &app_for_task,
                        file_path.clone(),
                        title.clone(),
                        artist.clone(),
                        error.clone(),
                    ) {
                        eprintln!("{history_error}");
                    }
                    emit_discord_cover_status(
                        &app_for_task,
                        "error",
                        &title,
                        &artist,
                        Some(&error),
                    );
                    (None, true)
                }
            };
            let rpc_state = app_for_task.state::<DiscordRpcState>();
            let Ok(mut rpc_state) = rpc_state.0.lock() else {
                eprintln!("No se pudo actualizar Discord después de resolver la carátula.");
                return;
            };
            if !rpc_state.enabled || rpc_state.cover_generation != generation {
                return;
            }
            let path_matches = rpc_state
                .current_cover_path
                .as_deref()
                .is_some_and(|current| {
                    normalize_discord_path_key(current) == normalize_discord_path_key(&file_path)
                });
            if !path_matches {
                return;
            }
            rpc_state.cover_resolving = false;
            if let Some(image_url) = image_url {
                rpc_state.current_cover_url = Some(image_url.clone());
                rpc_state.cover_attempted = true;
                rpc_state.cover_retry_at = None;
                if rpc_state.presence_visible {
                    if let Some(latest_update) = rpc_state.latest_update.clone() {
                        // No reaparecer en Discord si la presencia ya se ocultó por pausa
                        if !latest_update.playing && !rpc_state.presence_visible {
                            eprintln!(
                                "Discord Rich Presence: carátula lista pero la presencia está oculta (pausa)."
                            );
                        } else if let Err(error) =
                            set_discord_activity(&mut rpc_state, &latest_update, &image_url)
                        {
                            eprintln!("No se pudo mostrar la carátula local en Discord: {error}");
                        } else {
                            eprintln!(
                                "Discord Rich Presence: se envió la URL de la carátula local a la actividad."
                            );
                        }
                    }
                }
            } else {
                rpc_state.cover_attempted = !upload_failed;
                rpc_state.cover_retry_at =
                    upload_failed.then_some(std::time::Instant::now() + DISCORD_COVER_RETRY_DELAY);
            }
        });
    }
    Ok(())
}

pub fn normalize_discord_path_key(path: &str) -> String {
    let normalized = path.replace('/', "\\");
    let trimmed = normalized
        .strip_prefix(r"\\?\")
        .or_else(|| normalized.strip_prefix(r"//?/"))
        .unwrap_or(normalized.as_str());
    trimmed.to_ascii_lowercase()
}
