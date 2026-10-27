//! Metadatos en línea: MusicBrainz, huella acústica, carátulas y LRCLIB.

use super::*;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackMetadataMatch {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub date: String,
    pub track_number: Option<String>,
    pub release_mbid: Option<String>,
    pub recording_mbid: Option<String>,
    pub disc_number: Option<String>,
    pub genre: Option<String>,
    pub release_group: Option<String>,
    pub country: Option<String>,
    pub media_format: Option<String>,
    pub barcode: Option<String>,
    pub release_status: Option<String>,
    pub length: Option<String>,
    pub disambiguation: Option<String>,
}

pub fn metadata_match_from_recording(recording: &serde_json::Value) -> Option<TrackMetadataMatch> {
    let title = recording.get("title")?.as_str()?.trim();
    if title.is_empty() {
        return None;
    }
    let artist = recording
        .get("artist-credit")
        .and_then(serde_json::Value::as_array)
        .map(|credits| {
            credits
                .iter()
                .map(|credit| {
                    let name = credit
                        .get("name")
                        .and_then(serde_json::Value::as_str)
                        .or_else(|| {
                            credit
                                .pointer("/artist/name")
                                .and_then(serde_json::Value::as_str)
                        })
                        .unwrap_or_default();
                    let joinphrase = credit
                        .get("joinphrase")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default();
                    format!("{name}{joinphrase}")
                })
                .collect::<Vec<_>>()
                .join("")
                .trim()
                .to_owned()
        })
        .unwrap_or_default();

    let releases = recording
        .get("releases")
        .and_then(serde_json::Value::as_array);
    let release = releases.and_then(|items| items.first());
    let release_mbid = release
        .and_then(|item| item.get("id"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);
    let album = release
        .and_then(|item| item.get("title"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let date = release
        .and_then(|item| item.get("date"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let release_group = release
        .and_then(|item| item.pointer("/release-group/title"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);
    let country = release
        .and_then(|item| item.get("country"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);
    let barcode = release
        .and_then(|item| item.get("barcode"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);
    let release_status = release
        .and_then(|item| item.get("status"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);
    let recording_id = recording.get("id").and_then(serde_json::Value::as_str);
    let matched_track = releases
        .into_iter()
        .flatten()
        .flat_map(|item| {
            item.get("media")
                .and_then(serde_json::Value::as_array)
                .into_iter()
                .flatten()
        })
        .find_map(|medium| {
            let track = medium.get("tracks")?.as_array()?.iter().find(|track| {
                recording_id.is_some()
                    && track
                        .pointer("/recording/id")
                        .and_then(serde_json::Value::as_str)
                        == recording_id
            })?;
            Some((track, medium.get("position"), medium.get("format")))
        });
    let track_number = matched_track
        .and_then(|(track, _, _)| track.get("position"))
        .map(|position| match position {
            serde_json::Value::String(value) => value.clone(),
            serde_json::Value::Number(value) => value.to_string(),
            _ => String::new(),
        })
        .filter(|value| !value.is_empty());
    let disc_number = matched_track
        .and_then(|(_, medium_position, _)| medium_position)
        .map(|value| value.to_string())
        .filter(|value| !value.is_empty());
    let media_format = matched_track
        .and_then(|(_, _, format)| format)
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);
    let genre = recording
        .get("genres")
        .and_then(serde_json::Value::as_array)
        .map(|genres| {
            genres
                .iter()
                .filter_map(|item| item.get("name").and_then(serde_json::Value::as_str))
                .collect::<Vec<_>>()
                .join(", ")
        })
        .filter(|value| !value.is_empty())
        .or_else(|| {
            recording
                .get("tags")
                .and_then(serde_json::Value::as_array)
                .map(|tags| {
                    tags.iter()
                        .filter_map(|item| item.get("name").and_then(serde_json::Value::as_str))
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .filter(|value| !value.is_empty())
        });

    Some(TrackMetadataMatch {
        title: title.to_owned(),
        artist,
        album,
        date,
        track_number,
        release_mbid,
        recording_mbid: recording
            .get("id")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned),
        disc_number,
        genre,
        release_group,
        country,
        media_format,
        barcode,
        release_status,
        length: recording
            .get("length")
            .and_then(serde_json::Value::as_u64)
            .map(|milliseconds| {
                let seconds = milliseconds / 1000;
                format!("{}:{:02}", seconds / 60, seconds % 60)
            }),
        disambiguation: recording
            .get("disambiguation")
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned),
    })
}

pub static SHARED_HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

pub fn musicbrainz_client() -> Result<reqwest::Client, String> {
    if let Some(client) = SHARED_HTTP_CLIENT.get() {
        return Ok(client.clone());
    }
    let client = reqwest::Client::builder()
        .user_agent("Resonance/1.0.0 (https://github.com/local/resonance)")
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(std::time::Duration::from_secs(20))
        .pool_idle_timeout(std::time::Duration::from_secs(30))
        .pool_max_idle_per_host(2)
        .build()
        .map_err(|error| format!("No se pudo crear el cliente HTTP compartido: {error}"))?;
    let _ = SHARED_HTTP_CLIENT.set(client.clone());
    Ok(client)
}

pub async fn fetch_musicbrainz_recording(
    client: &reqwest::Client,
    recording_mbid: &str,
) -> Result<Option<TrackMetadataMatch>, String> {
    let response = client
        .get(format!(
            "https://musicbrainz.org/ws/2/recording/{recording_mbid}"
        ))
        .query(&[("inc", "artists+releases+genres"), ("fmt", "json")])
        .send()
        .await
        .map_err(|error| format!("No se pudo consultar MusicBrainz: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "MusicBrainz respondió con estado {}.",
            response.status()
        ));
    }
    let recording = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("MusicBrainz devolvió una respuesta inválida: {error}"))?;
    Ok(metadata_match_from_recording(&recording))
}

#[tauri::command]
pub async fn fetch_metadata_by_text(
    title: String,
    artist: String,
    album: Option<String>,
) -> Result<Vec<TrackMetadataMatch>, String> {
    let title = title.trim();
    let artist = artist.trim();
    if title.is_empty() || artist.is_empty() {
        return Err("La búsqueda por texto necesita título y artista.".to_string());
    }
    let client = musicbrainz_client()?;
    let mut query = format!("recording:\"{title}\" AND artist:\"{artist}\"");
    if let Some(album) = album
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        query.push_str(&format!(" AND release:\"{album}\""));
    }
    let response = client
        .get("https://musicbrainz.org/ws/2/recording/")
        .query(&[
            ("query", query.as_str()),
            ("fmt", "json"),
            ("limit", "15"),
            ("inc", "artists+releases+genres"),
        ])
        .send()
        .await
        .map_err(|error| format!("No se pudo consultar MusicBrainz: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "MusicBrainz respondió con estado {}.",
            response.status()
        ));
    }
    let body = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("MusicBrainz devolvió una respuesta inválida: {error}"))?;
    Ok(body
        .get("recordings")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(metadata_match_from_recording)
        .collect())
}

pub fn calculate_chromaprint(path: &Path) -> Result<(String, u32), String> {
    use rusty_chromaprint::{Configuration, FingerprintCompressor, Fingerprinter};
    use symphonia::core::{
        audio::SampleBuffer,
        codecs::{DecoderOptions, CODEC_TYPE_NULL},
        errors::Error as SymphoniaError,
        formats::FormatOptions,
        io::MediaSourceStream,
        meta::MetadataOptions,
        probe::Hint,
    };

    let file =
        fs::File::open(path).map_err(|error| format!("No se pudo abrir el audio: {error}"))?;
    let source = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(extension);
    }
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            source,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|error| format!("No se pudo identificar el formato de audio: {error}"))?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|track| track.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| "El archivo no contiene una pista de audio compatible.".to_string())?;
    let track_id = track.id;
    let codec_params = track.codec_params.clone();
    let sample_rate = codec_params
        .sample_rate
        .ok_or_else(|| "No se pudo determinar la frecuencia de muestreo.".to_string())?;
    let channels = codec_params
        .channels
        .or_else(|| {
            codec_params
                .channel_layout
                .map(|layout| layout.into_channels())
        })
        .ok_or_else(|| "No se pudo determinar la cantidad de canales.".to_string())?
        .count() as u32;
    let duration_seconds = codec_params
        .n_frames
        .map(|frames| frames / u64::from(sample_rate))
        .filter(|duration| *duration > 0)
        .unwrap_or(120) as u32;
    let mut decoder = symphonia::default::get_codecs()
        .make(&codec_params, &DecoderOptions::default())
        .map_err(|error| format!("No se pudo preparar el decodificador: {error}"))?;
    let config = Configuration::preset_test2();
    let mut printer = Fingerprinter::new(&config);
    printer
        .start(sample_rate, channels)
        .map_err(|error| format!("No se pudo iniciar el análisis de huella: {error}"))?;
    let mut sample_buffer: Option<SampleBuffer<i16>> = None;
    let sample_limit = u64::from(sample_rate)
        .saturating_mul(u64::from(channels))
        .saturating_mul(120) as usize;
    let mut samples_processed = 0usize;

    loop {
        if samples_processed >= sample_limit {
            break;
        }
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(error))
                if error.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break
            }
            Err(error) => return Err(format!("No se pudo leer el audio: {error}")),
        };
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(decoded) => {
                let spec = *decoded.spec();
                if sample_buffer.is_none() {
                    sample_buffer = Some(SampleBuffer::<i16>::new(decoded.capacity() as u64, spec));
                }
                let buffer = sample_buffer
                    .as_mut()
                    .ok_or_else(|| "No se pudo reservar memoria para el audio.".to_string())?;
                buffer.copy_interleaved_ref(decoded);
                let remaining = sample_limit - samples_processed;
                let samples = &buffer.samples()[..buffer.samples().len().min(remaining)];
                printer.consume(samples);
                samples_processed += samples.len();
            }
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(error) => return Err(format!("No se pudo decodificar el audio: {error}")),
        }
    }
    if samples_processed == 0 {
        return Err("No se pudieron decodificar muestras de audio.".to_string());
    }
    printer.finish();
    let compressed = FingerprintCompressor::from(&config).compress(printer.fingerprint());
    use base64::Engine;
    let fingerprint = base64::engine::general_purpose::STANDARD_NO_PAD.encode(compressed);
    Ok((fingerprint, duration_seconds))
}

