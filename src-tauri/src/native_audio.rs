//! Reproducción nativa con seek rápido (symphonia) y hilo dedicado.
//! El stream de rodio/cpal NO es Send → vive en este hilo; comandos por canal.

use lofty::file::AudioFile;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
        mpsc::{self, Receiver, Sender},
        Arc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, State};

use rodio::Source;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::{FormatOptions, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioStatus {
    pub path: Option<String>,
    pub playing: bool,
    pub position_seconds: f64,
    pub duration_seconds: f64,
    pub volume: f32,
    pub ended: bool,
    /// True mientras dura un fundido cruzado entre dos pistas.
    pub crossfading: bool,
}

enum AudioCmd {
    Load {
        path: String,
        auto_play: bool,
        volume: Option<f32>,
        fade_in_secs: f64,
        reply: Sender<Result<NativeAudioStatus, String>>,
    },
    /// Fundido cruzado real: la pista actual baja de volumen y la nueva sube a la vez.
    Crossfade {
        path: String,
        duration_secs: f64,
        volume: Option<f32>,
        reply: Sender<Result<NativeAudioStatus, String>>,
    },
    Play {
        fade_in_secs: f64,
        reply: Sender<Result<NativeAudioStatus, String>>,
    },
    Pause {
        fade_out_secs: f64,
        reply: Sender<Result<NativeAudioStatus, String>>,
    },
    Seek {
        position_seconds: f64,
        reply: Sender<Result<NativeAudioStatus, String>>,
    },
    SetVolume {
        volume: f32,
        reply: Sender<Result<NativeAudioStatus, String>>,
    },
    /// Ecualizador gráfico nativo (20 bandas, dB).
    SetEq {
        enabled: bool,
        gains_db: Vec<f32>,
        reply: Sender<Result<NativeAudioStatus, String>>,
    },
    /// Velocidad efectiva (1.0 = normal; el tono se combina en el frontend).
    SetRate {
        rate: f32,
        reply: Sender<Result<NativeAudioStatus, String>>,
    },
    /// Cambiar dispositivo de salida (`None` = predeterminado). WASAPI compartido.
    SetOutputDevice {
        device_id: Option<String>,
        reply: Sender<Result<NativeAudioStatus, String>>,
    },
    Stop {
        reply: Sender<Result<NativeAudioStatus, String>>,
    },
    Status {
        reply: Sender<Result<NativeAudioStatus, String>>,
    },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputDeviceInfo {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

pub struct NativeAudioState {
    tx: Mutex<Sender<AudioCmd>>,
    /// Energía RMS normalizada (0.0–1.0) como bits de f32, actualizada desde el hilo de audio.
    #[allow(dead_code)]
    energy: Arc<AtomicU32>,
    /// AppHandle para emitir el evento `audio-energy` hacia el frontend (Visual+).
    app: Mutex<Option<AppHandle>>,
    /// Canal de un solo uso para entregar AppHandle al hilo de audio tras el setup.
    app_tx: Mutex<Option<Sender<AppHandle>>>,
}

impl Default for NativeAudioState {
    fn default() -> Self {
        let energy = Arc::new(AtomicU32::new(0f32.to_bits()));
        let (tx, rx) = mpsc::channel::<AudioCmd>();
        // Canal opcional para inyectar AppHandle tras el setup de Tauri
        let (app_tx, app_rx) = mpsc::channel::<AppHandle>();
        let energy_for_thread = Arc::clone(&energy);
        thread::Builder::new()
            .name("resonance-native-audio".into())
            .spawn(move || audio_thread_main(rx, energy_for_thread, app_rx))
            .expect("No se pudo crear el hilo de audio nativo");
        Self {
            tx: Mutex::new(tx),
            energy,
            app: Mutex::new(None),
            app_tx: Mutex::new(Some(app_tx)),
        }
    }
}

impl NativeAudioState {
    /// Debe llamarse desde el setup de Tauri para habilitar la emisión de energía a Visual+.
    pub fn set_app_handle(&self, app: AppHandle) {
        if let Ok(mut slot) = self.app.lock() {
            *slot = Some(app.clone());
        }
        if let Ok(mut guard) = self.app_tx.lock() {
            if let Some(tx) = guard.take() {
                let _ = tx.send(app);
            }
        }
    }

    /// Energía actual (0.0–1.0) para lectura síncrona si se necesita.
    #[allow(dead_code)]
    pub fn current_energy(&self) -> f32 {
        f32::from_bits(self.energy.load(Ordering::Relaxed)).clamp(0.0, 1.0)
    }
}

/// Frecuencias centrales del EQ gráfico (20 bandas, estilo AIMP).
pub const EQ_FREQUENCIES_HZ: [f32; 20] = [
    31.0, 43.0, 63.0, 87.0, 125.0, 175.0, 250.0, 350.0, 500.0, 700.0, 1000.0, 1400.0, 2000.0,
    2800.0, 4000.0, 5600.0, 8000.0, 11200.0, 16000.0, 22000.0,
];

/// Estado compartido del EQ (UI → hilo de audio).
#[derive(Clone)]
struct SharedEq {
    enabled: Arc<AtomicBool>,
    /// bits de f32 por banda (dB)
    gains_bits: Arc<[AtomicU32; 20]>,
    /// Incrementa cuando cambian gains/enabled → rebuild de filtros en el Source
    generation: Arc<AtomicU64>,
}

impl SharedEq {
    fn new() -> Self {
        Self {
            enabled: Arc::new(AtomicBool::new(false)),
            gains_bits: Arc::new(std::array::from_fn(|_| AtomicU32::new(0f32.to_bits()))),
            generation: Arc::new(AtomicU64::new(0)),
        }
    }

    fn set(&self, enabled: bool, gains_db: &[f32]) {
        self.enabled.store(enabled, Ordering::Release);
        for i in 0..20 {
            let g = gains_db.get(i).copied().unwrap_or(0.0).clamp(-15.0, 15.0);
            self.gains_bits[i].store(g.to_bits(), Ordering::Release);
        }
        self.generation.fetch_add(1, Ordering::Release);
    }

    fn gains_db(&self) -> [f32; 20] {
        std::array::from_fn(|i| f32::from_bits(self.gains_bits[i].load(Ordering::Acquire)))
    }
}

/// Velocidad efectiva compartida (1.0 = normal). Tono = rate * 2^(semitonos/12) en el frontend.
#[derive(Clone)]
struct SharedRate {
    rate_bits: Arc<AtomicU32>,
}

impl SharedRate {
    fn new() -> Self {
        Self {
            rate_bits: Arc::new(AtomicU32::new(1.0f32.to_bits())),
        }
    }

    fn set(&self, rate: f32) {
        let r = rate.clamp(0.25, 4.0);
        self.rate_bits.store(r.to_bits(), Ordering::Release);
    }

    fn get(&self) -> f32 {
        f32::from_bits(self.rate_bits.load(Ordering::Acquire)).clamp(0.25, 4.0)
    }
}

/// Cambia tempo/tono saltando o repitiendo frames (igual que HTML audio.playbackRate).
struct RateSource<S>
where
    S: Source<Item = f32>,
{
    inner: S,
    shared: SharedRate,
    channels: usize,
    chan: usize,
    frame: Vec<f32>,
    have_frame: bool,
    phase: f64,
}

impl<S> RateSource<S>
where
    S: Source<Item = f32>,
{
    fn new(inner: S, shared: SharedRate) -> Self {
        let channels = inner.channels().max(1) as usize;
        Self {
            inner,
            shared,
            channels,
            chan: 0,
            frame: vec![0.0; channels],
            have_frame: false,
            phase: 0.0,
        }
    }

    fn pull_frame(&mut self) -> bool {
        for c in 0..self.channels {
            match self.inner.next() {
                Some(s) => self.frame[c] = s,
                None => {
                    if c == 0 {
                        return false;
                    }
                    // frame incompleto al final: rellenar con 0
                    self.frame[c] = 0.0;
                }
            }
        }
        self.have_frame = true;
        true
    }
}

impl<S> Iterator for RateSource<S>
where
    S: Source<Item = f32>,
{
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        let rate = self.shared.get() as f64;
        if (rate - 1.0).abs() < 0.001 {
            // Bypass: sin resampling
            return self.inner.next();
        }
        if !self.have_frame && !self.pull_frame() {
            return None;
        }
        if self.chan == 0 {
            self.phase += rate;
            while self.phase >= 1.0 {
                if !self.pull_frame() {
                    return None;
                }
                self.phase -= 1.0;
            }
        }
        let sample = self.frame[self.chan.min(self.channels - 1)];
        self.chan += 1;
        if self.chan >= self.channels {
            self.chan = 0;
        }
        Some(sample)
    }
}

impl<S> Source for RateSource<S>
where
    S: Source<Item = f32>,
{
    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len()
    }

    fn channels(&self) -> u16 {
        self.inner.channels()
    }

    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }
}

