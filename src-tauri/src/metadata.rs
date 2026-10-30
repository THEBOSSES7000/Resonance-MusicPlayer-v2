//! Metadatos locales: lectura, escaneo de archivos y edición de etiquetas.

use super::*;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackTagUpdate {
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub year: Option<String>,
    pub track_number: Option<String>,
    pub disc_number: Option<String>,
    pub genre: Option<String>,
    pub lyrics: Option<String>,
    pub cover_base64: Option<String>,
    pub cover_mime: Option<String>,
    pub remove_cover: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedTrackMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub track_number: Option<u32>,
    pub duration: Option<f64>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u8>,
    pub bit_depth: Option<u8>,
    pub codec: Option<String>,
    pub genre: Option<String>,
    pub replay_gain_db: Option<f64>,
    /// Absolute path inside library-cache/covers (never base64).
    pub cover_path: Option<String>,
    /// Lyrics only when include_lyrics is true (on-demand).
    pub lyrics: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedTrackResult {
    pub path: String,
    pub metadata: Option<ScannedTrackMetadata>,
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackTextMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
}

#[tauri::command]
pub fn read_track_text_metadata(app: AppHandle, path: String) -> Result<TrackTextMetadata, String> {
    use lofty::prelude::*;
    use lofty::tag::ItemKey;

    let file_path = ensure_path_in_library(&app, &path)?;
    let tagged_file = lofty::read_from_path(&file_path)
        .map_err(|error| format!("No se pudieron leer los metadatos de texto: {error}"))?;

    let read_tag = |key: &ItemKey| {
        tagged_file
            .tags()
            .iter()
            .find_map(|tag| tag.get_string(key))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };

    Ok(TrackTextMetadata {
        title: read_tag(&ItemKey::TrackTitle),
        artist: read_tag(&ItemKey::TrackArtist),
        album: read_tag(&ItemKey::AlbumTitle),
    })
}

pub fn prepare_covers_cache_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let cache_directory = library_cache_directory(app)?;
    let covers_directory = cache_directory.join("covers");
    if !covers_directory.is_dir() {
        fs::create_dir_all(&covers_directory).map_err(|error| {
            format!(
                "No se pudo crear la carpeta de carátulas {}: {error}",
                covers_directory.display()
            )
        })?;
    }
    let _ = app
        .asset_protocol_scope()
        .allow_directory(&covers_directory, true);
    Ok(covers_directory)
}

pub fn scan_path_metadata_with_context(
    raw_path: &str,
    include_lyrics: bool,
    canonical_roots: &[PathBuf],
    covers_directory: Option<&Path>,
) -> Result<ScannedTrackMetadata, String> {
    use lofty::prelude::*;
    use lofty::tag::ItemKey;

    let file_path = ensure_path_in_roots(raw_path, canonical_roots)?;
    let tagged_file = lofty::read_from_path(&file_path)
        .map_err(|error| format!("No se pudieron leer los metadatos: {error}"))?;

    let read_tag = |key: &ItemKey| {
        tagged_file
            .tags()
            .iter()
            .find_map(|tag| tag.get_string(key))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };

    let properties = tagged_file.properties();
    let duration = {
        let secs = properties.duration().as_secs_f64();
        if secs.is_finite() && secs > 0.0 {
            Some(secs)
        } else {
            None
        }
    };

    let track_number = tagged_file
        .tags()
        .iter()
        .find_map(|tag| tag.track())
        .filter(|&n| n > 0);

    let replay_gain_db = tagged_file.tags().iter().find_map(|tag| {
        tag.get_string(&ItemKey::ReplayGainTrackGain)
            .and_then(|value| {
                value
                    .split_whitespace()
                    .next()?
                    .trim_end_matches("dB")
                    .trim_end_matches("db")
                    .parse::<f64>()
                    .ok()
            })
            .filter(|v| v.is_finite())
    });

    let cover_path = match (
        covers_directory,
        tagged_file
            .tags()
            .iter()
            .flat_map(|tag| tag.pictures())
            .next(),
    ) {
        (Some(covers_dir), Some(picture))
            if !picture.data().is_empty() && picture.data().len() <= 8 * 1024 * 1024 =>
        {
            save_scanned_cover_to_dir(covers_dir, raw_path, picture.data()).ok()
        }
        _ => None,
    };

    let lyrics = if include_lyrics {
        read_tag(&ItemKey::Lyrics)
    } else {
        None
    };

    Ok(ScannedTrackMetadata {
        title: read_tag(&ItemKey::TrackTitle),
        artist: read_tag(&ItemKey::TrackArtist).or_else(|| read_tag(&ItemKey::AlbumArtist)),
        album: read_tag(&ItemKey::AlbumTitle),
        track_number,
        duration,
        sample_rate: properties.sample_rate(),
        channels: properties.channels().map(|c| c as u8),
        bit_depth: properties.bit_depth().map(|b| b as u8),
        codec: Some(format!("{:?}", tagged_file.file_type())),
        genre: read_tag(&ItemKey::Genre),
        replay_gain_db,
        cover_path,
        lyrics,
    })
}

