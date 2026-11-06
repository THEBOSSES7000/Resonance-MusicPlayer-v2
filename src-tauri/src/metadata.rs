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

fn read_id3_synchronized_lyrics(path: &Path) -> Result<Option<String>, String> {
    use lofty::id3::v2::{FrameFlags, SyncTextContentType, SynchronizedTextFrame, TimestampFormat};
    use std::io::{ErrorKind, Read, Seek, SeekFrom};

    if !path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("mp3"))
    {
        return Ok(None);
    }

    let mut file = fs::File::open(path)
        .map_err(|error| format!("No se pudieron leer letras sincronizadas: {error}"))?;
    let mut header = [0; 10];
    match file.read_exact(&mut header) {
        Ok(()) => {}
        Err(error) if error.kind() == ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(format!("No se pudieron leer letras sincronizadas: {error}")),
    }
    if &header[..3] != b"ID3" || !(2..=4).contains(&header[3]) {
        return Ok(None);
    }

    let version = header[3];
    if version == 2 && header[5] & 0x40 != 0 {
        return Ok(None);
    }
    if header[6..10].iter().any(|byte| byte & 0x80 != 0) {
        return Ok(None);
    }
    let tag_size = header[6..10]
        .iter()
        .fold(0_u64, |size, byte| (size << 7) | u64::from(byte & 0x7f));
    let tag_end = 10_u64.saturating_add(tag_size);
    let file_size = file
        .metadata()
        .map_err(|error| format!("No se pudieron leer letras sincronizadas: {error}"))?
        .len();
    if tag_end > file_size {
        return Ok(None);
    }

    let mut offset = 10_u64;
    if version >= 3 && header[5] & 0x40 != 0 {
        let mut size_bytes = [0; 4];
        file.read_exact(&mut size_bytes)
            .map_err(|error| format!("Cabecera ID3 extendida no válida: {error}"))?;
        let extended_size = if version == 4 {
            size_bytes
                .iter()
                .fold(0_u64, |size, byte| (size << 7) | u64::from(byte & 0x7f))
        } else {
            u64::from(u32::from_be_bytes(size_bytes)).saturating_add(4)
        };
        offset = offset.saturating_add(extended_size);
    }

    let tag_unsynchronised = header[5] & 0x80 != 0;
    let mut frames = Vec::new();
    let frame_header_size = if version == 2 { 6_u64 } else { 10_u64 };
    while offset.saturating_add(frame_header_size) <= tag_end {
        let (frame_id, frame_size, frame_flags, supported_format) = if version == 2 {
            let mut frame_header = [0; 6];
            file.seek(SeekFrom::Start(offset))
                .and_then(|_| file.read_exact(&mut frame_header))
                .map_err(|error| format!("Cabecera ID3 no válida: {error}"))?;
            if frame_header[..3].iter().all(|byte| *byte == 0) {
                break;
            }
            let size =
                u32::from_be_bytes([0, frame_header[3], frame_header[4], frame_header[5]]) as u64;
            (
                frame_header[..3].to_vec(),
                size,
                FrameFlags::default(),
                true,
            )
        } else {
            let mut frame_header = [0; 10];
            file.seek(SeekFrom::Start(offset))
                .and_then(|_| file.read_exact(&mut frame_header))
                .map_err(|error| format!("Cabecera ID3 no válida: {error}"))?;
            if frame_header[..4].iter().all(|byte| *byte == 0) {
                break;
            }
            let size = if version == 4 {
                frame_header[4..8]
                    .iter()
                    .fold(0_u64, |size, byte| (size << 7) | u64::from(byte & 0x7f))
            } else {
                u64::from(u32::from_be_bytes(frame_header[4..8].try_into().unwrap()))
            };
            let format_flags = frame_header[9];
            let supported_format = if version == 4 {
                format_flags & (0x40 | 0x08 | 0x04 | 0x01) == 0
            } else {
                format_flags & (0x80 | 0x40 | 0x20) == 0
            };
            let flags = FrameFlags {
                unsynchronisation: version == 4 && format_flags & 0x02 != 0,
                ..FrameFlags::default()
            };
            (frame_header[..4].to_vec(), size, flags, supported_format)
        };

        let data_offset = offset.saturating_add(frame_header_size);
        if frame_size == 0 || data_offset.saturating_add(frame_size) > tag_end {
            break;
        }

        if supported_format && (frame_id.as_slice() == b"SYLT" || frame_id.as_slice() == b"SLT") {
            const MAX_SYNC_FRAME_SIZE: u64 = 4 * 1024 * 1024;
            if frame_size <= MAX_SYNC_FRAME_SIZE {
                let mut data = vec![0; frame_size as usize];
                file.seek(SeekFrom::Start(data_offset))
                    .and_then(|_| file.read_exact(&mut data))
                    .map_err(|error| format!("No se pudo leer un frame SYLT: {error}"))?;
                if tag_unsynchronised || frame_flags.unsynchronisation {
                    let mut decoded = Vec::with_capacity(data.len());
                    let mut index = 0;
                    while index < data.len() {
                        decoded.push(data[index]);
                        if data[index] == 0xff
                            && data.get(index + 1) == Some(&0)
                            && data
                                .get(index + 2)
                                .map_or(true, |next| *next == 0 || *next >= 0xe0)
                        {
                            index += 1;
                        }
                        index += 1;
                    }
                    data = decoded;
                }
                if let Ok(frame) = SynchronizedTextFrame::parse(&data, frame_flags) {
                    if matches!(
                        frame.content_type,
                        SyncTextContentType::Lyrics | SyncTextContentType::TextTranscription
                    ) && !frame.content.is_empty()
                    {
                        frames.push(frame);
                    }
                }
            }
        }
        offset = data_offset.saturating_add(frame_size);
    }

    if frames.is_empty() {
        return Ok(None);
    }

    let separate_voices = frames.len() > 1;
    let mut lines = Vec::new();
    for (frame_index, frame) in frames.iter().enumerate() {
        let word_synchronised = frame
            .content
            .iter()
            .filter(|(_, text)| !text.trim().is_empty())
            .all(|(_, text)| !text.chars().any(char::is_whitespace));
        let voice = if separate_voices {
            format!("[voice:{}]", frame_index + 1)
        } else {
            String::new()
        };
        let mut word_line = String::new();
        let word_count = frame
            .content
            .iter()
            .filter(|(_, text)| !text.trim().is_empty())
            .count();
        let mut words_written = 0;
        for (timestamp, text) in &frame.content {
            let text = text.trim();
            if text.is_empty() {
                continue;
            }
            let milliseconds = match frame.timestamp_format {
                TimestampFormat::MS => u64::from(*timestamp),
                TimestampFormat::MPEG => u64::from(*timestamp) * 1000 / 75,
            };
            let minutes = milliseconds / 60_000;
            let seconds = (milliseconds / 1000) % 60;
            let fraction = milliseconds % 1000;
            if word_synchronised {
                word_line.push_str(&format!("<{minutes:02}:{seconds:02}.{fraction:03}>{text}"));
                words_written += 1;
                if words_written < word_count {
                    word_line.push(' ');
                }
            } else {
                lines.push(format!(
                    "[{minutes:02}:{seconds:02}.{fraction:03}]{voice}{text}"
                ));
            }
        }
        if !word_line.is_empty() {
            lines.push(format!("{voice}{word_line}"));
        }
    }
    Ok(Some(lines.join("\n")))
}