#[derive(Clone, Copy)]
struct BiquadCoeffs {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
}

impl BiquadCoeffs {
    fn identity() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
        }
    }

    /// Peaking EQ (RBJ cookbook).
    fn peaking(sample_rate: f32, freq: f32, gain_db: f32, q: f32) -> Self {
        let sr = sample_rate.max(1.0);
        let f = freq.clamp(20.0, sr * 0.49);
        let a = 10f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * f / sr;
        let alpha = w0.sin() / (2.0 * q.max(0.1));
        let cos_w0 = w0.cos();
        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * cos_w0;
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha / a;
        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
        }
    }
}

#[derive(Clone, Copy)]
struct BiquadState {
    z1: f32,
    z2: f32,
}

impl BiquadState {
    fn new() -> Self {
        Self { z1: 0.0, z2: 0.0 }
    }

    #[inline]
    fn process(&mut self, x: f32, c: &BiquadCoeffs) -> f32 {
        let y = c.b0 * x + self.z1;
        self.z1 = c.b1 * x - c.a1 * y + self.z2;
        self.z2 = c.b2 * x - c.a2 * y;
        y
    }
}

/// Aplica hasta 20 peaking EQ en samples interleaved (por canal).
struct EqSource<S>
where
    S: Source<Item = f32>,
{
    inner: S,
    shared: SharedEq,
    sample_rate: u32,
    channels: u16,
    channel_ix: u16,
    generation: u64,
    coeffs: [BiquadCoeffs; 20],
    /// estado [banda][canal] — máx 2 canales para el gráfico típico
    states: [[BiquadState; 2]; 20],
    bypass: bool,
}

impl<S> EqSource<S>
where
    S: Source<Item = f32>,
{
    fn new(inner: S, shared: SharedEq) -> Self {
        let sample_rate = inner.sample_rate().max(1);
        let channels = inner.channels().max(1);
        let mut s = Self {
            inner,
            shared,
            sample_rate,
            channels,
            channel_ix: 0,
            generation: u64::MAX,
            coeffs: [BiquadCoeffs::identity(); 20],
            states: [[BiquadState::new(); 2]; 20],
            bypass: true,
        };
        s.rebuild_if_needed();
        s
    }

    fn rebuild_if_needed(&mut self) {
        let gen = self.shared.generation.load(Ordering::Acquire);
        if gen == self.generation {
            return;
        }
        self.generation = gen;
        let enabled = self.shared.enabled.load(Ordering::Acquire);
        let gains = self.shared.gains_db();
        self.bypass = !enabled || gains.iter().all(|g| g.abs() < 0.05);
        let sr = self.sample_rate as f32;
        // Q ≈ √2 para separación de bandas de un gráfico denso
        let q = std::f32::consts::SQRT_2;
        for i in 0..20 {
            let g = gains[i];
            self.coeffs[i] = if !enabled || g.abs() < 0.05 {
                BiquadCoeffs::identity()
            } else {
                BiquadCoeffs::peaking(sr, EQ_FREQUENCIES_HZ[i], g, q)
            };
            self.states[i] = [BiquadState::new(); 2];
        }
    }
}

impl<S> Iterator for EqSource<S>
where
    S: Source<Item = f32>,
{
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        self.rebuild_if_needed();
        let mut sample = self.inner.next()?;
        if !self.bypass {
            let ch = (self.channel_ix as usize).min(1);
            for band in 0..20 {
                sample = self.states[band][ch].process(sample, &self.coeffs[band]);
            }
        }
        self.channel_ix += 1;
        if self.channel_ix >= self.channels {
            self.channel_ix = 0;
        }
        Some(sample)
    }
}

impl<S> Source for EqSource<S>
where
    S: Source<Item = f32>,
{
    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len()
    }

    fn channels(&self) -> u16 {
        self.inner.channels()
    }

    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }
}

/// Source wrapper que calcula RMS en tiempo real y cuenta frames consumidos
/// para el reloj de posición (más fiable que Instant del sistema).
struct MeasuringSource<S>
where
    S: Source<Item = f32>,
{
    inner: S,
    energy: Arc<AtomicU32>,
    /// Frames de audio consumidos (1 frame = 1 sample por canal).
    frames: Arc<AtomicU64>,
    channels: u16,
    interleave_pos: u16,
    sum_sq: f64,
    count: u32,
    window: u32,
}

impl<S> MeasuringSource<S>
where
    S: Source<Item = f32>,
{
    fn new(inner: S, energy: Arc<AtomicU32>, frames: Arc<AtomicU64>) -> Self {
        let channels = inner.channels().max(1);
        Self {
            inner,
            energy,
            frames,
            channels,
            interleave_pos: 0,
            sum_sq: 0.0,
            count: 0,
            // ~10–12 ms a 44.1 kHz estéreo → respuesta fluida para animaciones
            window: 512,
        }
    }

    fn push_sample(&mut self, sample: f32) {
        let s = sample as f64;
        self.sum_sq += s * s;
        self.count += 1;
        if self.count >= self.window {
            let rms = (self.sum_sq / self.count as f64).sqrt() as f32;
            // Ganancia similar a la del frontend Web Audio (* 4) para que Visual+ se sienta igual
            let level = (rms * 4.0).clamp(0.0, 1.0);
            self.energy.store(level.to_bits(), Ordering::Relaxed);
            self.sum_sq = 0.0;
            self.count = 0;
        }
        // Contar frames: un frame cada `channels` samples interleaved
        self.interleave_pos = self.interleave_pos.wrapping_add(1);
        if self.interleave_pos >= self.channels {
            self.interleave_pos = 0;
            self.frames.fetch_add(1, Ordering::Relaxed);
        }
    }
}

impl<S> Iterator for MeasuringSource<S>
where
    S: Source<Item = f32>,
{
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        let sample = self.inner.next()?;
        self.push_sample(sample);
        Some(sample)
    }
}

