//! Forma de onda: cálculo de picos, caché en memoria y en disco, y comando waveform_peaks.

use super::*;

/// Caché en memoria de waveforms: path → (mtime, bar_count, peaks).
pub struct WaveformCacheEntry {
    pub mtime_secs: u64,
    pub bar_count: usize,
    pub peaks: Vec<f32>,
}

pub fn waveform_mem_cache() -> &'static Mutex<HashMap<String, WaveformCacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<String, WaveformCacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Directorio de caché en disco: `{AppData}/ResonanceMusicPlayer/waveform-cache/`
pub static WAVEFORM_DISK_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Llamar desde el setup de Tauri con el directorio de datos de la app.
pub fn init_waveform_cache_dir(app_data_dir: PathBuf) {
    let dir = app_data_dir.join("waveform-cache");
    let _ = fs::create_dir_all(&dir);
    let _ = WAVEFORM_DISK_DIR.set(dir);
}

pub fn file_mtime_secs(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Nombre de archivo estable (hash) para no usar rutas con caracteres especiales.
pub fn waveform_disk_filename(path: &str, mtime: u64, bars: usize) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    hasher.update(mtime.to_le_bytes());
    hasher.update((bars as u32).to_le_bytes());
    format!("{:x}.wfc", hasher.finalize())
}

pub const WFC_MAGIC: &[u8; 4] = b"RMPW";
// v10: RMS dominante + normalización local (variación continua tipo AIMP)
pub const WFC_VERSION: u8 = 10;

pub fn path_fingerprint(path: &str) -> [u8; 8] {
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    let full = hasher.finalize();
    let mut out = [0u8; 8];
    out.copy_from_slice(&full[..8]);
    out
}

pub fn write_waveform_disk(path: &str, mtime: u64, bars: usize, peaks: &[f32]) {
    let Some(dir) = WAVEFORM_DISK_DIR.get() else {
        return;
    };
    let file_path = dir.join(waveform_disk_filename(path, mtime, bars));
    // magic(4) + ver(1) + bars(4) + mtime(8) + path_fp(8) + peaks
    let mut buf: Vec<u8> = Vec::with_capacity(25 + peaks.len() * 4);
    buf.extend_from_slice(WFC_MAGIC);
    buf.push(WFC_VERSION);
    buf.extend_from_slice(&(bars as u32).to_le_bytes());
    buf.extend_from_slice(&mtime.to_le_bytes());
    buf.extend_from_slice(&path_fingerprint(path));
    for &p in peaks {
        buf.extend_from_slice(&p.to_le_bytes());
    }
    let tmp = file_path.with_extension("wfc.tmp");
    if fs::write(&tmp, &buf).is_ok() {
        let _ = fs::rename(&tmp, &file_path);
    }
}

pub fn read_waveform_disk(path: &str, mtime: u64, bars: usize) -> Option<Vec<f32>> {
    let dir = WAVEFORM_DISK_DIR.get()?;
    let file_path = dir.join(waveform_disk_filename(path, mtime, bars));
    let data = fs::read(&file_path).ok()?;
    if data.len() < 25 {
        return None;
    }
    if &data[0..4] != WFC_MAGIC || data[4] != WFC_VERSION {
        return None;
    }
    let stored_bars = u32::from_le_bytes(data[5..9].try_into().ok()?) as usize;
    let stored_mtime = u64::from_le_bytes(data[9..17].try_into().ok()?);
    let stored_fp: [u8; 8] = data[17..25].try_into().ok()?;
    if stored_bars != bars || stored_mtime != mtime || stored_fp != path_fingerprint(path) {
        return None;
    }
    let expected = 25 + bars * 4;
    if data.len() != expected {
        return None;
    }
    let mut peaks = Vec::with_capacity(bars);
    for i in 0..bars {
        let off = 25 + i * 4;
        let bytes: [u8; 4] = data[off..off + 4].try_into().ok()?;
        peaks.push(f32::from_le_bytes(bytes));
    }
    Some(peaks)
}

