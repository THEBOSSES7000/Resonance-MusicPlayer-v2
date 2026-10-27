//! Escáner de ReplayGain (EBU R128) en segundo plano.

use super::*;

pub static REPLAY_GAIN_SCAN_ACTIVE: AtomicBool = AtomicBool::new(false);
pub static CANCEL_REPLAY_GAIN_SCAN: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayGainBatchProgress {
    pub current: usize,
    pub total: usize,
    pub path: String,
    pub track_name: String,
    pub gain_db: Option<f64>,
    pub error: Option<String>,
    pub skipped: bool,
    pub finished: bool,
    pub cancelled: bool,
}

pub enum ReplayGainMeasurement {
    Complete(f64, f64),
    Cancelled,
}

pub enum ReplayGainTrackResult {
    Calculated { gain_db: f64 },
    Existing(Option<f64>),
    Cancelled,
}

pub fn emit_replay_gain_progress(app: &AppHandle, progress: ReplayGainBatchProgress) {
    if let Err(error) = app.emit("replaygain-batch-progress", progress) {
        eprintln!("No se pudo informar el progreso de ReplayGain: {error}");
    }
}

pub fn calculate_replay_gain(path: &Path) -> Result<ReplayGainMeasurement, String> {
    use ebur128::{EbuR128, Mode};
    use symphonia::{
        core::{
            audio::SampleBuffer, codecs::DecoderOptions, errors::Error as SymphoniaError,
            formats::FormatOptions, io::MediaSourceStream, meta::MetadataOptions, probe::Hint,
        },
        default::{get_codecs, get_probe},
    };

    let file =
        fs::File::open(path).map_err(|error| format!("No se pudo abrir el audio: {error}"))?;
    let source = MediaSourceStream::new(Box::new(file), Default::default());
    let probed = get_probe()
        .format(
            &Hint::new(),
            source,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|error| format!("No se pudo identificar el formato de audio: {error}"))?;
    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| "El archivo no contiene una pista de audio.".to_string())?;
    let track_id = track.id;
    let codec_params = track.codec_params.clone();
    let mut decoder = get_codecs()
        .make(&codec_params, &DecoderOptions::default())
        .map_err(|error| format!("No se pudo preparar el decodificador: {error}"))?;
    let mut meter: Option<EbuR128> = None;
    let mut analysis_spec: Option<(u32, u32)> = None;
    let mut peak = 0.0_f32;

    loop {
        if CANCEL_REPLAY_GAIN_SCAN.load(Ordering::Acquire) {
            return Ok(ReplayGainMeasurement::Cancelled);
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
        let decoded = decoder
            .decode(&packet)
            .map_err(|error| format!("No se pudo decodificar el audio: {error}"))?;
        let spec = *decoded.spec();
        let channels = spec.channels.count() as u32;
        if channels == 0 || spec.rate == 0 {
            return Err(
                "El audio tiene una frecuencia o cantidad de canales inválida.".to_string(),
            );
        }
        if analysis_spec.is_some_and(|previous| previous != (spec.rate, channels)) {
            return Err("La configuración de canales cambia dentro del archivo.".to_string());
        }
        if meter.is_none() {
            meter = Some(
                EbuR128::new(channels, spec.rate, Mode::I)
                    .map_err(|error| format!("No se pudo iniciar el medidor EBU R128: {error}"))?,
            );
            analysis_spec = Some((spec.rate, channels));
        }
        let meter = meter
            .as_mut()
            .ok_or_else(|| "No se pudo inicializar el medidor EBU R128.".to_string())?;
        let mut samples = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
        samples.copy_interleaved_ref(decoded);
        let interleaved = samples.samples();
        for sample in interleaved {
            peak = peak.max(sample.abs());
        }
        meter
            .add_frames_f32(interleaved)
            .map_err(|error| format!("No se pudo medir la sonoridad EBU R128: {error}"))?;
    }

    let integrated_lufs = meter
        .ok_or_else(|| "No se encontraron muestras de audio decodificables.".to_string())?
        .loudness_global()
        .map_err(|error| format!("No se pudo calcular la sonoridad integrada: {error}"))?;
    if !integrated_lufs.is_finite() || !peak.is_finite() {
        return Err("El análisis produjo valores de sonoridad no válidos.".to_string());
    }
    Ok(ReplayGainMeasurement::Complete(
        -18.0 - integrated_lufs,
        peak as f64,
    ))
}