impl<S> Source for MeasuringSource<S>
where
    S: Source<Item = f32>,
{
    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len()
    }

    fn channels(&self) -> u16 {
        self.inner.channels()
    }

    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }
}

/// Source que decodifica con symphonia desde una posición (seek real, no skip de samples).
struct SymphoniaPlaySource {
    decoder: Box<dyn symphonia::core::codecs::Decoder>,
    format: Box<dyn symphonia::core::formats::FormatReader>,
    track_id: u32,
    sample_rate: u32,
    channels: u16,
    buffer: SampleBuffer<f32>,
    interleave_pos: usize,
    interleave: Vec<f32>,
    exhausted: bool,
}

impl SymphoniaPlaySource {
    fn open(path: &Path, start_secs: f64) -> Result<Self, String> {
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
        let sample_rate = track
            .codec_params
            .sample_rate
            .ok_or_else(|| "La pista no informa sample rate.".to_string())?;
        let channels = track
            .codec_params
            .channels
            .map(|c| c.count() as u16)
            .unwrap_or(2)
            .max(1);

        let mut decoder = symphonia::default::get_codecs()
            .make(&track.codec_params, &DecoderOptions::default())
            .map_err(|e| format!("No se pudo crear el decoder: {e}"))?;

        // Seek real por tiempo (rápido en FLAC/MP3/OGG con índices)
        if start_secs.is_finite() && start_secs > 0.05 {
            let whole = start_secs.floor().max(0.0) as u64;
            let frac = (start_secs - whole as f64).clamp(0.0, 1.0);
            let time = Time { seconds: whole, frac };
            let _ = format.seek(
                SeekMode::Accurate,
                SeekTo::Time {
                    track_id: Some(track_id),
                    time,
                },
            );
            decoder.reset();
        }

        let rate = sample_rate;
        let channels_mask = track
            .codec_params
            .channels
            .unwrap_or(symphonia::core::audio::Channels::FRONT_LEFT | symphonia::core::audio::Channels::FRONT_RIGHT);
        let spec = symphonia::core::audio::SignalSpec::new(rate, channels_mask);
        let buffer = SampleBuffer::<f32>::new(0, spec);

        Ok(Self {
            decoder,
            format,
            track_id,
            sample_rate: rate,
            channels,
            buffer,
            interleave_pos: 0,
            interleave: Vec::new(),
            exhausted: false,
        })
    }

    fn fill_interleave(&mut self) -> bool {
        if self.exhausted {
            return false;
        }
        loop {
            let packet = match self.format.next_packet() {
                Ok(p) => p,
                Err(SymphoniaError::ResetRequired) => {
                    self.decoder.reset();
                    continue;
                }
                Err(SymphoniaError::IoError(ref e))
                    if e.kind() == std::io::ErrorKind::UnexpectedEof =>
                {
                    self.exhausted = true;
                    return false;
                }
                Err(_) => {
                    self.exhausted = true;
                    return false;
                }
            };

            if packet.track_id() != self.track_id {
                continue;
            }

            match self.decoder.decode(&packet) {
                Ok(decoded) => {
                    self.buffer = SampleBuffer::<f32>::new(
                        decoded.capacity() as u64,
                        *decoded.spec(),
                    );
                    self.buffer.copy_interleaved_ref(decoded);
                    self.interleave = self.buffer.samples().to_vec();
                    self.interleave_pos = 0;
                    if !self.interleave.is_empty() {
                        return true;
                    }
                }
                Err(SymphoniaError::DecodeError(_)) => continue,
                Err(_) => {
                    self.exhausted = true;
                    return false;
                }
            }
        }
    }
}

impl Iterator for SymphoniaPlaySource {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        if self.interleave_pos >= self.interleave.len() {
            if !self.fill_interleave() {
                return None;
            }
        }
        let s = self.interleave[self.interleave_pos];
        self.interleave_pos += 1;
        Some(s)
    }
}

impl Source for SymphoniaPlaySource {
    fn current_frame_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> u16 {
        self.channels
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        None
    }
}

/// Fundido de entrada en la cadena de samples (no depende del hilo de comandos).
struct FadeInSource {
    inner: SymphoniaPlaySource,
    /// Samples interleaved ya emitidos dentro del fade
    pos: usize,
    /// Total de samples interleaved del fade
    fade_len: usize,
}

impl FadeInSource {
    fn new(inner: SymphoniaPlaySource, fade_secs: f64) -> Self {
        let sr = inner.sample_rate() as f64;
        let ch = inner.channels() as f64;
        let fade_len = if fade_secs <= 0.0 {
            0
        } else {
            ((fade_secs * sr * ch).round() as usize).max(1)
        };
        Self {
            inner,
            pos: 0,
            fade_len,
        }
    }
}

impl Iterator for FadeInSource {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        let sample = self.inner.next()?;
        if self.fade_len == 0 || self.pos >= self.fade_len {
            return Some(sample);
        }
        // Curva suave 0→1
        let t = self.pos as f32 / self.fade_len as f32;
        let gain = t * t * (3.0 - 2.0 * t);
        self.pos += 1;
        Some(sample * gain)
    }
}

impl Source for FadeInSource {
    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len()
    }

    fn channels(&self) -> u16 {
        self.inner.channels()
    }

    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }
}

#[derive(Clone, Copy)]
enum FadeKind {
    #[allow(dead_code)]
    In,
    Out,
}

/// Rampa por pasos (~20 ms). Más fiable que depender solo de Instant + curva.
struct FadeState {
    kind: FadeKind,
    steps_left: u32,
    current: f32,
    delta: f32,
    target: f32,
    pause_when_done: bool,
}

/// Rampa dual de volúmenes para crossfade (~20 ms por paso).
struct CrossfadeState {
    steps_left: u32,
    out_current: f32,
    out_delta: f32,
    in_current: f32,
    in_delta: f32,
}

struct Player {
    _stream: Option<rodio::OutputStream>,
    handle: Option<rodio::OutputStreamHandle>,
    sink: Option<rodio::Sink>,
    /// Sink de la pista entrante durante un crossfade.
    crossfade_sink: Option<rodio::Sink>,
    crossfade: Option<CrossfadeState>,
    path: Option<String>,
    volume: f32,
    applied_volume: f32,
    duration_secs: f64,
    offset_secs: f64,
    playing_since: Option<Instant>,
    fade: Option<FadeState>,
    /// Shared energy meter updated by MeasuringSource while samples are consumed.
    energy: Arc<AtomicU32>,
    /// Frames consumidos desde el último seek/load (reloj de audio real).
    frames_played: Arc<AtomicU64>,
    sample_rate: u32,
    eq: SharedEq,
    rate: SharedRate,
    /// Nombre del dispositivo cpal actual (`None` = default del sistema).
    output_device_id: Option<String>,
}

fn open_output_stream(
    device_id: Option<&str>,
) -> Result<(rodio::OutputStream, rodio::OutputStreamHandle), String> {
    use cpal::traits::{DeviceTrait, HostTrait};

    let host = cpal::default_host();
    if let Some(id) = device_id.filter(|s| !s.is_empty()) {
        let device = host
            .output_devices()
            .map_err(|e| format!("No se pudieron listar dispositivos: {e}"))?
            .find(|d| d.name().map(|n| n == id).unwrap_or(false))
            .ok_or_else(|| format!("Dispositivo de salida no encontrado: {id}"))?;
        // cpal en Windows usa WASAPI en modo compartido por defecto (no exclusive)
        rodio::OutputStream::try_from_device(&device)
            .map_err(|e| format!("No se pudo abrir el dispositivo «{id}»: {e}"))
    } else {
        rodio::OutputStream::try_default()
            .map_err(|e| format!("No se pudo abrir el dispositivo de audio: {e}"))
    }
}

