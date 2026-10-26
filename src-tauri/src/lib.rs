use discord_rich_presence::{
    activity::{Activity, ActivityType, Assets, Timestamps},
    DiscordIpc, DiscordIpcClient,
};
use notify::{event::ModifyKind, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock, RwLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

mod native_audio;

#[cfg(windows)]
use windows::{
    Foundation::{TimeSpan, TypedEventHandler},
    Media::Playback::MediaPlayer,
    Media::{
        MediaPlaybackStatus, MediaPlaybackType, PlaybackPositionChangeRequestedEventArgs,
        SystemMediaTransportControls, SystemMediaTransportControlsButton,
        SystemMediaTransportControlsButtonPressedEventArgs,
        SystemMediaTransportControlsTimelineProperties,
    },
    Storage::Streams::{DataWriter, InMemoryRandomAccessStream, RandomAccessStreamReference},
};

static MINIMIZE_TO_TRAY: AtomicBool = AtomicBool::new(false);
static REPLAY_GAIN_SCAN_ACTIVE: AtomicBool = AtomicBool::new(false);
static CANCEL_REPLAY_GAIN_SCAN: AtomicBool = AtomicBool::new(false);
static CANCEL_MUSIC_LIBRARY_SCAN: AtomicBool = AtomicBool::new(false);
static PERFORMANCE_SYSTEM: OnceLock<Mutex<sysinfo::System>> = OnceLock::new();

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlobalShortcutBinding {
    action: String,
    shortcut: String,
}

#[derive(Default)]
struct GlobalShortcutRegistry(Mutex<Vec<GlobalShortcutBinding>>);

#[derive(Default)]
struct DiscordRpcState(Mutex<DiscordRpcClientState>);

#[derive(Default)]
struct DiscordCoverCache {
    entries: RwLock<HashMap<String, String>>,
    pending: Mutex<HashSet<String>>,
    retry_after: Mutex<HashMap<String, std::time::Instant>>,
    path: Mutex<Option<PathBuf>>,
}

#[derive(Default)]
struct DiscordRpcClientState {
    enabled: bool,
    client: Option<DiscordIpcClient>,
    presence_visible: bool,
    pause_generation: u64,
    current_cover_path: Option<String>,
    current_cover_url: Option<String>,
    cover_generation: u64,
    cover_resolving: bool,
    cover_attempted: bool,
    latest_update: Option<DiscordPresenceUpdate>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscordPresenceUpdate {
    title: Option<String>,
    artist: Option<String>,
    large_image: Option<String>,
    artwork_mode: Option<String>,
    file_path: Option<String>,
    playing: bool,
    position_seconds: f64,
    duration_seconds: f64,
}

const DISCORD_APPLICATION_ID: &str = "1556755582961066126";
const DISCORD_PAUSE_HIDE_DELAY: std::time::Duration = std::time::Duration::from_secs(30);

#[derive(Default)]
struct WindowsMediaSession {
    #[cfg(windows)]
    inner: Mutex<Option<WindowsMediaSessionState>>,
}

#[cfg(windows)]
struct WindowsMediaSessionState {
    _player: MediaPlayer,
    controls: SystemMediaTransportControls,
    _artwork_stream: Option<RandomAccessStreamReference>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowsMediaControlEvent {
    action: String,
    position_seconds: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PerformanceProcess {
    pid: u32,
    name: String,
    cpu_percent: f32,
    memory_bytes: u64,
    disk_read_bytes: u64,
    disk_write_bytes: u64,
    gpu_percent: Option<f32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PerformanceMetrics {
    processes: Vec<PerformanceProcess>,
    cpu_percent: f32,
    memory_bytes: u64,
    disk_read_bytes: u64,
    disk_write_bytes: u64,
    gpu_percent: Option<f32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReplayGainBatchProgress {
    current: usize,
    total: usize,
    path: String,
    track_name: String,
    gain_db: Option<f64>,
    error: Option<String>,
    skipped: bool,
    finished: bool,
    cancelled: bool,
}

enum ReplayGainMeasurement {
    Complete(f64, f64),
    Cancelled,
}

enum ReplayGainTrackResult {
    Calculated { gain_db: f64 },
    Existing(Option<f64>),
    Cancelled,
}

fn emit_replay_gain_progress(app: &AppHandle, progress: ReplayGainBatchProgress) {
    if let Err(error) = app.emit("replaygain-batch-progress", progress) {
        eprintln!("No se pudo informar el progreso de ReplayGain: {error}");
    }
}

fn calculate_replay_gain(path: &Path) -> Result<ReplayGainMeasurement, String> {
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

fn run_replay_gain_scan(app: AppHandle, paths: Vec<String>) {
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
fn scan_missing_replay_gain(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
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
fn cancel_replay_gain_scan() {
    CANCEL_REPLAY_GAIN_SCAN.store(true, Ordering::Release);
}

/// Consulta PDH de GPU persistente: evita abrir/cerrar + sleep(120ms) en cada poll.
#[cfg(windows)]
struct GpuPdhState {
    query: windows::Win32::System::Performance::PDH_HQUERY,
    counter: windows::Win32::System::Performance::PDH_HCOUNTER,
    /// Tras el primer Collect, los siguientes ya tienen deltas válidos.
    primed: bool,
}

// PDH_HQUERY / PDH_HCOUNTER son *mut c_void; el acceso queda serializado por Mutex.
#[cfg(windows)]
unsafe impl Send for GpuPdhState {}
#[cfg(windows)]
unsafe impl Sync for GpuPdhState {}

#[cfg(windows)]
static GPU_PDH: OnceLock<Mutex<Option<GpuPdhState>>> = OnceLock::new();

#[cfg(windows)]
fn query_gpu_usage(process_ids: &HashSet<u32>) -> Option<HashMap<u32, f32>> {
    use windows::{
        core::PCWSTR,
        Win32::System::Performance::{
            PdhAddEnglishCounterW, PdhCollectQueryData, PdhGetFormattedCounterArrayW,
            PdhOpenQueryW, PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY,
            PDH_MORE_DATA,
        },
    };

    let slot = GPU_PDH.get_or_init(|| Mutex::new(None));
    let mut guard = slot.lock().ok()?;

    unsafe {
        if guard.is_none() {
            let mut query = PDH_HQUERY::default();
            if PdhOpenQueryW(PCWSTR::null(), 0, &mut query) != 0 {
                return None;
            }
            let counter_path: Vec<u16> = "\\GPU Engine(*)\\Utilization Percentage"
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();
            let mut counter = PDH_HCOUNTER::default();
            if PdhAddEnglishCounterW(query, PCWSTR(counter_path.as_ptr()), 0, &mut counter) != 0 {
                return None;
            }
            let _ = PdhCollectQueryData(query);
            *guard = Some(GpuPdhState {
                query,
                counter,
                primed: false,
            });
            return None;
        }

        let state = guard.as_mut()?;
        if PdhCollectQueryData(state.query) != 0 {
            return None;
        }
        if !state.primed {
            state.primed = true;
            return None;
        }

        let counter = state.counter;
        let mut buffer_size = 0_u32;
        let mut item_count = 0_u32;
        let status = PdhGetFormattedCounterArrayW(
            counter,
            PDH_FMT_DOUBLE,
            &mut buffer_size,
            &mut item_count,
            None,
        );
        if status != PDH_MORE_DATA || buffer_size == 0 || item_count == 0 {
            return None;
        }

        let mut buffer = vec![0_u64; (buffer_size as usize).div_ceil(std::mem::size_of::<u64>())];
        let items = buffer.as_mut_ptr().cast::<PDH_FMT_COUNTERVALUE_ITEM_W>();
        if PdhGetFormattedCounterArrayW(
            counter,
            PDH_FMT_DOUBLE,
            &mut buffer_size,
            &mut item_count,
            Some(items),
        ) != 0
        {
            return None;
        }

        let mut usage_by_process: HashMap<u32, f32> = HashMap::new();
        for item in std::slice::from_raw_parts(items, item_count as usize) {
            if item.FmtValue.CStatus != 0 || item.szName.0.is_null() {
                continue;
            }
            let mut length = 0;
            while *item.szName.0.add(length) != 0 {
                length += 1;
            }
            let instance =
                String::from_utf16_lossy(std::slice::from_raw_parts(item.szName.0, length));
            let Some(pid_start) = instance.find("pid_") else {
                continue;
            };
            let pid_text = instance[pid_start + 4..]
                .split('_')
                .next()
                .unwrap_or_default();
            let Ok(pid) = pid_text.parse::<u32>() else {
                continue;
            };
            if !process_ids.contains(&pid) {
                continue;
            }
            let usage = item.FmtValue.Anonymous.doubleValue;
            if usage.is_finite() && usage >= 0.0 {
                let entry = usage_by_process.entry(pid).or_insert(0.0_f32);
                *entry = (*entry).max(usage as f32);
            }
        }
        Some(usage_by_process)
    }
}

#[cfg(not(windows))]
fn query_gpu_usage(_process_ids: &HashSet<u32>) -> Option<HashMap<u32, f32>> {
    None
}

#[tauri::command]
async fn get_performance_metrics() -> Result<PerformanceMetrics, String> {
    tauri::async_runtime::spawn_blocking(collect_performance_metrics)
        .await
        .map_err(|error| format!("Falló el proceso de medición de rendimiento: {error}"))?
}

fn collect_performance_metrics() -> Result<PerformanceMetrics, String> {
    use sysinfo::{Pid, ProcessesToUpdate, System};

    let system = PERFORMANCE_SYSTEM.get_or_init(|| Mutex::new(System::new_all()));
    let (linked_pids, per_process_raw, cpu_cores) = {
        let mut system = system
            .lock()
            .map_err(|_| "No se pudo acceder al monitor de rendimiento.".to_string())?;
        system.refresh_cpu_all();
        system.refresh_processes(ProcessesToUpdate::All, true);

        let current_pid = Pid::from_u32(std::process::id());
        let mut linked_pids = HashSet::from([current_pid]);
        for _ in 0..8 {
            let before = linked_pids.len();
            for (pid, process) in system.processes() {
                if process
                    .parent()
                    .is_some_and(|parent| linked_pids.contains(&parent))
                {
                    linked_pids.insert(*pid);
                }
            }
            if before == linked_pids.len() {
                break;
            }
        }

        let host_names: HashSet<String> = linked_pids
            .iter()
            .filter_map(|pid| system.process(*pid))
            .map(|p| p.name().to_string_lossy().to_lowercase())
            .collect();
        for (pid, process) in system.processes() {
            if linked_pids.contains(pid) {
                continue;
            }
            let name = process.name().to_string_lossy().to_lowercase();
            let looks_webview = name.contains("msedgewebview2")
                || name.contains("webview2")
                || name.contains("resonance");
            if !looks_webview {
                continue;
            }
            if process
                .parent()
                .and_then(|parent| system.process(parent))
                .is_some_and(|parent| {
                    let pn = parent.name().to_string_lossy().to_lowercase();
                    host_names.iter().any(|h| pn.contains(h) || h.contains(&pn))
                        || pn.contains("resonance")
                        || pn.contains("webview")
                })
            {
                linked_pids.insert(*pid);
            }
        }

        let cpu_cores = system.cpus().len().max(1) as f32;
        let mut per_process_raw: Vec<(u32, String, f32, u64, u64, u64)> = Vec::new();
        for pid in &linked_pids {
            let Some(process) = system.process(*pid) else {
                continue;
            };
            let disk = process.disk_usage();
            per_process_raw.push((
                pid.as_u32(),
                process.name().to_string_lossy().into_owned(),
                process.cpu_usage(),
                process.memory(),
                disk.total_read_bytes,
                disk.total_written_bytes,
            ));
        }
        (linked_pids, per_process_raw, cpu_cores)
    };

    let linked_ids: HashSet<u32> = linked_pids.iter().map(|pid| pid.as_u32()).collect();
    let gpu_usage = query_gpu_usage(&linked_ids);

    let mut processes: Vec<PerformanceProcess> = per_process_raw
        .into_iter()
        .map(|(pid, name, cpu_raw, memory, disk_read, disk_write)| {
            let cpu_percent = (cpu_raw / cpu_cores).clamp(0.0, 100.0);
            let gpu_percent = gpu_usage.as_ref().map(|usage| {
                usage
                    .get(&pid)
                    .copied()
                    .unwrap_or_default()
                    .clamp(0.0, 100.0)
            });
            PerformanceProcess {
                pid,
                name,
                cpu_percent,
                memory_bytes: memory,
                disk_read_bytes: disk_read,
                disk_write_bytes: disk_write,
                gpu_percent,
            }
        })
        .collect();
    processes.sort_by(|left, right| {
        right
            .cpu_percent
            .total_cmp(&left.cpu_percent)
            .then_with(|| left.name.cmp(&right.name))
    });

    let cpu_percent = processes
        .iter()
        .map(|process| process.cpu_percent)
        .sum::<f32>()
        .clamp(0.0, 100.0);
    let memory_bytes = processes.iter().map(|process| process.memory_bytes).sum();
    let disk_read_bytes = processes
        .iter()
        .map(|process| process.disk_read_bytes)
        .sum();
    let disk_write_bytes = processes
        .iter()
        .map(|process| process.disk_write_bytes)
        .sum();
    let gpu_percent = gpu_usage.as_ref().map(|usage| {
        processes
            .iter()
            .map(|process| usage.get(&process.pid).copied().unwrap_or_default())
            .sum::<f32>()
            .clamp(0.0, 100.0)
    });

    Ok(PerformanceMetrics {
        processes,
        cpu_percent,
        memory_bytes,
        disk_read_bytes,
        disk_write_bytes,
        gpu_percent,
    })
}

#[tauri::command]
fn set_taskbar_playback_progress(
    app: AppHandle,
    progress: Option<u64>,
    paused: bool,
) -> Result<(), String> {
    use tauri::window::{ProgressBarState, ProgressBarStatus};

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "No se encontró la ventana principal.".to_string())?;
    let status = if progress.is_none() {
        ProgressBarStatus::None
    } else if paused {
        ProgressBarStatus::Paused
    } else {
        ProgressBarStatus::Normal
    };
    window
        .set_progress_bar(ProgressBarState {
            status: Some(status),
            progress,
        })
        .map_err(|error| {
            format!("No se pudo actualizar el progreso de la barra de tareas: {error}")
        })
}

#[cfg(windows)]
fn initialize_windows_media_session(
    app: &AppHandle,
    session: &WindowsMediaSession,
) -> Result<(), String> {
    let player = MediaPlayer::new().map_err(|error| error.to_string())?;
    let _ = player.SetVolume(0.0);
    let _ = player.SetIsMuted(true);
    let command_manager = player.CommandManager().map_err(|error| error.to_string())?;
    command_manager
        .SetIsEnabled(true)
        .map_err(|error| error.to_string())?;
    let controls = player
        .SystemMediaTransportControls()
        .map_err(|error| error.to_string())?;
    controls
        .SetIsEnabled(true)
        .map_err(|error| error.to_string())?;
    controls
        .SetIsPlayEnabled(true)
        .map_err(|error| error.to_string())?;
    controls
        .SetIsPauseEnabled(true)
        .map_err(|error| error.to_string())?;
    controls
        .SetIsNextEnabled(true)
        .map_err(|error| error.to_string())?;
    controls
        .SetIsPreviousEnabled(true)
        .map_err(|error| error.to_string())?;

    let control_app = app.clone();
    controls
        .ButtonPressed(&TypedEventHandler::new(
            move |_,
                  args: windows::core::Ref<
                '_,
                SystemMediaTransportControlsButtonPressedEventArgs,
            >| {
                let args = args.as_ref();
                let Some(args) = args else {
                    return Ok(());
                };
                let action = match args.Button()? {
                    SystemMediaTransportControlsButton::Play => "play",
                    SystemMediaTransportControlsButton::Pause => "pause",
                    SystemMediaTransportControlsButton::Next => "next",
                    SystemMediaTransportControlsButton::Previous => "previous",
                    _ => return Ok(()),
                };
                if let Err(error) = control_app.emit(
                    "windows-media-control",
                    WindowsMediaControlEvent {
                        action: action.to_string(),
                        position_seconds: None,
                    },
                ) {
                    eprintln!("No se pudo enviar el control multimedia de Windows: {error}");
                }
                Ok(())
            },
        ))
        .map_err(|error| error.to_string())?;

    let seek_app = app.clone();
    controls
        .PlaybackPositionChangeRequested(&TypedEventHandler::new(
            move |_, args: windows::core::Ref<'_, PlaybackPositionChangeRequestedEventArgs>| {
                let Some(args) = args.as_ref() else {
                    return Ok(());
                };
                let position_seconds =
                    args.RequestedPlaybackPosition()?.Duration as f64 / 10_000_000.0;
                if let Err(error) = seek_app.emit(
                    "windows-media-control",
                    WindowsMediaControlEvent {
                        action: "seek".to_string(),
                        position_seconds: Some(position_seconds),
                    },
                ) {
                    eprintln!("No se pudo enviar la búsqueda multimedia de Windows: {error}");
                }
                Ok(())
            },
        ))
        .map_err(|error| error.to_string())?;

    let mut media_session = session
        .inner
        .lock()
        .map_err(|error| format!("No se pudo inicializar la sesión multimedia: {error}"))?;
    *media_session = Some(WindowsMediaSessionState {
        _player: player,
        controls,
        _artwork_stream: None,
    });
    Ok(())
}

#[cfg(not(windows))]
fn initialize_windows_media_session(
    _app: &AppHandle,
    _session: &WindowsMediaSession,
) -> Result<(), String> {
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowsMediaMetadata {
    title: String,
    artist: String,
    album: String,
    cover_path: Option<String>,
    artwork_base64: Option<String>,
}

#[tauri::command]
fn update_windows_media_metadata(
    metadata: WindowsMediaMetadata,
    session: State<'_, WindowsMediaSession>,
    app: AppHandle,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        {
            let needs_init = session
                .inner
                .lock()
                .map(|g| g.is_none())
                .unwrap_or(false);
            if needs_init {
                initialize_windows_media_session(&app, &session)?;
            }
        }
        if metadata.title.len() > 1024
            || metadata.artist.len() > 1024
            || metadata.album.len() > 1024
        {
            return Err("Los metadatos de la pista superan el tamaño permitido.".to_string());
        }
        if metadata
            .artwork_base64
            .as_ref()
            .is_some_and(|artwork| artwork.len() > 12 * 1024 * 1024)
        {
            return Err("La portada supera el tamaño máximo permitido de 8 MiB.".to_string());
        }

        let mut session = session
            .inner
            .lock()
            .map_err(|error| format!("No se pudo acceder a la sesión multimedia: {error}"))?;
        let media_session = session
            .as_mut()
            .ok_or_else(|| "La sesión multimedia de Windows no está inicializada.".to_string())?;
        let updater = media_session
            .controls
            .DisplayUpdater()
            .map_err(|error| error.to_string())?;
        updater.ClearAll().map_err(|error| error.to_string())?;
        updater
            .SetType(MediaPlaybackType::Music)
            .map_err(|error| error.to_string())?;
        let properties = updater
            .MusicProperties()
            .map_err(|error| error.to_string())?;
        properties
            .SetTitle(&windows::core::HSTRING::from(metadata.title))
            .map_err(|error| error.to_string())?;
        properties
            .SetArtist(&windows::core::HSTRING::from(metadata.artist))
            .map_err(|error| error.to_string())?;
        properties
            .SetAlbumTitle(&windows::core::HSTRING::from(metadata.album))
            .map_err(|error| error.to_string())?;

        // Priorizar lectura directa de archivo en disco para evitar mandar Base64 desde WebView2
        let raw_bytes: Option<Vec<u8>> = if let Some(ref cover_path) = metadata
            .cover_path
            .as_deref()
            .filter(|p| !p.is_empty() && *p != "none")
        {
            let p = Path::new(cover_path);
            if p.is_file() {
                fs::read(p).ok()
            } else {
                None
            }
        } else if let Some(artwork_base64) = metadata.artwork_base64 {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD
                .decode(artwork_base64)
                .ok()
        } else {
            None
        };

        let artwork_stream = if let Some(bytes) = raw_bytes {
            if bytes.len() <= 8 * 1024 * 1024 {
                let stream = InMemoryRandomAccessStream::new().map_err(|error| error.to_string())?;
                let writer =
                    DataWriter::CreateDataWriter(&stream).map_err(|error| error.to_string())?;
                writer
                    .WriteBytes(&bytes)
                    .map_err(|error| error.to_string())?;
                writer
                    .StoreAsync()
                    .map_err(|error| error.to_string())?
                    .join()
                    .map_err(|error| error.to_string())?;
                writer
                    .FlushAsync()
                    .map_err(|error| error.to_string())?
                    .join()
                    .map_err(|error| error.to_string())?;
                writer.DetachStream().map_err(|error| error.to_string())?;
                stream.Seek(0).map_err(|error| error.to_string())?;
                let reference = RandomAccessStreamReference::CreateFromStream(&stream)
                    .map_err(|error| error.to_string())?;
                updater
                    .SetThumbnail(&reference)
                    .map_err(|error| error.to_string())?;
                Some(reference)
            } else {
                None
            }
        } else {
            None
        };

        updater.Update().map_err(|error| error.to_string())?;
        media_session._artwork_stream = artwork_stream;
    }
    #[cfg(not(windows))]
    let _ = (metadata, session);
    Ok(())
}

#[tauri::command]
fn update_windows_media_playback(
    playing: bool,
    position_seconds: f64,
    duration_seconds: f64,
    session: State<'_, WindowsMediaSession>,
    app: AppHandle,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        // Lazy: el MediaPlayer de SMTC abre una sesión en el mezclador; solo al usar controles de medios
        {
            let needs_init = session
                .inner
                .lock()
                .map(|g| g.is_none())
                .unwrap_or(false);
            if needs_init {
                initialize_windows_media_session(&app, &session)?;
            }
        }

        let session = session
            .inner
            .lock()
            .map_err(|error| format!("No se pudo acceder a la sesión multimedia: {error}"))?;
        let media_session = session
            .as_ref()
            .ok_or_else(|| "La sesión multimedia de Windows no está inicializada.".to_string())?;
        media_session
            .controls
            .SetPlaybackStatus(if playing {
                MediaPlaybackStatus::Playing
            } else {
                MediaPlaybackStatus::Paused
            })
            .map_err(|error| error.to_string())?;

        if duration_seconds.is_finite() && duration_seconds > 0.0 {
            let position = if position_seconds.is_finite() {
                position_seconds.clamp(0.0, duration_seconds)
            } else {
                0.0
            };
            let timeline = SystemMediaTransportControlsTimelineProperties::new()
                .map_err(|error| error.to_string())?;
            timeline
                .SetStartTime(TimeSpan { Duration: 0 })
                .map_err(|error| error.to_string())?;
            timeline
                .SetEndTime(TimeSpan {
                    Duration: (duration_seconds * 10_000_000.0) as i64,
                })
                .map_err(|error| error.to_string())?;
            timeline
                .SetPosition(TimeSpan {
                    Duration: (position * 10_000_000.0) as i64,
                })
                .map_err(|error| error.to_string())?;
            media_session
                .controls
                .UpdateTimelineProperties(&timeline)
                .map_err(|error| error.to_string())?;
        }
    }
    #[cfg(not(windows))]
    let _ = (playing, position_seconds, duration_seconds, session);
    Ok(())
}

#[tauri::command]
fn seek_windows_media_position(
    position_seconds: f64,
    duration_seconds: f64,
    session: State<'_, WindowsMediaSession>,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        if !position_seconds.is_finite() || !duration_seconds.is_finite() || duration_seconds <= 0.0
        {
            return Err("La posición multimedia recibida no es válida.".to_string());
        }
        let session = session
            .inner
            .lock()
            .map_err(|error| format!("No se pudo acceder a la sesión multimedia: {error}"))?;
        let media_session = session
            .as_ref()
            .ok_or_else(|| "La sesión multimedia de Windows no está inicializada.".to_string())?;
        let position = position_seconds.clamp(0.0, duration_seconds);
        let timeline = SystemMediaTransportControlsTimelineProperties::new()
            .map_err(|error| error.to_string())?;
        timeline
            .SetStartTime(TimeSpan { Duration: 0 })
            .map_err(|error| error.to_string())?;
        timeline
            .SetEndTime(TimeSpan {
                Duration: (duration_seconds * 10_000_000.0) as i64,
            })
            .map_err(|error| error.to_string())?;
        timeline
            .SetPosition(TimeSpan {
                Duration: (position * 10_000_000.0) as i64,
            })
            .map_err(|error| error.to_string())?;
        media_session
            .controls
            .UpdateTimelineProperties(&timeline)
            .map_err(|error| error.to_string())?;
    }
    #[cfg(not(windows))]
    let _ = (position_seconds, duration_seconds, session);
    Ok(())
}

#[derive(Default)]
struct MusicWatcher(Mutex<Option<RecommendedWatcher>>);

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct MusicDirectory {
    path: String,
    name: String,
    /// Subcarpetas inmediatas (rutas absolutas) excluidas del escaneo
    #[serde(default)]
    excluded_subfolders: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MusicSubfolder {
    name: String,
    path: String,
    excluded: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MusicFile {
    name: String,
    path: String,
    directory_path: String,
    relative_path: String,
    size: u64,
    last_modified: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MusicLibrary {
    directories: Vec<MusicDirectory>,
    files: Vec<MusicFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageInfo {
    mode: String,
    path: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
}

const WINDOW_BOUNDS_SETTING: &str = "pn_window_bounds";
const MIN_WINDOW_WIDTH: u32 = 760;
const MIN_WINDOW_HEIGHT: u32 = 540;
const MAX_WINDOW_DIMENSION: u32 = 8192;

fn portable_storage_directory() -> Result<PathBuf, String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let executable_directory = executable
        .parent()
        .ok_or_else(|| "No se pudo determinar la carpeta de la aplicación.".to_string())?;
    Ok(executable_directory.join("data"))
}

fn app_data_storage_directory(app: &AppHandle) -> Result<PathBuf, String> {
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

fn active_storage_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let portable_directory = portable_storage_directory()?;
    if portable_directory.is_dir() {
        Ok(portable_directory)
    } else {
        app_data_storage_directory(app)
    }
}

fn copy_directory_contents(source: &Path, destination: &Path) -> Result<(), String> {
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

fn copy_directory_contents_if_missing(source: &Path, destination: &Path) -> Result<(), String> {
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
fn get_storage_info(app: AppHandle) -> Result<StorageInfo, String> {
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
fn open_storage_directory(app: AppHandle) -> Result<(), String> {
    let directory = active_storage_directory(&app)?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("No se pudo crear {}: {error}", directory.display()))?;
    app.opener()
        .open_path(directory.to_string_lossy().into_owned(), None::<String>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_storage_location(
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

fn read_music_directories(app: &AppHandle) -> Result<Vec<MusicDirectory>, String> {
    let store_path = directory_store_path(app)?;
    if !store_path.exists() {
        return Ok(Vec::new());
    }
    let contents = fs::read_to_string(store_path).map_err(|error| error.to_string())?;
    serde_json::from_str(&contents).map_err(|error| error.to_string())
}

fn write_music_directories(app: &AppHandle, directories: &[MusicDirectory]) -> Result<(), String> {
    let contents = serde_json::to_vec_pretty(directories).map_err(|error| error.to_string())?;
    fs::write(directory_store_path(app)?, contents).map_err(|error| error.to_string())
}

fn settings_store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let storage_directory = active_storage_directory(app)?;
    fs::create_dir_all(&storage_directory).map_err(|error| error.to_string())?;
    Ok(storage_directory.join("settings.json"))
}

fn read_window_bounds(app: &AppHandle) -> Result<Option<WindowBounds>, String> {
    let path = settings_store_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let settings: HashMap<String, serde_json::Value> =
        serde_json::from_str(&contents).map_err(|error| error.to_string())?;
    let Some(value) = settings.get(WINDOW_BOUNDS_SETTING) else {
        return Ok(None);
    };
    let serialized = value
        .as_str()
        .ok_or_else(|| "La geometría guardada de la ventana no es válida.".to_string())?;
    let bounds: WindowBounds = serde_json::from_str(serialized)
        .map_err(|error| format!("No se pudo leer la geometría de la ventana: {error}"))?;
    if !(MIN_WINDOW_WIDTH..=MAX_WINDOW_DIMENSION).contains(&bounds.width)
        || !(MIN_WINDOW_HEIGHT..=MAX_WINDOW_DIMENSION).contains(&bounds.height)
    {
        return Ok(None);
    }
    Ok(Some(bounds))
}

fn write_window_bounds(app: &AppHandle, mut bounds: WindowBounds) -> Result<(), String> {
    if !(MIN_WINDOW_WIDTH..=MAX_WINDOW_DIMENSION).contains(&bounds.width)
        || !(MIN_WINDOW_HEIGHT..=MAX_WINDOW_DIMENSION).contains(&bounds.height)
    {
        return Err(
            "El tamaño guardado de la ventana está fuera de los límites permitidos.".into(),
        );
    }
    let path = settings_store_path(app)?;
    let mut settings: HashMap<String, serde_json::Value> = if path.exists() {
        let contents = fs::read_to_string(&path).map_err(|error| error.to_string())?;
        serde_json::from_str(&contents).map_err(|error| error.to_string())?
    } else {
        HashMap::new()
    };
    if bounds.maximized {
        if let Some(previous_bounds) = settings
            .get(WINDOW_BOUNDS_SETTING)
            .and_then(serde_json::Value::as_str)
            .and_then(|value| serde_json::from_str::<WindowBounds>(value).ok())
        {
            bounds.x = previous_bounds.x;
            bounds.y = previous_bounds.y;
            bounds.width = previous_bounds.width;
            bounds.height = previous_bounds.height;
        }
    }
    let serialized = serde_json::to_string(&bounds).map_err(|error| error.to_string())?;
    settings.insert(
        WINDOW_BOUNDS_SETTING.to_string(),
        serde_json::Value::String(serialized),
    );
    let contents = serde_json::to_vec_pretty(&settings).map_err(|error| error.to_string())?;
    fs::write(path, contents).map_err(|error| error.to_string())
}

fn persist_window_bounds_from_window(window: &tauri::Window) -> Result<(), String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let maximized = window.is_maximized().map_err(|error| error.to_string())?;
    write_window_bounds(
        window.app_handle(),
        WindowBounds {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
            maximized,
        },
    )
}

fn restore_window_bounds(window: &tauri::WebviewWindow) -> Result<(), String> {
    let Some(bounds) = read_window_bounds(window.app_handle())? else {
        return Ok(());
    };
    let monitors = window
        .available_monitors()
        .map_err(|error| error.to_string())?;
    let intersects_monitor = monitors.iter().any(|monitor| {
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let right = i64::from(bounds.x) + i64::from(bounds.width);
        let bottom = i64::from(bounds.y) + i64::from(bounds.height);
        let monitor_right = i64::from(monitor_position.x) + i64::from(monitor_size.width);
        let monitor_bottom = i64::from(monitor_position.y) + i64::from(monitor_size.height);
        right > i64::from(monitor_position.x)
            && i64::from(bounds.x) < monitor_right
            && bottom > i64::from(monitor_position.y)
            && i64::from(bounds.y) < monitor_bottom
    });
    let (x, y) = if intersects_monitor {
        (bounds.x, bounds.y)
    } else {
        let monitor = window
            .primary_monitor()
            .map_err(|error| error.to_string())?
            .or_else(|| monitors.first().cloned());
        if let Some(monitor) = monitor {
            let position = monitor.position();
            let size = monitor.size();
            (
                position.x + (size.width.saturating_sub(bounds.width) / 2) as i32,
                position.y + (size.height.saturating_sub(bounds.height) / 2) as i32,
            )
        } else {
            (bounds.x, bounds.y)
        }
    };
    window
        .set_size(tauri::Size::Physical(PhysicalSize::new(
            bounds.width,
            bounds.height,
        )))
        .map_err(|error| error.to_string())?;
    window
        .set_position(tauri::Position::Physical(PhysicalPosition::new(x, y)))
        .map_err(|error| error.to_string())?;
    if bounds.maximized {
        window.maximize().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn is_valid_app_setting(key: &str, value: &serde_json::Value) -> bool {
    match key {
        "discord_rpc_enabled" | "pn_discord_rpc_enabled" => {
            value.is_boolean() || value.as_str().is_some()
        }
        "visual_plus" => {
            // Objeto Visual+: aceptar formas actuales y legacy (no tumbar todo el settings.json)
            if let Some(settings) = value.as_object() {
                return settings
                    .get("enabled")
                    .map_or(true, |v| v.is_boolean() || v.as_str().is_some());
            }
            false
        }
        "pn_visual_plus" => value.is_string() || value.is_object(),
        _ => key.starts_with("pn_") && value.is_string(),
    }
}

#[tauri::command]
fn load_app_settings(app: AppHandle) -> Result<Option<HashMap<String, serde_json::Value>>, String> {
    let path = settings_store_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let settings: HashMap<String, serde_json::Value> =
        serde_json::from_str(&contents).map_err(|error| error.to_string())?;
    // Filtrar claves/valores inválidos en lugar de rechazar todo el archivo
    // (evita dejar la app sin settings y sin arrancar la UI).
    let filtered: HashMap<String, serde_json::Value> = settings
        .into_iter()
        .filter(|(key, value)| is_valid_app_setting(key, value))
        .collect();
    if filtered.is_empty() {
        return Ok(None);
    }
    Ok(Some(filtered))
}

#[tauri::command]
fn save_app_settings(
    app: AppHandle,
    mut settings: HashMap<String, serde_json::Value>,
) -> Result<(), String> {
    if settings.len() > 10_000
        || settings.iter().any(|(key, value)| {
            key.len() > 256
                || !is_valid_app_setting(key, value)
                || (key.starts_with("pn_")
                    && value.as_str().map_or(true, |value| value.len() > 1_000_000))
        })
    {
        return Err(
            "La configuración contiene valores fuera de los límites permitidos.".to_string(),
        );
    }
    if !settings.contains_key(WINDOW_BOUNDS_SETTING) {
        if let Some(saved_bounds) = load_app_settings(app.clone())?
            .and_then(|saved_settings| saved_settings.get(WINDOW_BOUNDS_SETTING).cloned())
        {
            settings.insert(WINDOW_BOUNDS_SETTING.to_string(), saved_bounds);
        }
    }
    let contents = serde_json::to_vec_pretty(&settings).map_err(|error| error.to_string())?;
    fs::write(settings_store_path(&app)?, contents).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_window_bounds(app: AppHandle, bounds: WindowBounds) -> Result<(), String> {
    write_window_bounds(&app, bounds)
}

fn connect_discord_client(state: &mut DiscordRpcClientState) -> Result<(), String> {
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
fn set_discord_rpc_enabled(
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
    state.current_cover_url = None;
    state.cover_resolving = false;
    state.cover_attempted = false;
    state.latest_update = None;
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join(" "))
    }
}

fn set_discord_activity(
    state: &mut DiscordRpcClientState,
    update: &DiscordPresenceUpdate,
    large_image: &str,
) -> Result<(), String> {
    connect_discord_client(state)?;
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

    if update.playing
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
        activity = activity.timestamps(Timestamps::new().start(start).end(start + duration));
    }

    state
        .client
        .as_mut()
        .ok_or_else(|| "El cliente de Discord no está conectado.".to_string())?
        .set_activity(activity)
        .map_err(|error| format!("No se pudo actualizar Discord Rich Presence: {error}"))
}

fn initialize_discord_cover_cache(
    app: &AppHandle,
    cache: &DiscordCoverCache,
) -> Result<(), String> {
    let directory = app_data_storage_directory(app)?;
    fs::create_dir_all(&directory).map_err(|error| {
        format!("No se pudo crear la carpeta de la caché de carátulas de Discord: {error}")
    })?;
    let path = directory.join("discord_covers_cache.json");
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
    Ok(())
}

fn extract_embedded_cover(file_path: PathBuf) -> Result<Option<Vec<u8>>, String> {
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

fn encode_discord_cover(bytes: &[u8]) -> Result<Vec<u8>, String> {
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

async fn upload_discord_cover(bytes: Vec<u8>) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .http1_only()
        .user_agent("Resonance/1.0.0 (https://github.com/local/resonance)")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| format!("No se pudo iniciar la subida de la carátula: {error}"))?;

    let response = {
        let mut response = None;
        for attempt in 0..2 {
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
                Ok(result) => {
                    response = Some(result);
                    break;
                }
                Err(error) if attempt == 0 && (error.is_connect() || error.is_timeout()) => {
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
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

async fn resolve_discord_cover(app: AppHandle, raw_path: String) -> Result<Option<String>, String> {
    let file_path = ensure_path_in_library(&app, &raw_path)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || extract_embedded_cover(file_path))
        .await
        .map_err(|error| format!("No se pudo analizar la carátula de la pista: {error}"))??;
    let Some(bytes) = bytes else {
        eprintln!("Discord Rich Presence: el archivo actual no contiene una carátula incrustada.");
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
    if cache
        .retry_after
        .lock()
        .map_err(|error| format!("No se pudo consultar la espera de subida: {error}"))?
        .get(&hash)
        .is_some_and(|retry_at| *retry_at > std::time::Instant::now())
    {
        return Ok(None);
    }
    let already_pending = {
        let mut pending = cache
            .pending
            .lock()
            .map_err(|error| format!("No se pudo consultar las subidas activas: {error}"))?;
        !pending.insert(hash.clone())
    };
    if already_pending {
        for _ in 0..220 {
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
                return Ok(None);
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

#[tauri::command]
fn update_discord_presence(
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
    }
    let (large_image, cover_task) = if local_artwork {
        if state.current_cover_path != file_path {
            state.cover_generation = state.cover_generation.wrapping_add(1);
            state.current_cover_path = file_path.clone();
            state.current_cover_url = None;
            state.cover_resolving = false;
            state.cover_attempted = false;
        }
        let image = state
            .current_cover_url
            .clone()
            .unwrap_or_else(|| "music_default".to_string());
        let start_resolution = file_path.as_ref().is_some_and(|_| {
            !state.cover_resolving && !state.cover_attempted && state.current_cover_url.is_none()
        });
        if start_resolution {
            state.cover_resolving = true;
            state.cover_attempted = true;
        }
        let cover_task = if start_resolution {
            file_path.clone().map(|path| (path, state.cover_generation))
        } else {
            None
        };
        (image, cover_task)
    } else {
        if state.current_cover_path.is_some() || state.current_cover_url.is_some() {
            state.cover_generation = state.cover_generation.wrapping_add(1);
            state.current_cover_path = None;
            state.current_cover_url = None;
            state.cover_resolving = false;
            state.cover_attempted = false;
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
        eprintln!(
            "Discord Rich Presence: resolviendo la carátula local; ruta del archivo disponible."
        );
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

    if let Some((file_path, generation)) = cover_task {
        let app_for_task = app.clone();
        tauri::async_runtime::spawn(async move {
            let resolved = resolve_discord_cover(app_for_task.clone(), file_path.clone()).await;
            let image_url = match resolved {
                Ok(url) => url,
                Err(error) => {
                    eprintln!(
                        "No se pudo alojar la carátula local para Discord; se mantiene el icono predeterminado. {error}"
                    );
                    None
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
            }
        });
    }
    Ok(())
}

fn library_cache_directory(app: &AppHandle) -> Result<PathBuf, String> {
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
fn get_music_directories(app: AppHandle) -> Result<Vec<MusicDirectory>, String> {
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
fn get_cached_music_library(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let cache_path = library_cache_directory(&app)?.join("library.json");
    let covers_directory = cache_path
        .parent()
        .ok_or_else(|| "No se pudo determinar la carpeta de caché de carátulas.".to_string())?
        .join("covers");
    if covers_directory.is_dir() {
        app.asset_protocol_scope()
            .allow_directory(&covers_directory, true)
            .map_err(|error| error.to_string())?;
    }
    if !cache_path.exists() {
        return Ok(Vec::new());
    }
    let contents = fs::read_to_string(cache_path).map_err(|error| error.to_string())?;
    serde_json::from_str(&contents).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_cached_music_library(
    app: AppHandle,
    mut tracks: Vec<serde_json::Value>,
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
    let contents = serde_json::to_vec(&tracks).map_err(|error| error.to_string())?;
    fs::write(cache_directory.join("library.json"), contents).map_err(|error| error.to_string())?;
    Ok(cover_paths)
}

#[tauri::command]
fn save_playlist_cover(
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

fn directory_size(path: &Path) -> Result<u64, String> {
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
fn get_library_cache_size(app: AppHandle) -> Result<u64, String> {
    directory_size(&library_cache_directory(&app)?)
}

#[tauri::command]
fn clear_library_cache(app: AppHandle) -> Result<(), String> {
    let path = library_cache_directory(&app)?;
    if path.exists() {
        fs::remove_dir_all(&path).map_err(|error| error.to_string())?;
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

#[tauri::command]
fn configure_music_watcher(
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

#[tauri::command]
fn set_minimize_to_tray(enabled: bool, app: AppHandle) {
    MINIMIZE_TO_TRAY.store(enabled, Ordering::Relaxed);
    if !enabled {
        // Sin la opción activa, el icono de bandeja no debe permanecer visible
        set_tray_visible(&app, false);
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
        }
    }
}

fn replace_global_shortcuts(
    app: &AppHandle,
    bindings: &[GlobalShortcutBinding],
) -> Result<(), String> {
    let mut parsed = Vec::with_capacity(bindings.len());
    let mut registered_ids = HashSet::with_capacity(bindings.len());
    for binding in bindings {
        if ![
            "playPause",
            "nextTrack",
            "prevTrack",
            "seekForward10",
            "seekBackward10",
            "volumeUp",
            "volumeDown",
            "mute",
            "shuffle",
            "repeat",
            "lyrics",
            "queue",
        ]
        .contains(&binding.action.as_str())
        {
            return Err(format!("Acción de atajo desconocida: {}", binding.action));
        }
        let shortcut = binding
            .shortcut
            .parse::<tauri_plugin_global_shortcut::Shortcut>()
            .map_err(|error| {
                format!(
                    "La combinación global \"{}\" no es válida: {error}",
                    binding.shortcut
                )
            })?;
        if !registered_ids.insert(shortcut.id) {
            return Err(format!(
                "La combinación global \"{}\" ya está asignada.",
                binding.shortcut
            ));
        }
        parsed.push((shortcut, binding.action.clone()));
    }

    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    app.global_shortcut().unregister_all().map_err(|error| {
        format!("No se pudieron quitar los atajos globales anteriores: {error}")
    })?;

    for (shortcut, action) in parsed {
        if let Err(error) =
            app.global_shortcut()
                .on_shortcut(shortcut, move |app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Err(error) = app.emit("global-shortcut-action", action.clone()) {
                            eprintln!("No se pudo enviar la acción de atajo global: {error}");
                        }
                    }
                })
        {
            let cleanup_error = app
                .global_shortcut()
                .unregister_all()
                .err()
                .map(|cleanup| format!(" Tampoco se pudo limpiar el registro parcial: {cleanup}"))
                .unwrap_or_default();
            return Err(format!(
                "No se pudo registrar un atajo global: {error}.{cleanup_error}"
            ));
        }
    }
    Ok(())
}

#[tauri::command]
fn set_global_shortcuts(
    app: AppHandle,
    bindings: Vec<GlobalShortcutBinding>,
    registry: State<'_, GlobalShortcutRegistry>,
) -> Result<(), String> {
    let mut current_bindings = registry
        .0
        .lock()
        .map_err(|error| format!("No se pudo acceder al registro de atajos: {error}"))?;
    let previous_bindings = current_bindings.clone();

    if let Err(error) = replace_global_shortcuts(&app, &bindings) {
        if let Err(rollback_error) = replace_global_shortcuts(&app, &previous_bindings) {
            return Err(format!(
                "{error} No se pudieron restaurar los atajos anteriores: {rollback_error}"
            ));
        }
        return Err(error);
    }

    *current_bindings = bindings;
    Ok(())
}

fn set_tray_visible(app: &AppHandle, visible: bool) {
    if let Some(tray) = app.tray_by_id("resonance-tray") {
        if let Err(error) = tray.set_visible(visible) {
            eprintln!("No se pudo cambiar la visibilidad de la bandeja: {error}");
        }
    }
}

fn build_system_tray(app: &tauri::App) -> tauri::Result<()> {
    let play_pause = MenuItem::with_id(
        app,
        "tray_play_pause",
        "Reproducir / Pausar",
        true,
        None::<&str>,
    )?;
    let next = MenuItem::with_id(app, "tray_next", "Siguiente", true, None::<&str>)?;
    let previous = MenuItem::with_id(app, "tray_previous", "Anterior", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "tray_show", "Mostrar Resonance", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray_quit", "Salir", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[&play_pause, &next, &previous, &separator, &show, &quit],
    )?;

    let mut tray = TrayIconBuilder::with_id("resonance-tray")
        .menu(&menu)
        .tooltip("Resonance")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray_play_pause" => {
                if let Err(error) = app.emit("tray-playback-action", "play-pause") {
                    eprintln!("No se pudo enviar la acción de reproducción: {error}");
                }
            }
            "tray_next" => {
                if let Err(error) = app.emit("tray-playback-action", "next") {
                    eprintln!("No se pudo enviar la acción siguiente: {error}");
                }
            }
            "tray_previous" => {
                if let Err(error) = app.emit("tray-playback-action", "previous") {
                    eprintln!("No se pudo enviar la acción anterior: {error}");
                }
            }
            "tray_show" => {
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(error) = window.show() {
                        eprintln!("No se pudo mostrar Resonance: {error}");
                    } else if let Err(error) = window.set_focus() {
                        eprintln!("No se pudo enfocar Resonance: {error}");
                    }
                }
                set_tray_visible(app, false);
            }
            "tray_quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                set_tray_visible(app, false);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    let tray_icon = tray.build(app)?;
    // Oculto al iniciar; solo se muestra al minimizar/cerrar con la opción activada
    if let Err(error) = tray_icon.set_visible(false) {
        eprintln!("No se pudo ocultar el icono de bandeja al inicio: {error}");
    }
    Ok(())
}


fn normalized_directory(path: &Path) -> Result<MusicDirectory, String> {
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
fn list_music_subfolders(app: AppHandle, path: String) -> Result<Vec<MusicSubfolder>, String> {
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
fn set_music_subfolder_excluded(
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

fn normalize_path_key(path: &str) -> String {
    path.replace("\\", "/")
        .trim_end_matches('/')
        .to_lowercase()
}

#[tauri::command]
fn add_music_directory(app: AppHandle) -> Result<Option<MusicDirectory>, String> {
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
fn select_music_file(app: AppHandle) -> Result<Option<String>, String> {
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
fn save_m3u8_file(file_name: String, contents: String) -> Result<bool, String> {
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
fn save_settings_backup(contents: String) -> Result<bool, String> {
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

#[tauri::command]
fn remove_music_directory(app: AppHandle, path: String) -> Result<(), String> {
    let mut directories = read_music_directories(&app)?;
    directories.retain(|directory| !directory.path.eq_ignore_ascii_case(&path));
    write_music_directories(&app, &directories)
}

#[tauri::command]
fn replace_music_directories(
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
fn delete_music_file(app: AppHandle, path: String) -> Result<(), String> {
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

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrackTagUpdate {
    path: String,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    year: Option<String>,
    track_number: Option<String>,
    disc_number: Option<String>,
    genre: Option<String>,
    lyrics: Option<String>,
    cover_base64: Option<String>,
    cover_mime: Option<String>,
    remove_cover: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScannedTrackMetadata {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    track_number: Option<u32>,
    duration: Option<f64>,
    sample_rate: Option<u32>,
    channels: Option<u8>,
    bit_depth: Option<u8>,
    codec: Option<String>,
    genre: Option<String>,
    replay_gain_db: Option<f64>,
    /// Absolute path inside library-cache/covers (never base64).
    cover_path: Option<String>,
    /// Lyrics only when include_lyrics is true (on-demand).
    lyrics: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScannedTrackResult {
    path: String,
    metadata: Option<ScannedTrackMetadata>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TrackTextMetadata {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
}

#[tauri::command]
fn read_track_text_metadata(app: AppHandle, path: String) -> Result<TrackTextMetadata, String> {
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

fn canonical_music_roots(app: &AppHandle) -> Result<Vec<PathBuf>, String> {
    let directories = read_music_directories(app)?;
    Ok(directories
        .iter()
        .filter_map(|directory| Path::new(&directory.path).canonicalize().ok())
        .collect())
}

fn ensure_path_in_roots(raw_path: &str, canonical_roots: &[PathBuf]) -> Result<PathBuf, String> {
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


fn normalize_discord_path_key(path: &str) -> String {
    let normalized = path.replace('/', "\\");
    let trimmed = normalized
        .strip_prefix(r"\\?\")
        .or_else(|| normalized.strip_prefix(r"//?/"))
        .unwrap_or(normalized.as_str());
    trimmed.to_ascii_lowercase()
}

fn ensure_path_in_library(app: &AppHandle, raw_path: &str) -> Result<PathBuf, String> {
    let roots = canonical_music_roots(app)?;
    ensure_path_in_roots(raw_path, &roots)
}

fn prepare_covers_cache_directory(app: &AppHandle) -> Result<PathBuf, String> {
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

fn scan_path_metadata_with_context(
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

fn scan_path_metadata_inner(
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
fn save_scanned_cover_to_cache(
    app: &AppHandle,
    track_path: &str,
    bytes: &[u8],
) -> Result<String, String> {
    let covers_directory = prepare_covers_cache_directory(app)?;
    save_scanned_cover_to_dir(&covers_directory, track_path, bytes)
}

fn save_scanned_cover_to_dir(
    covers_directory: &Path,
    track_path: &str,
    bytes: &[u8],
) -> Result<String, String> {
    let hash = Sha256::digest(track_path.as_bytes());
    let file_name = format!("{:x}.jpg", hash);
    let cover_path = covers_directory.join(&file_name);

    // Atajo rápido: si la miniatura ya existe en caché, no decodificar ni tocar el disco.
    if cover_path.is_file() {
        return Ok(cover_path.to_string_lossy().into_owned());
    }

    let written = (|| -> Result<(), String> {
        let image =
            image::load_from_memory(bytes).map_err(|error| format!("Carátula inválida: {error}"))?;
        // FilterType::Triangle reduce drásticamente el uso de CPU/RAM en escaneos masivos frente a Lanczos3
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
        fs::write(&cover_path, output.into_inner()).map_err(|e| e.to_string())
    })();

    if let Err(error) = written {
        let ext = if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
            "png"
        } else {
            "img"
        };
        let fallback = covers_directory.join(format!("{:x}.{ext}", hash));
        if !fallback.is_file() {
            fs::write(&fallback, bytes).map_err(|e| format!("{error}; fallback: {e}"))?;
        }
        return Ok(fallback.to_string_lossy().into_owned());
    }

    Ok(cover_path.to_string_lossy().into_owned())
}

#[tauri::command]
fn scan_file_metadata(
    app: AppHandle,
    path: String,
    include_lyrics: Option<bool>,
) -> Result<ScannedTrackMetadata, String> {
    scan_path_metadata_inner(&app, &path, include_lyrics.unwrap_or(false))
}

#[tauri::command]
fn scan_files_metadata(
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

fn parse_cover_bytes(
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
fn update_track_tags(app: AppHandle, update: TrackTagUpdate) -> Result<(), String> {
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrackMetadataMatch {
    title: String,
    artist: String,
    album: String,
    date: String,
    track_number: Option<String>,
    release_mbid: Option<String>,
    recording_mbid: Option<String>,
    disc_number: Option<String>,
    genre: Option<String>,
    release_group: Option<String>,
    country: Option<String>,
    media_format: Option<String>,
    barcode: Option<String>,
    release_status: Option<String>,
    length: Option<String>,
    disambiguation: Option<String>,
}

fn metadata_match_from_recording(recording: &serde_json::Value) -> Option<TrackMetadataMatch> {
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

static SHARED_HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn musicbrainz_client() -> Result<reqwest::Client, String> {
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

async fn fetch_musicbrainz_recording(
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
async fn fetch_metadata_by_text(
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

fn calculate_chromaprint(path: &Path) -> Result<(String, u32), String> {
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
async fn fetch_metadata_by_fingerprint(
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
async fn fetch_cover_art(release_mbid: String) -> Result<String, String> {
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
struct LrclibSearchRequest {
    #[serde(rename = "track_name")]
    track_name: String,
    #[serde(rename = "artist_name")]
    artist_name: String,
}

#[tauri::command]
async fn search_lrclib_lyrics(request: LrclibSearchRequest) -> Result<serde_json::Value, String> {
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

fn collect_music_files(
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
async fn scan_music_library(app: AppHandle) -> Result<MusicLibrary, String> {
    CANCEL_MUSIC_LIBRARY_SCAN.store(false, Ordering::Relaxed);
    tauri::async_runtime::spawn_blocking(move || {
        let directories = read_music_directories(&app)?;
        let mut files = Vec::new();
        for directory in &directories {
            if CANCEL_MUSIC_LIBRARY_SCAN.load(Ordering::Relaxed) {
                break;
            }
            let root = PathBuf::from(&directory.path);
            if !root.is_dir() {
                continue;
            }
            app.asset_protocol_scope()
                .allow_directory(&root, true)
                .map_err(|error| error.to_string())?;
            let excluded: std::collections::HashSet<String> = directory
                .excluded_subfolders
                .iter()
                .map(|item| normalize_path_key(item))
                .collect();
            collect_music_files(&root, &root, &directory.name, &mut files, &excluded)?;
        }
        files.sort_by(|left, right| right.last_modified.cmp(&left.last_modified));
        Ok(MusicLibrary { directories, files })
    })
    .await
    .map_err(|error| format!("No se pudo completar el escaneo de la biblioteca: {error}"))?
}

#[tauri::command]
fn cancel_music_library_scan() {
    CANCEL_MUSIC_LIBRARY_SCAN.store(true, Ordering::Relaxed);
}

/// AppUserModelID explícito (mismo que `identifier` en tauri.conf.json).
/// Debe llamarse antes de mostrar UI / crear WebView2.
#[cfg(windows)]
pub fn set_app_user_model_id() {
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
    let aumid: Vec<u16> = "com.resonance.app"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        if let Err(error) = SetCurrentProcessExplicitAppUserModelID(PCWSTR(aumid.as_ptr())) {
            eprintln!("[Resonance] AppUserModelID: {error}");
        }
    }
}

#[cfg(not(windows))]
pub fn set_app_user_model_id() {}

/// Ruta al icono .ico de la app (junto al .exe en release, o icons/ en dev).
#[cfg(windows)]

/// Renombra en el mezclador las sesiones de audio de WebView2 / Chromium a "Resonance"
/// y les asigna el icono de la app (workaround Core Audio; limitación de Microsoft).
/// Antes se reetiquetaban sesiones ajenas del mezclador como «Resonance» (heurística
/// demasiado amplia: renombraba otras apps). Ya no se toca ninguna sesión externa.
/// WebView2 va con --mute-audio; el audio real solo sale de rodio.



#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    set_app_user_model_id();
    tauri::Builder::default()
        .manage(MusicWatcher::default())
        .manage(native_audio::NativeAudioState::default())
        .manage(WindowsMediaSession::default())
        .manage(GlobalShortcutRegistry::default())
        .manage(DiscordRpcState::default())
        .manage(DiscordCoverCache::default())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = window.unminimize() {
                    eprintln!("No se pudo restaurar la ventana de Resonance: {error}");
                }
                if let Err(error) = window.show() {
                    eprintln!("No se pudo mostrar la instancia existente de Resonance: {error}");
                }
                if let Err(error) = window.set_focus() {
                    eprintln!("No se pudo enfocar la instancia existente de Resonance: {error}");
                }
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            build_system_tray(app)?;
            // Entregar AppHandle al motor de audio nativo para emitir `audio-energy` (Visual+)
            app.state::<native_audio::NativeAudioState>()
                .set_app_handle(app.handle().clone());
            // Caché persistente de waveforms en el directorio de datos de la app
            match app_data_storage_directory(app.handle()) {
                Ok(dir) => native_audio::init_waveform_cache_dir(dir),
                Err(error) => eprintln!(
                    "No se pudo inicializar la caché de waveforms en disco: {error}"
                ),
            }
            if let Err(error) =
                initialize_discord_cover_cache(app.handle(), &app.state::<DiscordCoverCache>())
            {
                eprintln!("No se pudo inicializar la caché de carátulas de Discord: {error}");
            }
            if let Err(error) =
                initialize_windows_media_session(app.handle(), &app.state::<WindowsMediaSession>())
            {
                eprintln!("No se pudo inicializar la sesión multimedia de Windows: {error}");
            }
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = restore_window_bounds(&window) {
                    eprintln!(
                        "No se pudo restaurar el tamaño y la posición de la ventana: {error}"
                    );
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                if let Err(error) = persist_window_bounds_from_window(window) {
                    eprintln!("No se pudo guardar el tamaño y la posición de la ventana: {error}");
                }
                if MINIMIZE_TO_TRAY.load(Ordering::Relaxed) {
                    api.prevent_close();
                    if let Err(error) = window.hide() {
                        eprintln!("No se pudo ocultar Resonance en la bandeja: {error}");
                    } else {
                        set_tray_visible(window.app_handle(), true);
                    }
                }
            }
            WindowEvent::Resized(size)
                if MINIMIZE_TO_TRAY.load(Ordering::Relaxed)
                    && (size.width == 0 || size.height == 0) =>
            {
                if let Err(error) = window.hide() {
                    eprintln!("No se pudo minimizar Resonance en la bandeja: {error}");
                } else {
                    set_tray_visible(window.app_handle(), true);
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_storage_info,
            open_storage_directory,
            set_storage_location,
            load_app_settings,
            save_app_settings,
            save_window_bounds,
            set_discord_rpc_enabled,
            update_discord_presence,
            add_music_directory,
            select_music_file,
            save_m3u8_file,
            save_settings_backup,
            remove_music_directory,
            list_music_subfolders,
            set_music_subfolder_excluded,
            get_music_directories,
            replace_music_directories,
            scan_music_library,
            cancel_music_library_scan,
            get_cached_music_library,
            save_cached_music_library,
            save_playlist_cover,
            get_library_cache_size,
            clear_library_cache,
            configure_music_watcher,
            set_minimize_to_tray,
            set_global_shortcuts,
            update_windows_media_metadata,
            update_windows_media_playback,
            seek_windows_media_position,
            delete_music_file,
            update_track_tags,
            read_track_text_metadata,
            scan_file_metadata,
            scan_files_metadata,
            fetch_metadata_by_text,
            fetch_metadata_by_fingerprint,
            fetch_cover_art,
            search_lrclib_lyrics,
            scan_missing_replay_gain,
            cancel_replay_gain_scan,
            set_taskbar_playback_progress,
            get_performance_metrics,
            native_audio::native_audio_load,
            native_audio::native_audio_crossfade,
            native_audio::native_audio_play,
            native_audio::native_audio_pause,
            native_audio::native_audio_seek,
            native_audio::native_audio_set_volume,
            native_audio::native_audio_set_eq,
            native_audio::native_audio_set_rate,
            native_audio::native_audio_list_output_devices,
            native_audio::native_audio_set_output_device,
            native_audio::native_audio_stop,
            native_audio::native_audio_status,
            native_audio::native_audio_waveform_peaks
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


#[cfg(test)]
mod tests {
    use super::{
        copy_directory_contents, copy_directory_contents_if_missing, is_valid_app_setting,
    };
    use std::{fs, time::SystemTime};

    #[test]
    fn visual_plus_settings_accept_known_shapes() {
        let valid: serde_json::Value = serde_json::json!({
            "enabled": false,
            "theme": "shooting_stars",
            "starCount": 120,
            "shootingStarCount": 2,
            "shootingInterval": 4,
            "shootingSpeed": 100,
            "trailLength": 170
        });
        let other_theme: serde_json::Value =
            serde_json::json!({ "enabled": true, "theme": "atmospheric" });
        let with_extra: serde_json::Value =
            serde_json::json!({ "enabled": true, "theme": "shooting_stars", "extra": true });

        assert!(is_valid_app_setting("visual_plus", &valid));
        assert!(is_valid_app_setting("visual_plus", &other_theme));
        assert!(is_valid_app_setting("visual_plus", &with_extra));
        assert!(!is_valid_app_setting(
            "visual_plus",
            &serde_json::Value::String("nope".into())
        ));
    }

    #[test]
    fn new_prefixed_settings_are_persistable_as_strings() {
        let volume = serde_json::Value::String("72".to_string());
        let visual_plus = serde_json::Value::String(
            serde_json::json!({
                "enabled": true,
                "theme": "atmospheric",
                "particleCount": 90,
                "particleColorMode": "custom",
                "particleColor": "#c084fc",
                "firefliesEnabled": true,
                "rainEnabled": true
            })
            .to_string(),
        );

        assert!(is_valid_app_setting("pn_volume", &volume));
        assert!(is_valid_app_setting("pn_visual_plus", &visual_plus));
        assert!(!is_valid_app_setting(
            "pn_volume",
            &serde_json::json!(72)
        ));
    }

    #[test]
    fn storage_migration_copies_nested_files() {
        let unique_id = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system clock should be after UNIX epoch")
            .as_nanos();
        let test_root = std::env::temp_dir().join(format!(
            "resonance-storage-migration-{}-{unique_id}",
            std::process::id()
        ));
        let source = test_root.join("source");
        let destination = test_root.join("destination");
        let nested_directory = source.join("library-cache").join("covers");
        fs::create_dir_all(&nested_directory).expect("source directories should be created");
        fs::write(source.join("music-directories.json"), b"[]")
            .expect("configuration should be written");
        fs::write(nested_directory.join("cover.jpg"), b"cover").expect("cover should be written");

        copy_directory_contents(&source, &destination).expect("storage should be copied");

        assert_eq!(
            fs::read(destination.join("music-directories.json"))
                .expect("configuration should be copied"),
            b"[]"
        );
        assert_eq!(
            fs::read(
                destination
                    .join("library-cache")
                    .join("covers")
                    .join("cover.jpg")
            )
            .expect("cover should be copied"),
            b"cover"
        );
        fs::remove_dir_all(test_root).expect("test data should be removed");
    }

    #[test]
    fn storage_migration_preserves_existing_files_and_copies_missing_ones() {
        let unique_id = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system clock should be after UNIX epoch")
            .as_nanos();
        let test_root = std::env::temp_dir().join(format!(
            "resonance-storage-merge-{}-{unique_id}",
            std::process::id()
        ));
        let source = test_root.join("legacy");
        let destination = test_root.join("ResonanceMusicPlayer");
        fs::create_dir_all(source.join("library-cache"))
            .expect("legacy cache directory should be created");
        fs::create_dir_all(destination.join("library-cache"))
            .expect("destination cache directory should be created");
        fs::write(source.join("settings.json"), b"legacy")
            .expect("legacy settings should be written");
        fs::write(destination.join("settings.json"), b"current")
            .expect("current settings should be written");
        fs::write(source.join("library-cache").join("cover.jpg"), b"cover")
            .expect("legacy cover should be written");

        copy_directory_contents_if_missing(&source, &destination)
            .expect("legacy data should be merged");

        assert_eq!(
            fs::read(destination.join("settings.json")).expect("settings should remain"),
            b"current"
        );
        assert_eq!(
            fs::read(destination.join("library-cache").join("cover.jpg"))
                .expect("missing cache file should be copied"),
            b"cover"
        );
        fs::remove_dir_all(test_root).expect("test data should be removed");
    }

    #[test]
    fn shortcut_default_and_recorded_keys_parse() {
        for shortcut in [
            "MediaPlayPause",
            "MediaTrackNext",
            "MediaTrackPrevious",
            "AudioVolumeUp",
            "AudioVolumeDown",
            "AudioVolumeMute",
            "Space",
            "Ctrl+ArrowRight",
            "Ctrl+ArrowLeft",
            "Ctrl+Alt+ArrowRight",
            "Ctrl+Alt+ArrowLeft",
            "Ctrl+ArrowUp",
            "Ctrl+ArrowDown",
            "Ctrl+Shift+M",
        ] {
            assert!(
                shortcut
                    .parse::<tauri_plugin_global_shortcut::Shortcut>()
                    .is_ok(),
                "Shortcut should parse: {shortcut}"
            );
        }
    }
}