/// Limpia entradas de disco huérfanas si hay demasiadas (no bloquea el hot path).
pub fn maybe_trim_waveform_disk_cache() {
    let Some(dir) = WAVEFORM_DISK_DIR.get() else {
        return;
    };
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("wfc") {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        files.push((modified, path));
    }
    const MAX_FILES: usize = 400;
    if files.len() <= MAX_FILES {
        return;
    }
    files.sort_by_key(|(t, _)| *t);
    let remove_count = files.len() - MAX_FILES;
    for (_, path) in files.into_iter().take(remove_count) {
        let _ = fs::remove_file(path);
    }
}

/// Extrae picos de amplitud (0.0–1.0) de un archivo para la waveform de progreso.
pub fn compute_waveform_peaks(path: &Path, bar_count: usize) -> Result<Vec<f32>, String> {
    let bars = bar_count.clamp(16, 512);
    let file = File::open(path).map_err(|e| format!("No se pudo abrir el archivo: {e}"))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions {
                enable_gapless: true,
                ..Default::default()
            },
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("No se pudo leer el contenedor: {e}"))?;

    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| "No se encontró una pista de audio decodificable.".to_string())?
        .clone();

    let track_id = track.id;
    let channels = track
        .codec_params
        .channels
        .map(|c| c.count() as usize)
        .unwrap_or(2)
        .max(1);

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("No se pudo crear el decoder: {e}"))?;

    // Algoritmo estándar de preview (Audacity / editores):
    // por ventana → pico + RMS; el RMS refleja la energía musical y evita
    // la "pared plana" de masters muy comprimidos donde el pico es casi constante.
    const WINDOW_FRAMES: usize = 512;
    let mut coarse_peak: Vec<f32> = Vec::with_capacity(8192);
    let mut coarse_rms: Vec<f32> = Vec::with_capacity(8192);
    let mut win_peak: f32 = 0.0;
    let mut win_sum_sq: f64 = 0.0;
    let mut win_frames: usize = 0;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(SymphoniaError::IoError(ref e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                break;
            }
            Err(_) => break,
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(_) => break,
        };

        let spec = *decoded.spec();
        let mut buffer = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
        buffer.copy_interleaved_ref(decoded);
        let samples = buffer.samples();
        let ch = channels;

        let mut i = 0;
        while i + ch <= samples.len() {
            let mut frame_peak = 0.0f32;
            let mut frame_sum_sq = 0.0f64;
            for c in 0..ch {
                let s = samples[i + c];
                frame_peak = frame_peak.max(s.abs());
                frame_sum_sq += (s as f64) * (s as f64);
            }
            i += ch;
            win_peak = win_peak.max(frame_peak);
            win_sum_sq += frame_sum_sq / ch as f64;
            win_frames += 1;
            if win_frames >= WINDOW_FRAMES {
                let rms = (win_sum_sq / win_frames as f64).sqrt() as f32;
                coarse_peak.push(win_peak);
                coarse_rms.push(rms);
                win_peak = 0.0;
                win_sum_sq = 0.0;
                win_frames = 0;
            }
        }
    }

    if win_frames > 0 {
        let rms = (win_sum_sq / win_frames as f64).sqrt() as f32;
        coarse_peak.push(win_peak);
        coarse_rms.push(rms);
    }

    if coarse_peak.is_empty() {
        return Ok(vec![0.22; bars]);
    }

    // Media del RMS por barra (MAX del pico aplastaba masters comprimidos).
    let mut energy = vec![0.0f32; bars];
    let n = coarse_peak.len();
    for bar in 0..bars {
        let start = (bar * n) / bars;
        let end = (((bar + 1) * n) / bars).max(start + 1).min(n);
        let mut peak_sum = 0.0f32;
        let mut rms_sum = 0.0f32;
        for j in start..end {
            peak_sum += coarse_peak[j];
            rms_sum += coarse_rms[j];
        }
        let inv = 1.0 / (end - start) as f32;
        energy[bar] = peak_sum * inv * 0.18 + rms_sum * inv * 0.82;
    }

    // Contraste LOCAL: cada barra / máximo del vecindario → siempre sube y baja
    // (es lo que hace que AIMP no se vea como un muro plano).
    let radius = ((bars as f32) * 0.10).round().max(4.0) as usize;
    let mut local_norm = vec![0.0f32; bars];
    for i in 0..bars {
        let lo = i.saturating_sub(radius);
        let hi = (i + radius + 1).min(bars);
        let mut local_max = 1e-8f32;
        for v in &energy[lo..hi] {
            if *v > local_max {
                local_max = *v;
            }
        }
        local_norm[i] = (energy[i] / local_max).clamp(0.0, 1.0);
    }

    let global_max = energy.iter().cloned().fold(1e-8f32, f32::max);
    let mut peaks = vec![0.0f32; bars];
    for i in 0..bars {
        let abs_n = (energy[i] / global_max).clamp(0.0, 1.0);
        peaks[i] = local_norm[i] * 0.55 + abs_n * 0.45;
    }

    let mut sorted = peaks.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let pct = |p: f32| -> f32 {
        let idx = ((sorted.len() as f32 - 1.0) * p).round() as usize;
        sorted[idx.min(sorted.len() - 1)]
    };
    let floor = pct(0.06);
    let ceil = pct(0.94).max(floor + 1e-6);

    for p in &mut peaks {
        let mut t = ((*p - floor) / (ceil - floor)).clamp(0.0, 1.0);
        t = t.powf(0.55);
        *p = 0.05 + t * 0.95;
    }

    Ok(peaks)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveformPeaksResult {
    pub path: String,
    pub peaks: Vec<f32>,
}