impl Player {
    fn try_new(energy: Arc<AtomicU32>, eq: SharedEq, rate: SharedRate) -> Result<Self, String> {
        // No abrir WASAPI aquí: se abre en ensure_output() al primer load/play.
        Ok(Self {
            _stream: None,
            handle: None,
            sink: None,
            crossfade_sink: None,
            crossfade: None,
            path: None,
            volume: 0.8,
            applied_volume: 0.8,
            duration_secs: 0.0,
            offset_secs: 0.0,
            playing_since: None,
            fade: None,
            energy,
            frames_played: Arc::new(AtomicU64::new(0)),
            sample_rate: 44100,
            eq,
            rate,
            output_device_id: None,
        })
    }

    /// Abre el dispositivo de salida solo cuando hace falta (evita sesiones al iniciar la app).
    fn ensure_output(&mut self) -> Result<(), String> {
        if self.sink.is_some() && self.handle.is_some() && self._stream.is_some() {
            return Ok(());
        }
        let (stream, handle) = open_output_stream(self.output_device_id.as_deref())?;
        let sink = rodio::Sink::try_new(&handle)
            .map_err(|e| format!("No se pudo crear el sink de audio: {e}"))?;
        sink.set_volume(self.volume.clamp(0.0, 1.0));
        sink.pause();
        self._stream = Some(stream);
        self.handle = Some(handle);
        self.sink = Some(sink);
        self.applied_volume = self.volume.clamp(0.0, 1.0);
        Ok(())
    }

    fn sink_mut(&mut self) -> Result<&mut rodio::Sink, String> {
        self.ensure_output()?;
        self.sink
            .as_mut()
            .ok_or_else(|| "Sink de audio no disponible".to_string())
    }

    fn handle_ref(&mut self) -> Result<&rodio::OutputStreamHandle, String> {
        self.ensure_output()?;
        self.handle
            .as_ref()
            .ok_or_else(|| "Handle de audio no disponible".to_string())
    }

    /// Reabre el stream en otro dispositivo (WASAPI shared) y restaura pista/posición.
    fn set_output_device(&mut self, device_id: Option<String>) -> Result<(), String> {
        let was_playing = self.is_playing();
        let pos = self.position_seconds();
        let path = self.path.clone();
        let vol = self.volume;

        self.cancel_fade();
        self.abort_crossfade(false);
        if let Some(ref mut s) = self.sink {
            s.stop();
            s.clear();
        }
        self.playing_since = None;
        self.energy.store(0f32.to_bits(), Ordering::Relaxed);

        if let Some(cf) = self.crossfade_sink.take() {
            cf.stop();
            drop(cf);
        }
        // Tirar stream anterior para liberar la sesión WASAPI
        self.sink = None;
        self.handle = None;
        self._stream = None;

        self.output_device_id = device_id.filter(|s| !s.is_empty());
        self.ensure_output()?;
        self.applied_volume = vol.clamp(0.0, 1.0);
        self.offset_secs = pos;
        self.frames_played.store(0, Ordering::Relaxed);

        if let Some(ref p) = path {
            self.append_path(Path::new(p), pos, 0.0)?;
            if was_playing {
                self.sink_mut()?.play();
                self.playing_since = Some(Instant::now());
            } else {
                self.sink_mut()?.pause();
                self.playing_since = None;
            }
        }
        Ok(())
    }

    fn position_seconds(&self) -> f64 {
        // Frames de salida × rate = avance en el contenido de la pista
        let frames = self.frames_played.load(Ordering::Relaxed) as f64;
        let sr = self.sample_rate.max(1) as f64;
        let rate = self.rate.get() as f64;
        let mut pos = self.offset_secs + (frames / sr) * rate;
        if self.duration_secs > 0.0 {
            pos = pos.clamp(0.0, self.duration_secs);
        }
        pos.max(0.0)
    }

    fn is_playing(&self) -> bool {
        if self.crossfade.is_some() {
            return true;
        }
        self.playing_since.is_some() && !self.sink.as_ref().map(|s| s.is_paused()).unwrap_or(true) && !self.sink.as_ref().map(|s| s.empty()).unwrap_or(true)
    }

    fn is_crossfading(&self) -> bool {
        self.crossfade.is_some()
    }

    fn cancel_fade(&mut self) {
        self.fade = None;
    }

    /// Aborta un crossfade en curso: detiene el sink saliente y promueve el entrante (si hay).
    fn abort_crossfade(&mut self, promote_incoming: bool) {
        if let Some(incoming) = self.crossfade_sink.take() {
            if promote_incoming {
                if let Some(ref mut s) = self.sink { s.stop(); };
                self.sink = Some(incoming);
                self.apply_sink_volume(self.volume);
            } else {
                incoming.stop();
            }
        }
        self.crossfade = None;
    }

    fn apply_sink_volume(&mut self, vol: f32) {
        self.applied_volume = vol.clamp(0.0, 1.0);
        if let Some(ref mut s) = self.sink {
            s.set_volume(self.applied_volume);
        }
    }

    fn finish_pause_now(&mut self) {
        // Congelar posición en samples consumidos
        self.offset_secs = self.position_seconds();
        self.frames_played.store(0, Ordering::Relaxed);
        self.playing_since = None;
        if let Some(ref mut s) = self.sink {
            s.pause();
        }
        self.energy.store(0f32.to_bits(), Ordering::Relaxed);
    }

    /// steps cada ~20 ms
    #[allow(dead_code)]
    fn start_fade_in(&mut self, secs: f64) {
        if secs < 0.05 {
            self.cancel_fade();
            self.apply_sink_volume(self.volume);
            return;
        }
        let steps = ((secs * 50.0).round() as u32).clamp(2, 500);
        let target = self.volume.clamp(0.0, 1.0);
        self.apply_sink_volume(0.0);
        self.fade = Some(FadeState {
            kind: FadeKind::In,
            steps_left: steps,
            current: 0.0,
            delta: target / steps as f32,
            target,
            pause_when_done: false,
        });
    }

    fn start_fade_out(&mut self, secs: f64, pause_when_done: bool) {
        if secs < 0.05 {
            self.cancel_fade();
            if pause_when_done {
                self.finish_pause_now();
            }
            self.apply_sink_volume(self.volume);
            return;
        }
        let from = self.applied_volume.clamp(0.0, 1.0);
        let steps = ((secs * 50.0).round() as u32).clamp(2, 500);
        self.fade = Some(FadeState {
            kind: FadeKind::Out,
            steps_left: steps,
            current: from,
            delta: if steps > 0 { -from / steps as f32 } else { 0.0 },
            target: 0.0,
            pause_when_done,
        });
    }