pub fn run_replay_gain_scan(app: AppHandle, paths: Vec<String>) {
    use lofty::{
        prelude::*,
        tag::{ItemKey, Tag},
    };

    let total = paths.len();
    for (index, raw_path) in paths.iter().enumerate() {
        if CANCEL_REPLAY_GAIN_SCAN.load(Ordering::Relaxed) {
            emit_replay_gain_progress(
                &app,
                ReplayGainBatchProgress {
                    current: index,
                    total,
                    path: String::new(),
                    track_name: String::new(),
                    gain_db: None,
                    error: None,
                    skipped: false,
                    finished: true,
                    cancelled: true,
                },
            );
            REPLAY_GAIN_SCAN_ACTIVE.store(false, Ordering::Release);
            return;
        }

        let display_name = Path::new(raw_path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(raw_path)
            .to_string();
        let result = (|| -> Result<ReplayGainTrackResult, String> {
            let path = ensure_path_in_library(&app, raw_path)?;
            let tagged_file = lofty::read_from_path(&path)
                .map_err(|error| format!("No se pudieron leer los tags: {error}"))?;
            if let Some(existing_gain) = tagged_file.tags().iter().find_map(|tag| {
                tag.get_string(&ItemKey::ReplayGainTrackGain)
                    .and_then(|value| value.split_whitespace().next()?.parse::<f64>().ok())
                    .filter(|value| value.is_finite())
            }) {
                return Ok(ReplayGainTrackResult::Existing(Some(existing_gain)));
            }
            if tagged_file.tags().iter().any(|tag| {
                tag.get_string(&ItemKey::ReplayGainTrackGain)
                    .is_some_and(|value| !value.trim().is_empty())
            }) {
                return Ok(ReplayGainTrackResult::Existing(None));
            }
            let (gain_db, peak) = match calculate_replay_gain(&path)? {
                ReplayGainMeasurement::Complete(gain_db, peak) => (gain_db, peak),
                ReplayGainMeasurement::Cancelled => return Ok(ReplayGainTrackResult::Cancelled),
            };
            if CANCEL_REPLAY_GAIN_SCAN.load(Ordering::Acquire) {
                return Ok(ReplayGainTrackResult::Cancelled);
            }
            let mut tagged_file = lofty::read_from_path(&path)
                .map_err(|error| format!("No se pudieron volver a leer los tags: {error}"))?;
            if let Some(existing_gain) = tagged_file.tags().iter().find_map(|tag| {
                tag.get_string(&ItemKey::ReplayGainTrackGain)
                    .and_then(|value| value.split_whitespace().next()?.parse::<f64>().ok())
                    .filter(|value| value.is_finite())
            }) {
                return Ok(ReplayGainTrackResult::Existing(Some(existing_gain)));
            }
            if tagged_file.tags().iter().any(|tag| {
                tag.get_string(&ItemKey::ReplayGainTrackGain)
                    .is_some_and(|value| !value.trim().is_empty())
            }) {
                return Ok(ReplayGainTrackResult::Existing(None));
            }
            if tagged_file.primary_tag().is_none() {
                let tag_type = tagged_file.primary_tag_type();
                tagged_file.insert_tag(Tag::new(tag_type));
            }
            let tag = tagged_file
                .primary_tag_mut()
                .ok_or_else(|| "El formato no admite escritura de etiquetas.".to_string())?;
            tag.insert_text(ItemKey::ReplayGainTrackGain, format!("{gain_db:.2} dB"));
            tag.insert_text(ItemKey::ReplayGainTrackPeak, format!("{peak:.8}"));
            tag.save_to_path(&path, lofty::config::WriteOptions::default())
                .map_err(|error| {
                    format!("No se pudo escribir ReplayGain en el archivo: {error}")
                })?;
            Ok(ReplayGainTrackResult::Calculated { gain_db })
        })();

        let (gain_db, error, skipped) = match result {
            Ok(ReplayGainTrackResult::Calculated { gain_db }) => (Some(gain_db), None, false),
            Ok(ReplayGainTrackResult::Existing(gain_db)) => (gain_db, None, true),
            Ok(ReplayGainTrackResult::Cancelled) => {
                emit_replay_gain_progress(
                    &app,
                    ReplayGainBatchProgress {
                        current: index,
                        total,
                        path: String::new(),
                        track_name: String::new(),
                        gain_db: None,
                        error: None,
                        skipped: false,
                        finished: true,
                        cancelled: true,
                    },
                );
                REPLAY_GAIN_SCAN_ACTIVE.store(false, Ordering::Release);
                return;
            }
            Err(error) => (None, Some(error), false),
        };
        emit_replay_gain_progress(
            &app,
            ReplayGainBatchProgress {
                current: index + 1,
                total,
                path: raw_path.clone(),
                track_name: display_name,
                gain_db,
                error,
                skipped,
                finished: false,
                cancelled: false,
            },
        );
    }
    emit_replay_gain_progress(
        &app,
        ReplayGainBatchProgress {
            current: total,
            total,
            path: String::new(),
            track_name: String::new(),
            gain_db: None,
            error: None,
            skipped: false,
            finished: true,
            cancelled: false,
        },
    );
    REPLAY_GAIN_SCAN_ACTIVE.store(false, Ordering::Release);
}

#[tauri::command]
pub fn scan_missing_replay_gain(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    if REPLAY_GAIN_SCAN_ACTIVE
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("Ya hay un análisis ReplayGain en ejecución.".to_string());
    }
    CANCEL_REPLAY_GAIN_SCAN.store(false, Ordering::Release);
    tauri::async_runtime::spawn(async move {
        let worker_app = app.clone();
        if let Err(error) =
            tauri::async_runtime::spawn_blocking(move || run_replay_gain_scan(worker_app, paths))
                .await
        {
            REPLAY_GAIN_SCAN_ACTIVE.store(false, Ordering::Release);
            emit_replay_gain_progress(
                &app,
                ReplayGainBatchProgress {
                    current: 0,
                    total: 0,
                    path: String::new(),
                    track_name: String::new(),
                    gain_db: None,
                    error: Some(format!("No se pudo ejecutar el análisis: {error}")),
                    skipped: false,
                    finished: true,
                    cancelled: false,
                },
            );
        }
    });
    Ok(())
}

#[tauri::command]
pub fn cancel_replay_gain_scan() {
    CANCEL_REPLAY_GAIN_SCAN.store(true, Ordering::Release);
}