#[tauri::command]
pub async fn fetch_metadata_by_fingerprint(
    app: AppHandle,
    file_path: String,
) -> Result<Vec<TrackMetadataMatch>, String> {
    let file_path = ensure_path_in_library(&app, &file_path)?;
    let (fingerprint, duration) =
        tauri::async_runtime::spawn_blocking(move || calculate_chromaprint(&file_path))
            .await
            .map_err(|error| format!("No se pudo completar el análisis de huella: {error}"))??;
    let client = musicbrainz_client()?;
    let response = client
        .get("https://api.acoustid.org/v2/lookup")
        .query(&[
            ("client", "xPDmdCIWW9"),
            ("meta", "recordings+releasegroups"),
            ("duration", duration.to_string().as_str()),
            ("fingerprint", fingerprint.as_str()),
        ])
        .send()
        .await
        .map_err(|error| format!("No se pudo consultar AcoustID: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "AcoustID respondió con estado {}.",
            response.status()
        ));
    }
    let body = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("AcoustID devolvió una respuesta inválida: {error}"))?;
    if body.get("status").and_then(serde_json::Value::as_str) != Some("ok") {
        return Err("AcoustID no pudo procesar la huella acústica.".to_string());
    }
    let mut recording_ids = Vec::new();
    for result in body
        .get("results")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
    {
        for recording in result
            .get("recordings")
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
        {
            if let Some(id) = recording.get("id").and_then(serde_json::Value::as_str) {
                if !recording_ids.iter().any(|seen| seen == id) {
                    recording_ids.push(id.to_owned());
                }
            }
        }
    }

    let mut matches = Vec::new();
    for (index, recording_id) in recording_ids.iter().take(5).enumerate() {
        if index > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
        }
        if let Some(metadata) = fetch_musicbrainz_recording(&client, recording_id).await? {
            matches.push(metadata);
        }
    }
    Ok(matches)
}