    fn tick_fade(&mut self) {
        let Some(fade) = self.fade.as_mut() else {
            return;
        };
        if fade.steps_left == 0 {
            let pause = fade.pause_when_done;
            let kind = fade.kind;
            let target = fade.target;
            self.fade = None;
            self.apply_sink_volume(if matches!(kind, FadeKind::In) {
                self.volume
            } else {
                target
            });
            if matches!(kind, FadeKind::Out) && pause {
                self.finish_pause_now();
            }
            return;
        }
        fade.current = (fade.current + fade.delta).clamp(0.0, 1.0);
        fade.steps_left -= 1;
        let vol = fade.current;
        // aplicar sin invalidar el borrow de fade
        self.applied_volume = vol;
        if let Some(ref mut s) = self.sink { s.set_volume(vol); }
        if fade.steps_left == 0 {
            let pause = fade.pause_when_done;
            let kind = fade.kind;
            self.fade = None;
            if matches!(kind, FadeKind::In) {
                self.apply_sink_volume(self.volume);
            } else {
                self.apply_sink_volume(0.0);
                if pause {
                    self.finish_pause_now();
                }
            }
        }
    }

    fn status(&self) -> NativeAudioStatus {
        let playing = self.is_playing();
        let position = self.position_seconds();
        let crossfading = self.is_crossfading();
        // Durante crossfade no marcar "ended" de la pista saliente
        let ended = !crossfading
            && !playing
            && self.duration_secs > 0.0
            && position >= (self.duration_secs - 0.15)
            && self.path.is_some();
        NativeAudioStatus {
            path: self.path.clone(),
            playing,
            position_seconds: position,
            duration_seconds: self.duration_secs,
            volume: self.volume,
            ended,
            crossfading,
        }
    }

    fn append_path(&mut self, path: &Path, start_secs: f64, fade_in_secs: f64) -> Result<(), String> {
        self.ensure_output()?;
        // Cualquier load limpia un crossfade residual
        self.abort_crossfade(false);
        // Reutilizar el Sink: recrearlo abre sesiones extra en el mezclador de Windows
        if let Some(ref mut s) = self.sink { s.stop(); };
        if let Some(ref mut s) = self.sink { s.clear(); };
        // El fade de samples no usa FadeState por set_volume
        self.cancel_fade();
        self.applied_volume = self.volume.clamp(0.0, 1.0);
        let applied = self.applied_volume;
        self.sink_mut()?.set_volume(applied);

        let source = SymphoniaPlaySource::open(path, start_secs)?;
        self.sample_rate = source.sample_rate().max(1);
        self.frames_played.store(0, Ordering::Relaxed);
        let energy = Arc::clone(&self.energy);
        let frames = Arc::clone(&self.frames_played);
        let eq = self.eq.clone();
        let rate = self.rate.clone();
        // decode → fade → EQ → rate → medir
        if fade_in_secs >= 0.05 {
            self.sink_mut()?.append(MeasuringSource::new(
                RateSource::new(
                    EqSource::new(FadeInSource::new(source, fade_in_secs), eq),
                    rate,
                ),
                energy,
                frames,
            ));
        } else {
            self.sink_mut()?.append(MeasuringSource::new(
                RateSource::new(EqSource::new(source, eq), rate),
                energy,
                frames,
            ));
        }
        Ok(())
    }

    /// Inicia fundido cruzado hacia `path`. La UI ve ya la pista nueva (path/posición 0).
    fn start_crossfade(
        &mut self,
        path: &Path,
        duration_secs: f64,
        volume: Option<f32>,
    ) -> Result<NativeAudioStatus, String> {
        if let Some(v) = volume {
            self.volume = v.clamp(0.0, 1.0);
        }
        // Si ya había crossfade, promover o cortar antes de empezar otro
        if self.crossfade.is_some() {
            self.abort_crossfade(true);
        }
        self.cancel_fade();

        let duration = probe_duration_secs(path);
        let incoming = rodio::Sink::try_new(self.handle_ref()?)
            .map_err(|e| format!("No se pudo crear sink de crossfade: {e}"))?;
        let source = SymphoniaPlaySource::open(path, 0.0)?;
        self.sample_rate = source.sample_rate().max(1);
        // IMPORTANTE: nuevo Arc de frames para la pista entrante.
        // La saliente sigue con el Arc viejo y dejaría de actualizar self.frames_played;
        // si compartieran el mismo Atomic, ambas pistas sumarían frames y la
        // posición (y la letra) irían ~2x más rápido → letra adelantada.
        self.frames_played = Arc::new(AtomicU64::new(0));
        let energy = Arc::clone(&self.energy);
        let frames = Arc::clone(&self.frames_played);
        let eq = self.eq.clone();
        let rate = self.rate.clone();
        // Solo medir energía/posición de la pista entrante
        incoming.append(MeasuringSource::new(
            RateSource::new(EqSource::new(source, eq), rate),
            energy,
            frames,
        ));
        incoming.set_volume(0.0);
        incoming.play();

        // Asegurar que el sink saliente sigue sonando
        if self.sink.as_ref().map(|s| s.is_paused()).unwrap_or(true) {
            if let Some(ref mut s) = self.sink {
                s.play();
            }
        }
        let from = self.applied_volume.clamp(0.0, 1.0);
        let target = self.volume.clamp(0.0, 1.0);
        let secs = duration_secs.clamp(0.25, 12.0);
        let steps = ((secs * 50.0).round() as u32).clamp(4, 600);

        self.crossfade = Some(CrossfadeState {
            steps_left: steps,
            out_current: from,
            out_delta: -from / steps as f32,
            in_current: 0.0,
            in_delta: target / steps as f32,
        });
        self.crossfade_sink = Some(incoming);

        // La pista "actual" para UI es la nueva
        self.path = Some(path.to_string_lossy().into_owned());
        self.duration_secs = duration;
        self.offset_secs = 0.0;
        self.playing_since = Some(Instant::now());

        Ok(self.status())
    }

    fn tick_crossfade(&mut self) {
        let Some(cf) = self.crossfade.as_mut() else {
            return;
        };
        if cf.steps_left == 0 {
            self.finish_crossfade();
            return;
        }
        cf.out_current = (cf.out_current + cf.out_delta).clamp(0.0, 1.0);
        cf.in_current = (cf.in_current + cf.in_delta).clamp(0.0, 1.0);
        cf.steps_left = cf.steps_left.saturating_sub(1);
        let out_v = cf.out_current;
        let in_v = cf.in_current;
        self.applied_volume = out_v;
        if let Some(ref mut s) = self.sink { s.set_volume(out_v); }
        if let Some(ref incoming) = self.crossfade_sink {
            incoming.set_volume(in_v);
        }
        if cf.steps_left == 0 {
            self.finish_crossfade();
        }
    }

    fn finish_crossfade(&mut self) {
        // Detener saliente y promover entrante
        if let Some(incoming) = self.crossfade_sink.take() {
            if let Some(ref mut s) = self.sink { s.stop(); };
            self.sink = Some(incoming);
        }
        self.crossfade = None;
        self.apply_sink_volume(self.volume);
        // playing_since ya apunta al inicio de la pista nueva
        if self.sink.as_ref().map(|s| s.is_paused()).unwrap_or(true) {
            if let Some(ref mut s) = self.sink {
                s.play();
            }
        }
        if self.playing_since.is_none() {
            self.playing_since = Some(Instant::now());
        }
    }
}

fn probe_duration_secs(path: &Path) -> f64 {
    if let Ok(tagged) = lofty::read_from_path(path) {
        let secs = tagged.properties().duration().as_secs_f64();
        if secs.is_finite() && secs > 0.0 {
            return secs;
        }
    }
    0.0
}