pub fn mem_cache_key(path: &str, bars: usize) -> String {
    format!("{path}\u{1}{bars}")
}

pub fn store_mem_cache(path: &str, mtime: u64, bars: usize, peaks: &[f32]) {
    // Tope bajo: ~24 pistas × 200 f32 ≈ poco RAM; el disco (.wfc) es la caché durable
    const MAX_ENTRIES: usize = 24;
    if let Ok(mut cache) = waveform_mem_cache().lock() {
        if cache.len() >= MAX_ENTRIES {
            let keys: Vec<String> = cache.keys().take(MAX_ENTRIES / 2).cloned().collect();
            for k in keys {
                cache.remove(&k);
            }
        }
        cache.insert(
            mem_cache_key(path, bars),
            WaveformCacheEntry {
                mtime_secs: mtime,
                bar_count: bars,
                peaks: peaks.to_vec(),
            },
        );
    }
}

#[tauri::command]
pub async fn native_audio_waveform_peaks(
    path: String,
    bar_count: Option<usize>,
) -> Result<WaveformPeaksResult, String> {
    let bars = bar_count.unwrap_or(200).clamp(16, 512);
    let path_buf = PathBuf::from(&path);
    if !path_buf.is_file() {
        return Err(format!("El archivo no existe: {path}"));
    }

    let mtime = file_mtime_secs(&path_buf);
    let key = mem_cache_key(&path, bars);

    // 1) RAM
    if let Ok(cache) = waveform_mem_cache().lock() {
        if let Some(entry) = cache.get(&key) {
            if entry.mtime_secs == mtime && entry.bar_count == bars {
                return Ok(WaveformPeaksResult {
                    path: path.clone(),
                    peaks: entry.peaks.clone(),
                });
            }
        }
    }

    // 2) Disco
    if let Some(peaks) = read_waveform_disk(&path, mtime, bars) {
        store_mem_cache(&path, mtime, bars, &peaks);
        return Ok(WaveformPeaksResult {
            path: path.clone(),
            peaks,
        });
    }

    // 3) Análisis
    let path_for_compute = path_buf.clone();
    let peaks = tauri::async_runtime::spawn_blocking(move || {
        compute_waveform_peaks(&path_for_compute, bars)
    })
    .await
    .map_err(|e| format!("Error al calcular la waveform: {e}"))??;

    write_waveform_disk(&path, mtime, bars, &peaks);
    maybe_trim_waveform_disk_cache();
    store_mem_cache(&path, mtime, bars, &peaks);

    Ok(WaveformPeaksResult { path, peaks })
}