pub fn scan_path_metadata_inner(
    app: &AppHandle,
    raw_path: &str,
    include_lyrics: bool,
) -> Result<ScannedTrackMetadata, String> {
    let canonical_roots = canonical_music_roots(app)?;
    let covers_directory = prepare_covers_cache_directory(app).ok();
    scan_path_metadata_with_context(
        raw_path,
        include_lyrics,
        &canonical_roots,
        covers_directory.as_deref(),
    )
}

/// Wrapper usado por save_cached_music_library / migración de covers.
pub fn save_scanned_cover_to_cache(
    app: &AppHandle,
    track_path: &str,
    bytes: &[u8],
) -> Result<String, String> {
    let covers_directory = prepare_covers_cache_directory(app)?;
    save_scanned_cover_to_dir(&covers_directory, track_path, bytes)
}

/// Contador para nombres de archivo temporal únicos (las carátulas se guardan en paralelo).
static COVER_TMP_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

pub fn save_scanned_cover_to_dir(
    covers_directory: &Path,
    track_path: &str,
    bytes: &[u8],
) -> Result<String, String> {
    // Deduplicar por contenido de la imagen (no por ruta de canción):
    // un álbum de 12 pistas con la misma carátula → un solo archivo en disco.
    let content_hash = Sha256::digest(bytes);
    let file_name = format!("{:x}.jpg", content_hash);
    let cover_path = covers_directory.join(&file_name);

    // Atajo rápido: si la miniatura ya existe en caché, no decodificar ni tocar el disco.
    if cover_path.is_file() {
        let _ = track_path; // se mantiene el parámetro por compatibilidad de firmas
        return Ok(cover_path.to_string_lossy().into_owned());
    }

    let written = (|| -> Result<(), String> {
        let image =
            image::load_from_memory(bytes).map_err(|error| format!("Carátula inválida: {error}"))?;
        // FilterType::Triangle reduce CPU/RAM en escaneos masivos frente a Lanczos3
        let resized = if image.width() > 512 || image.height() > 512 {
            image.resize(512, 512, image::imageops::FilterType::Triangle)
        } else {
            image
        };
        let rgb = resized.to_rgb8();
        let mut output = Cursor::new(Vec::with_capacity(48 * 1024));
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output, 82)
            .encode(
                rgb.as_raw(),
                rgb.width(),
                rgb.height(),
                image::ExtendedColorType::Rgb8,
            )
            .map_err(|error| format!("No se pudo comprimir la carátula: {error}"))?;
        // Escritura atómica: temporal ÚNICO por llamada + rename.
        // Varias pistas del mismo álbum se procesan en paralelo con la misma carátula;
        // un temporal compartido provocaba escrituras cruzadas y archivos truncados.
        let tmp_id = COVER_TMP_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let tmp_path = covers_directory.join(format!("{:x}.{tmp_id}.jpg.tmp", content_hash));
        fs::write(&tmp_path, output.into_inner()).map_err(|e| e.to_string())?;
        if let Err(rename_error) = fs::rename(&tmp_path, &cover_path) {
            let _ = fs::remove_file(&tmp_path);
            // Otro hilo pudo terminar antes con la misma imagen: en ese caso no es un error.
            if !cover_path.is_file() {
                return Err(rename_error.to_string());
            }
        }
        Ok(())
    })();

    if let Err(error) = written {
        let ext = if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
            "png"
        } else {
            "img"
        };
        let fallback = covers_directory.join(format!("{:x}.{ext}", content_hash));
        if !fallback.is_file() {
            let fallback_id = COVER_TMP_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let tmp = covers_directory.join(format!("{:x}.{ext}.{fallback_id}.tmp", content_hash));
            fs::write(&tmp, bytes).map_err(|e| format!("{error}; fallback: {e}"))?;
            if let Err(rename_error) = fs::rename(&tmp, &fallback) {
                let _ = fs::remove_file(&tmp);
                if !fallback.is_file() {
                    return Err(format!("{error}; rename: {rename_error}"));
                }
            }
        }
        return Ok(fallback.to_string_lossy().into_owned());
    }

    Ok(cover_path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn scan_file_metadata(
    app: AppHandle,
    path: String,
    include_lyrics: Option<bool>,
) -> Result<ScannedTrackMetadata, String> {
    scan_path_metadata_inner(&app, &path, include_lyrics.unwrap_or(false))
}

#[tauri::command]
pub fn scan_files_metadata(
    app: AppHandle,
    paths: Vec<String>,
    include_lyrics: Option<bool>,
) -> Result<Vec<ScannedTrackResult>, String> {
    use rayon::prelude::*;

    let include_lyrics = include_lyrics.unwrap_or(false);
    let canonical_roots = canonical_music_roots(&app)?;
    let covers_directory = prepare_covers_cache_directory(&app).ok();
    let covers_dir_ref = covers_directory.as_deref();

    Ok(paths
        .par_iter()
        .map(|path| {
            match scan_path_metadata_with_context(
                path,
                include_lyrics,
                &canonical_roots,
                covers_dir_ref,
            ) {
                Ok(metadata) => ScannedTrackResult {
                    path: path.clone(),
                    metadata: Some(metadata),
                    error: None,
                },
                Err(error) => ScannedTrackResult {
                    path: path.clone(),
                    metadata: None,
                    error: Some(error),
                },
            }
        })
        .collect())
}

pub fn parse_cover_bytes(
    update: &TrackTagUpdate,
) -> Result<Option<(Vec<u8>, lofty::picture::MimeType)>, String> {
    let Some(base64_data) = update
        .cover_base64
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    else {
        return Ok(None);
    };
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, base64_data)
        .map_err(|_| "La imagen de portada no es válida (base64).".to_string())?;
    if bytes.len() > 16 * 1024 * 1024 {
        return Err("La imagen supera los 16 MB permitidos.".to_string());
    }
    let mime = update
        .cover_mime
        .as_deref()
        .unwrap_or("")
        .to_ascii_lowercase();
    if mime.contains("png") || bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        if !bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
            return Err("El contenido no coincide con una imagen PNG.".to_string());
        }
        return Ok(Some((bytes, lofty::picture::MimeType::Png)));
    }
    if mime.contains("jpeg") || mime.contains("jpg") || bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        if !bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
            return Err("El contenido no coincide con una imagen JPG.".to_string());
        }
        return Ok(Some((bytes, lofty::picture::MimeType::Jpeg)));
    }
    Err("Formato de imagen no válido. Usa JPG o PNG.".to_string())
}