fn audio_thread_main(
    rx: Receiver<AudioCmd>,
    energy: Arc<AtomicU32>,
    app_rx: Receiver<AppHandle>,
) {
    let eq = SharedEq::new();
    let rate = SharedRate::new();
    let mut player = match Player::try_new(Arc::clone(&energy), eq, rate) {
        Ok(p) => p,
        Err(err) => {
            eprintln!("[Resonance] Audio nativo no disponible: {err}");
            while let Ok(cmd) = rx.recv() {
                let send_err = |reply: Sender<Result<NativeAudioStatus, String>>| {
                    let _ = reply.send(Err(err.clone()));
                };
                match cmd {
                    AudioCmd::Load { reply, .. }
                    | AudioCmd::Crossfade { reply, .. }
                    | AudioCmd::Play { reply, .. }
                    | AudioCmd::Pause { reply, .. }
                    | AudioCmd::Seek { reply, .. }
                    | AudioCmd::SetVolume { reply, .. }
                    | AudioCmd::SetEq { reply, .. }
                    | AudioCmd::SetRate { reply, .. }
                    | AudioCmd::SetOutputDevice { reply, .. }
                    | AudioCmd::Stop { reply }
                    | AudioCmd::Status { reply } => send_err(reply),
                }
            }
            return;
        }
    };

    let mut app_handle: Option<AppHandle> = None;
    // Emitir ~33 FPS (cada ~30 ms = 1–2 ticks de 20 ms)
    let mut energy_emit_skip: u8 = 0;
    let mut last_emitted_bits: u32 = 0;

    loop {
        // Intentar recibir AppHandle si aún no lo tenemos (no bloqueante)
        if app_handle.is_none() {
            if let Ok(app) = app_rx.try_recv() {
                app_handle = Some(app);
            }
        }

        let cmd = match rx.recv_timeout(Duration::from_millis(20)) {
            Ok(c) => Some(c),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                player.tick_fade();
                player.tick_crossfade();
                // No marcar fin de pista mientras hay crossfade (el sink saliente se vacía a propósito)
                if player.crossfade.is_none()
                    && player.playing_since.is_some()
                    && player.sink.as_ref().map(|s| s.empty()).unwrap_or(true)
                {
                    player.playing_since = None;
                    if player.duration_secs > 0.0 {
                        player.offset_secs = player.duration_secs;
                    }
                    energy.store(0f32.to_bits(), Ordering::Relaxed);
                }

                // Emitir energía hacia el frontend para Visual+ (~30–40 Hz)
                energy_emit_skip = energy_emit_skip.wrapping_add(1);
                if energy_emit_skip % 2 == 0 {
                    if let Some(ref app) = app_handle {
                        let bits = energy.load(Ordering::Relaxed);
                        // Evitar ruido IPC cuando no hay cambio significativo y está en silencio
                        let level = f32::from_bits(bits);
                        let last = f32::from_bits(last_emitted_bits);
                        if player.is_playing() || level > 0.002 || last > 0.002 {
                            let _ = app.emit("audio-energy", level);
                            last_emitted_bits = bits;
                        }
                    }
                }
                None
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        };
        let Some(cmd) = cmd else { continue; };

        if player.crossfade.is_none() && player.playing_since.is_some() && player.sink.as_ref().map(|s| s.empty()).unwrap_or(true) {
            player.playing_since = None;
            if player.duration_secs > 0.0 {
                player.offset_secs = player.duration_secs;
            }
        }

        match cmd {
            AudioCmd::Load {
                path,
                auto_play,
                volume,
                fade_in_secs,
                reply,
            } => {
                let result = (|| {
                    let path_buf = PathBuf::from(&path);
                    if !path_buf.is_file() {
                        return Err(format!("El archivo no existe: {path}"));
                    }
                    if let Some(v) = volume {
                        player.volume = v.clamp(0.0, 1.0);
                    }
                    let duration = probe_duration_secs(&path_buf);
                    player.append_path(&path_buf, 0.0, if auto_play { fade_in_secs } else { 0.0 })?;
                    player.path = Some(path);
                    player.duration_secs = duration;
                    player.offset_secs = 0.0;
                    if auto_play {
                        if let Some(ref mut s) = player.sink { s.play(); };
                        player.playing_since = Some(Instant::now());
                        // Fade-in va en FadeInSource (samples), no en set_volume
                    } else {
                        if let Some(ref mut s) = player.sink { s.pause(); };
                        player.playing_since = None;
                        player.applied_volume = player.volume;
                        if let Some(ref mut s) = player.sink { s.set_volume(player.volume); };
                    }
                    Ok(player.status())
                })();
                let _ = reply.send(result);
            }
            AudioCmd::Crossfade {
                path,
                duration_secs,
                volume,
                reply,
            } => {
                let result = (|| {
                    let path_buf = PathBuf::from(&path);
                    if !path_buf.is_file() {
                        return Err(format!("El archivo no existe: {path}"));
                    }
                    player.start_crossfade(&path_buf, duration_secs, volume)
                })();
                let _ = reply.send(result);
            }
            AudioCmd::Play {
                fade_in_secs,
                reply,
            } => {
                let result = (|| {
                    if player.path.is_none() {
                        return Err("No hay ninguna pista cargada.".to_string());
                    }
                    let already_playing = player.playing_since.is_some()
                        && !player.sink.as_ref().map(|s| s.is_paused()).unwrap_or(true)
                        && !player.sink.as_ref().map(|s| s.empty()).unwrap_or(true);

                    // Play de refuerzo tras load: no tocar un fade-in en curso
                    if already_playing && fade_in_secs < 0.05 {
                        if let Some(fade) = player.fade.as_ref() {
                            if matches!(fade.kind, FadeKind::In) {
                                return Ok(player.status());
                            }
                        }
                        // Sin fade activo: asegurar volumen de usuario
                        if player.fade.is_none() {
                            player.apply_sink_volume(player.volume);
                        }
                        return Ok(player.status());
                    }

                    // Interrumpir fade-out (el usuario quiere oír ya)
                    if player.fade.as_ref().is_some_and(|f| matches!(f.kind, FadeKind::Out)) {
                        player.cancel_fade();
                    }

                    if player.sink.as_ref().map(|s| s.empty()).unwrap_or(true) {
                        let path = player.path.clone().unwrap();
                        let start = player.offset_secs;
                        player.append_path(Path::new(&path), start, 0.0)?;
                    }
                    if let Some(ref mut s) = player.sink { s.play(); };
                    if player.playing_since.is_none() {
                        player.playing_since = Some(Instant::now());
                    }
                    if fade_in_secs >= 0.05 {
                        let path = player.path.clone().unwrap();
                        let start = player.offset_secs;
                        // Re-abrir con fade en samples desde la posición actual
                        player.append_path(Path::new(&path), start, fade_in_secs)?;
                        if let Some(ref mut s) = player.sink { s.play(); };
                        player.playing_since = Some(Instant::now());
                    } else if player.fade.is_none() {
                        player.apply_sink_volume(player.volume);
                    }
                    Ok(player.status())
                })();
                let _ = reply.send(result);
            }
            AudioCmd::Pause {
                fade_out_secs,
                reply,
            } => {
                // Pausar durante crossfade: promover pista nueva y pausar
                if player.crossfade.is_some() {
                    player.abort_crossfade(true);
                    player.finish_pause_now();
                    player.apply_sink_volume(player.volume);
                    let _ = reply.send(Ok(player.status()));
                    continue;
                }
                // Segunda pulsación durante fade-out → pausa inmediata
                if player.fade.as_ref().is_some_and(|f| matches!(f.kind, FadeKind::Out)) {
                    player.cancel_fade();
                    player.finish_pause_now();
                    player.apply_sink_volume(player.volume);
                } else if fade_out_secs >= 0.05 && player.playing_since.is_some() {
                    player.start_fade_out(fade_out_secs, true);
                } else {
                    player.cancel_fade();
                    player.finish_pause_now();
                    player.apply_sink_volume(player.volume);
                }
                let _ = reply.send(Ok(player.status()));
            }
            AudioCmd::Seek {
                position_seconds,
                reply,
            } => {
                let result = (|| {
                    // Seek cancela crossfade (promueve entrante y busca en la pista nueva)
                    if player.crossfade.is_some() {
                        player.abort_crossfade(true);
                    }
                    let path = player
                        .path
                        .clone()
                        .ok_or_else(|| "No hay ninguna pista cargada.".to_string())?;
                    let was_playing =
                        player.playing_since.is_some() || !player.sink.as_ref().map(|s| s.is_paused()).unwrap_or(true);
                    let mut pos = position_seconds.max(0.0);
                    if player.duration_secs > 0.0 {
                        pos = pos.min(player.duration_secs);
                    }
                    // Seek con índice de symphonia (no re-decodifica desde 0)
                    player.append_path(Path::new(&path), pos, 0.0)?;
                    player.offset_secs = pos;
                    player.playing_since = None;
                    if let Some(ref mut s) = player.sink { s.set_volume(player.volume); };
                    if was_playing {
                        if let Some(ref mut s) = player.sink { s.play(); };
                        player.playing_since = Some(Instant::now());
                    } else {
                        if let Some(ref mut s) = player.sink { s.pause(); };
                    }
                    Ok(player.status())
                })();
                let _ = reply.send(result);
            }
            AudioCmd::SetVolume { volume, reply } => {
                player.volume = volume.clamp(0.0, 1.0);
                if let Some(cf) = player.crossfade.as_mut() {
                    // Ajustar rampa entrante al nuevo volumen objetivo
                    if cf.steps_left > 0 {
                        cf.in_delta = (player.volume - cf.in_current) / cf.steps_left as f32;
                    }
                } else if let Some(fade) = player.fade.as_mut() {
                    if matches!(fade.kind, FadeKind::In) {
                        fade.target = player.volume;
                        if fade.steps_left > 0 {
                            fade.delta = (fade.target - fade.current) / fade.steps_left as f32;
                        }
                    }
                } else {
                    player.applied_volume = player.volume;
                    if let Some(ref mut s) = player.sink { s.set_volume(player.volume); };
                }
                let _ = reply.send(Ok(player.status()));
            }
            AudioCmd::SetEq {
                enabled,
                gains_db,
                reply,
            } => {
                player.eq.set(enabled, &gains_db);
                let _ = reply.send(Ok(player.status()));
            }
            AudioCmd::SetRate { rate, reply } => {
                // Congelar posición de contenido antes de cambiar el rate
                player.offset_secs = player.position_seconds();
                player.frames_played.store(0, Ordering::Relaxed);
                player.rate.set(rate);
                let _ = reply.send(Ok(player.status()));
            }
            AudioCmd::SetOutputDevice { device_id, reply } => {
                let result = player.set_output_device(device_id).map(|_| player.status());
                let _ = reply.send(result);
            }
            AudioCmd::Stop { reply } => {
                player.cancel_fade();
                player.abort_crossfade(false);
                if let Some(ref mut s) = player.sink { s.stop(); };
                if let Some(ref mut s) = player.sink { s.clear(); };
                player.playing_since = None;
                player.offset_secs = 0.0;
                player.applied_volume = player.volume;
                player.energy.store(0f32.to_bits(), Ordering::Relaxed);
                let _ = reply.send(Ok(player.status()));
            }
            AudioCmd::Status { reply } => {
                if player.crossfade.is_none()
                    && player.playing_since.is_some()
                    && player.sink.as_ref().map(|s| s.empty()).unwrap_or(true)
                {
                    player.playing_since = None;
                    if player.duration_secs > 0.0 {
                        player.offset_secs = player.duration_secs;
                    }
                }
                let _ = reply.send(Ok(player.status()));
            }
        }
    }
}