#[tauri::command]
pub async fn fetch_cover_art(release_mbid: String) -> Result<String, String> {
    if release_mbid.len() != 36
        || !release_mbid
            .chars()
            .all(|character| character.is_ascii_hexdigit() || character == '-')
    {
        return Err("El identificador del lanzamiento no es válido.".to_string());
    }
    let client = musicbrainz_client()?;
    let response = client
        .get(format!(
            "https://coverartarchive.org/release/{release_mbid}/front"
        ))
        .send()
        .await
        .map_err(|error| format!("No se pudo descargar la portada: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Cover Art Archive respondió con estado {}.",
            response.status()
        ));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !content_type.starts_with("image/jpeg") && !content_type.starts_with("image/png") {
        return Err("Cover Art Archive no devolvió una imagen JPG o PNG.".to_string());
    }
    let image = response
        .bytes()
        .await
        .map_err(|error| format!("No se pudo leer la portada: {error}"))?;
    if image.len() > 16 * 1024 * 1024 {
        return Err("La portada supera el tamaño máximo de 16 MB.".to_string());
    }
    use base64::Engine;
    let mime = if content_type.starts_with("image/png") {
        "image/png"
    } else {
        "image/jpeg"
    };
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(image)
    ))
}

#[derive(Deserialize)]
pub struct LrclibSearchRequest {
    #[serde(rename = "track_name")]
    pub track_name: String,
    #[serde(rename = "artist_name")]
    pub artist_name: String,
}

#[tauri::command]
pub async fn search_lrclib_lyrics(request: LrclibSearchRequest) -> Result<serde_json::Value, String> {
    let track_name = request.track_name.trim().to_string();
    let artist_name = request.artist_name.trim().to_string();
    if track_name.is_empty() || artist_name.is_empty() {
        return Err("Indica título y artista para buscar la letra.".to_string());
    }
    let client = musicbrainz_client()?;
    let response = client
        .get("https://lrclib.net/api/search")
        .query(&[("track_name", track_name), ("artist_name", artist_name)])
        .send()
        .await
        .map_err(|error| format!("No se pudo contactar LRCLIB: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "LRCLIB respondió con estado {}.",
            response.status()
        ));
    }
    response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Respuesta inválida de LRCLIB: {error}"))
}