#[tauri::command]
pub fn update_track_tags(app: AppHandle, update: TrackTagUpdate) -> Result<(), String> {
    use lofty::prelude::*;
    use lofty::tag::ItemKey;

    let file_path = ensure_path_in_library(&app, &update.path)?;
    let cover = parse_cover_bytes(&update)?;
    let mut tagged_file = lofty::read_from_path(&file_path)
        .map_err(|error| format!("No se pudo leer los tags del archivo: {error}"))?;
    let tag = tagged_file
        .primary_tag_mut()
        .ok_or_else(|| "El formato no admite escritura de etiquetas.".to_string())?;

    if let Some(title) = update.title.as_deref() {
        let value = title.trim();
        if value.is_empty() {
            tag.remove_key(&ItemKey::TrackTitle);
        } else {
            tag.set_title(value.to_string());
        }
    }
    if let Some(artist) = update.artist.as_deref() {
        let value = artist.trim();
        if value.is_empty() {
            tag.remove_key(&ItemKey::TrackArtist);
        } else {
            tag.set_artist(value.to_string());
        }
    }
    if let Some(album) = update.album.as_deref() {
        let value = album.trim();
        if value.is_empty() {
            tag.remove_key(&ItemKey::AlbumTitle);
        } else {
            tag.set_album(value.to_string());
        }
    }
    if let Some(year) = update.year.as_deref() {
        let value = year.trim();
        if value.is_empty() {
            tag.remove_key(&ItemKey::RecordingDate);
        } else {
            tag.insert_text(ItemKey::RecordingDate, value.to_string());
        }
    }
    if let Some(track_number) = update.track_number.as_deref() {
        let value = track_number.trim();
        if value.is_empty() {
            tag.remove_key(&ItemKey::TrackNumber);
        } else {
            tag.insert_text(ItemKey::TrackNumber, value.to_string());
        }
    }
    if let Some(disc_number) = update.disc_number.as_deref() {
        let value = disc_number.trim();
        if value.is_empty() {
            tag.remove_key(&ItemKey::DiscNumber);
        } else {
            tag.insert_text(ItemKey::DiscNumber, value.to_string());
        }
    }
    if let Some(genre) = update.genre.as_deref() {
        let value = genre.trim();
        if value.is_empty() {
            tag.remove_key(&ItemKey::Genre);
        } else {
            tag.insert_text(ItemKey::Genre, value.to_string());
        }
    }
    if let Some(lyrics) = update.lyrics.as_deref() {
        if lyrics.trim().is_empty() {
            tag.remove_key(&ItemKey::Lyrics);
        } else {
            tag.insert_text(ItemKey::Lyrics, lyrics.to_string());
        }
    }
    if update.remove_cover {
        tag.remove_picture_type(lofty::picture::PictureType::CoverFront);
        tag.remove_picture_type(lofty::picture::PictureType::Other);
    } else if let Some((bytes, mime_type)) = cover {
        tag.remove_picture_type(lofty::picture::PictureType::CoverFront);
        tag.push_picture(lofty::picture::Picture::new_unchecked(
            lofty::picture::PictureType::CoverFront,
            Some(mime_type),
            None,
            bytes,
        ));
    }

    tag.save_to_path(&file_path, lofty::config::WriteOptions::default())
        .map_err(|error| format!("No se pudo escribir los tags en disco: {error}"))?;
    Ok(())
}