fn send_cmd_blocking(
    tx: &Sender<AudioCmd>,
    build: impl FnOnce(Sender<Result<NativeAudioStatus, String>>) -> AudioCmd,
) -> Result<NativeAudioStatus, String> {
    let (reply_tx, reply_rx) = mpsc::channel();
    let cmd = build(reply_tx);
    tx.send(cmd)
        .map_err(|_| "El hilo de audio nativo no está disponible.".to_string())?;
    reply_rx
        .recv_timeout(Duration::from_secs(45))
        .map_err(|_| "Tiempo de espera agotado en el motor de audio.".to_string())?
}

fn with_tx<R>(
    state: &State<'_, NativeAudioState>,
    f: impl FnOnce(&Sender<AudioCmd>) -> Result<R, String>,
) -> Result<R, String> {
    let guard = state
        .tx
        .lock()
        .map_err(|_| "No se pudo acceder al motor de audio.".to_string())?;
    f(&guard)
}

#[tauri::command]
pub async fn native_audio_load(
    state: State<'_, NativeAudioState>,
    path: String,
    auto_play: bool,
    volume: Option<f32>,
    fade_in_secs: Option<f64>,
) -> Result<NativeAudioStatus, String> {
    let fade_in_secs = fade_in_secs.unwrap_or(0.0);
    let tx = with_tx(&state, |tx| Ok(tx.clone()))?;
    tauri::async_runtime::spawn_blocking(move || {
        send_cmd_blocking(&tx, |reply| AudioCmd::Load {
            path,
            auto_play,
            volume,
            fade_in_secs,
            reply,
        })
    })
    .await
    .map_err(|e| format!("Error en el motor de audio: {e}"))?
}

#[tauri::command]
pub async fn native_audio_crossfade(
    state: State<'_, NativeAudioState>,
    path: String,
    duration_secs: Option<f64>,
    volume: Option<f32>,
) -> Result<NativeAudioStatus, String> {
    let duration_secs = duration_secs.unwrap_or(4.0).clamp(0.25, 12.0);
    let tx = with_tx(&state, |tx| Ok(tx.clone()))?;
    tauri::async_runtime::spawn_blocking(move || {
        send_cmd_blocking(&tx, |reply| AudioCmd::Crossfade {
            path,
            duration_secs,
            volume,
            reply,
        })
    })
    .await
    .map_err(|e| format!("Error en el motor de audio: {e}"))?
}

#[tauri::command]
pub async fn native_audio_play(
    state: State<'_, NativeAudioState>,
    fade_in_secs: Option<f64>,
) -> Result<NativeAudioStatus, String> {
    let fade_in_secs = fade_in_secs.unwrap_or(0.0);
    let tx = with_tx(&state, |tx| Ok(tx.clone()))?;
    tauri::async_runtime::spawn_blocking(move || {
        send_cmd_blocking(&tx, |reply| AudioCmd::Play {
            fade_in_secs,
            reply,
        })
    })
    .await
    .map_err(|e| format!("Error en el motor de audio: {e}"))?
}