#[cfg(test)]
mod synchronized_lyrics_tests {
    use super::read_id3_synchronized_lyrics;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEST_FILE: AtomicU64 = AtomicU64::new(0);

    fn append_sync_frame(tag: &mut Vec<u8>, description: &str, text: &str, milliseconds: u32) {
        let mut frame = vec![3, b'e', b'n', b'g', 2, 1];
        frame.extend_from_slice(description.as_bytes());
        frame.push(0);
        frame.extend_from_slice(text.as_bytes());
        frame.push(0);
        frame.extend_from_slice(&milliseconds.to_be_bytes());

        tag.extend_from_slice(b"SYLT");
        tag.extend_from_slice(&(frame.len() as u32).to_be_bytes());
        tag.extend_from_slice(&[0, 0]);
        tag.extend_from_slice(&frame);
    }

    #[test]
    fn extracts_word_timing_and_separate_voices_from_sylt_frames() {
        let mut tag = b"ID3\x04\x00\x00\x00\x00\x00\x00".to_vec();
        let frame_offset = tag.len();
        append_sync_frame(&mut tag, "voice1", "hello", 500);
        append_sync_frame(&mut tag, "voice2", "world", 500);

        let tag_size = (tag.len() - frame_offset) as u32;
        tag[6] = ((tag_size >> 21) & 0x7f) as u8;
        tag[7] = ((tag_size >> 14) & 0x7f) as u8;
        tag[8] = ((tag_size >> 7) & 0x7f) as u8;
        tag[9] = (tag_size & 0x7f) as u8;

        let sequence = NEXT_TEST_FILE.fetch_add(1, Ordering::Relaxed);
        let path: PathBuf = std::env::temp_dir().join(format!(
            "resonance-sylt-test-{}-{sequence}.mp3",
            std::process::id()
        ));
        fs::write(&path, tag).unwrap();
        let result = read_id3_synchronized_lyrics(&path);
        let _ = fs::remove_file(&path);
        let lyrics = result.unwrap().unwrap();

        assert!(lyrics.contains("[voice:1]<00:00.500>hello"));
        assert!(lyrics.contains("[voice:2]<00:00.500>world"));
    }
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
        match read_id3_synchronized_lyrics(&file_path) {
            Ok(Some(lyrics)) => Some(lyrics),
            Ok(None) => read_tag(&ItemKey::Lyrics),
            Err(error) => {
                eprintln!("{error}");
                read_tag(&ItemKey::Lyrics)
            }
        }
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

/// Lee los metadatos de varios archivos en paralelo. Se ejecuta fuera del hilo principal para que la
/// ventana, la bandeja y los atajos no se congelen mientras se escanean miles de archivos.
#[tauri::command]
pub async fn scan_files_metadata(
    app: AppHandle,
    paths: Vec<String>,
    include_lyrics: Option<bool>,
) -> Result<Vec<ScannedTrackResult>, String> {
    crate::db::run_blocking(move || scan_files_metadata_blocking(app, paths, include_lyrics)).await
}

fn scan_files_metadata_blocking(
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