#[tauri::command]
pub async fn native_audio_pause(
    state: State<'_, NativeAudioState>,
    fade_out_secs: Option<f64>,
) -> Result<NativeAudioStatus, String> {
    let fade_out_secs = fade_out_secs.unwrap_or(0.0);
    let tx = with_tx(&state, |tx| Ok(tx.clone()))?;
    tauri::async_runtime::spawn_blocking(move || {
        send_cmd_blocking(&tx, |reply| AudioCmd::Pause {
            fade_out_secs,
            reply,
        })
    })
    .await
    .map_err(|e| format!("Error en el motor de audio: {e}"))?
}

#[tauri::command]
pub async fn native_audio_seek(
    state: State<'_, NativeAudioState>,
    position_seconds: f64,
) -> Result<NativeAudioStatus, String> {
    let tx = with_tx(&state, |tx| Ok(tx.clone()))?;
    tauri::async_runtime::spawn_blocking(move || {
        send_cmd_blocking(&tx, |reply| AudioCmd::Seek {
            position_seconds,
            reply,
        })
    })
    .await
    .map_err(|e| format!("Error en el motor de audio: {e}"))?
}

#[tauri::command]
pub async fn native_audio_set_volume(
    state: State<'_, NativeAudioState>,
    volume: f32,
) -> Result<NativeAudioStatus, String> {
    let tx = with_tx(&state, |tx| Ok(tx.clone()))?;
    tauri::async_runtime::spawn_blocking(move || {
        send_cmd_blocking(&tx, |reply| AudioCmd::SetVolume { volume, reply })
    })
    .await
    .map_err(|e| format!("Error en el motor de audio: {e}"))?
}

/// Aplica el ecualizador gráfico nativo (20 bandas en dB, rango típico ±15).
#[tauri::command]
pub async fn native_audio_set_eq(
    state: State<'_, NativeAudioState>,
    enabled: bool,
    gains_db: Vec<f32>,
) -> Result<NativeAudioStatus, String> {
    let tx = with_tx(&state, |tx| Ok(tx.clone()))?;
    tauri::async_runtime::spawn_blocking(move || {
        send_cmd_blocking(&tx, |reply| AudioCmd::SetEq {
            enabled,
            gains_db,
            reply,
        })
    })
    .await
    .map_err(|e| format!("Error en el motor de audio: {e}"))?
}

/// Velocidad de reproducción efectiva (1.0 = normal). El tono se combina en el frontend.
#[tauri::command]
pub async fn native_audio_set_rate(
    state: State<'_, NativeAudioState>,
    rate: f32,
) -> Result<NativeAudioStatus, String> {
    let tx = with_tx(&state, |tx| Ok(tx.clone()))?;
    tauri::async_runtime::spawn_blocking(move || {
        send_cmd_blocking(&tx, |reply| AudioCmd::SetRate { rate, reply })
    })
    .await
    .map_err(|e| format!("Error en el motor de audio: {e}"))?
}

/// Lista dispositivos de salida (cpal / WASAPI compartido en Windows).
#[tauri::command]
pub fn native_audio_list_output_devices() -> Result<Vec<OutputDeviceInfo>, String> {
    use cpal::traits::{DeviceTrait, HostTrait};

    let host = cpal::default_host();
    let default_name = host
        .default_output_device()
        .and_then(|d| d.name().ok())
        .unwrap_or_default();
    let mut list = Vec::new();
    let devices = host
        .output_devices()
        .map_err(|e| format!("No se pudieron enumerar salidas de audio: {e}"))?;
    for device in devices {
        let Ok(name) = device.name() else {
            continue;
        };
        let is_default = !default_name.is_empty() && name == default_name;
        list.push(OutputDeviceInfo {
            id: name.clone(),
            name,
            is_default,
        });
    }
    Ok(list)
}

/// Cambia el dispositivo de salida del motor nativo (`null`/omitido = predeterminado).
#[tauri::command]
pub async fn native_audio_set_output_device(
    state: State<'_, NativeAudioState>,
    device_id: Option<String>,
) -> Result<NativeAudioStatus, String> {
    let tx = with_tx(&state, |tx| Ok(tx.clone()))?;
    tauri::async_runtime::spawn_blocking(move || {
        send_cmd_blocking(&tx, |reply| AudioCmd::SetOutputDevice { device_id, reply })
    })
    .await
    .map_err(|e| format!("Error en el motor de audio: {e}"))?
}

#[tauri::command]
pub async fn native_audio_stop(
    state: State<'_, NativeAudioState>,
) -> Result<NativeAudioStatus, String> {
    let tx = with_tx(&state, |tx| Ok(tx.clone()))?;
    tauri::async_runtime::spawn_blocking(move || {
        send_cmd_blocking(&tx, |reply| AudioCmd::Stop { reply })
    })
    .await
    .map_err(|e| format!("Error en el motor de audio: {e}"))?
}

#[tauri::command]
pub async fn native_audio_status(
    state: State<'_, NativeAudioState>,
) -> Result<NativeAudioStatus, String> {
    let tx = with_tx(&state, |tx| Ok(tx.clone()))?;
    tauri::async_runtime::spawn_blocking(move || {
        send_cmd_blocking(&tx, |reply| AudioCmd::Status { reply })
    })
    .await
    .map_err(|e| format!("Error en el motor de audio: {e}"))?
}

/// Caché en memoria de waveforms: path → (mtime, bar_count, peaks).
struct WaveformCacheEntry {
    mtime_secs: u64,
    bar_count: usize,
    peaks: Vec<f32>,
}

fn waveform_mem_cache() -> &'static Mutex<HashMap<String, WaveformCacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<String, WaveformCacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Directorio de caché en disco: `{AppData}/ResonanceMusicPlayer/waveform-cache/`
static WAVEFORM_DISK_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Llamar desde el setup de Tauri con el directorio de datos de la app.
pub fn init_waveform_cache_dir(app_data_dir: PathBuf) {
    let dir = app_data_dir.join("waveform-cache");
    let _ = fs::create_dir_all(&dir);
    let _ = WAVEFORM_DISK_DIR.set(dir);
}

fn file_mtime_secs(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Nombre de archivo estable (hash) para no usar rutas con caracteres especiales.
fn waveform_disk_filename(path: &str, mtime: u64, bars: usize) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    hasher.update(mtime.to_le_bytes());
    hasher.update((bars as u32).to_le_bytes());
    format!("{:x}.wfc", hasher.finalize())
}

const WFC_MAGIC: &[u8; 4] = b"RMPW";
// v10: RMS dominante + normalización local (variación continua tipo AIMP)
const WFC_VERSION: u8 = 10;

fn path_fingerprint(path: &str) -> [u8; 8] {
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    let full = hasher.finalize();
    let mut out = [0u8; 8];
    out.copy_from_slice(&full[..8]);
    out
}

fn write_waveform_disk(path: &str, mtime: u64, bars: usize, peaks: &[f32]) {
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

fn read_waveform_disk(path: &str, mtime: u64, bars: usize) -> Option<Vec<f32>> {
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
fn maybe_trim_waveform_disk_cache() {
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
fn compute_waveform_peaks(path: &Path, bar_count: usize) -> Result<Vec<f32>, String> {
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

fn mem_cache_key(path: &str, bars: usize) -> String {
    format!("{path}\u{1}{bars}")
}

fn store_mem_cache(path: &str, mtime: u64, bars: usize, peaks: &[f32]) {
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
