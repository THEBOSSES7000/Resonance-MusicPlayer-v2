//! Medición de energía y espectro (Visual+ Wave Sound).

use super::*;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

/// Solo emitir energía/espectro cuando Visual+ lo pide.
pub static ENERGY_EMIT_ENABLED: AtomicBool = AtomicBool::new(false);

pub const SPECTRUM_BANDS: usize = 64;
const ANALYSIS_SIZE: usize = 512;

struct SpectrumPlan {
    window: [f32; ANALYSIS_SIZE],
    twiddles: [(f32, f32); ANALYSIS_SIZE / 2],
}

fn spectrum_plan() -> &'static SpectrumPlan {
    static PLAN: OnceLock<SpectrumPlan> = OnceLock::new();
    PLAN.get_or_init(|| SpectrumPlan {
        window: std::array::from_fn(|i| {
            let phase = 2.0 * std::f32::consts::PI * i as f32 / (ANALYSIS_SIZE - 1) as f32;
            0.5 - 0.5 * phase.cos()
        }),
        twiddles: std::array::from_fn(|i| {
            let phase = -2.0 * std::f32::consts::PI * i as f32 / ANALYSIS_SIZE as f32;
            (phase.cos(), phase.sin())
        }),
    })
}

/// Último espectro calculado (0–1 por banda).
pub static LATEST_SPECTRUM: Mutex<[f32; SPECTRUM_BANDS]> =
    Mutex::new([0.0; SPECTRUM_BANDS]);

/// Source wrapper: RMS + espectro por bandas.
pub struct MeasuringSource<S>
where
    S: Source<Item = f32>,
{
    pub inner: S,
    pub energy: Arc<AtomicU32>,
    pub frames: Arc<AtomicU64>,
    pub channels: u16,
    pub interleave_pos: u16,
    pub sum_sq: f64,
    pub count: u32,
    pub window: u32,
    mono_buf: Vec<f32>,
    mono_acc: f32,
    mono_pos: usize,
    analysis_enabled: bool,
}

impl<S> MeasuringSource<S>
where
    S: Source<Item = f32>,
{
    pub fn new(inner: S, energy: Arc<AtomicU32>, frames: Arc<AtomicU64>) -> Self {
        let channels = inner.channels().max(1);
        Self {
            inner,
            energy,
            frames,
            channels,
            interleave_pos: 0,
            sum_sq: 0.0,
            count: 0,
            window: 512,
            mono_buf: vec![0.0; ANALYSIS_SIZE],
            mono_acc: 0.0,
            mono_pos: 0,
            analysis_enabled: false,
        }
    }

    pub fn push_sample(&mut self, sample: f32) {
        self.interleave_pos = self.interleave_pos.wrapping_add(1);
        if self.interleave_pos >= self.channels {
            self.interleave_pos = 0;
            self.frames.fetch_add(1, Ordering::Relaxed);
        }

        if !ENERGY_EMIT_ENABLED.load(Ordering::Relaxed) {
            if self.analysis_enabled {
                self.sum_sq = 0.0;
                self.count = 0;
                self.mono_acc = 0.0;
                self.mono_pos = 0;
                self.energy.store(0f32.to_bits(), Ordering::Relaxed);
                self.analysis_enabled = false;
            }
            return;
        }
        self.analysis_enabled = true;

        let s = sample as f64;
        self.sum_sq += s * s;
        self.count += 1;
        if self.count >= self.window {
            let rms = (self.sum_sq / self.count as f64).sqrt() as f32;
            let level = (rms * 4.0).clamp(0.0, 1.0);
            self.energy.store(level.to_bits(), Ordering::Relaxed);
            self.sum_sq = 0.0;
            self.count = 0;
        }

        self.mono_acc += sample;
        if self.interleave_pos == 0 {
            let mono = self.mono_acc / self.channels as f32;
            self.mono_acc = 0.0;
            self.mono_buf[self.mono_pos] = mono;
            self.mono_pos += 1;
            if self.mono_pos >= ANALYSIS_SIZE {
                self.mono_pos = 0;
                self.compute_spectrum();
            }
        }
    }

    fn compute_spectrum(&self) {
        let plan = spectrum_plan();
        let mut real = [0.0f32; ANALYSIS_SIZE];
        let mut imag = [0.0f32; ANALYSIS_SIZE];
        for i in 0..ANALYSIS_SIZE {
            real[i] = self.mono_buf[i] * plan.window[i];
        }

        let mut j = 0;
        for i in 1..ANALYSIS_SIZE {
            let mut bit = ANALYSIS_SIZE >> 1;
            while j & bit != 0 {
                j ^= bit;
                bit >>= 1;
            }
            j ^= bit;
            if i < j {
                real.swap(i, j);
                imag.swap(i, j);
            }
        }
        let mut len = 2;
        while len <= ANALYSIS_SIZE {
            let half = len / 2;
            let stride = ANALYSIS_SIZE / len;
            for start in (0..ANALYSIS_SIZE).step_by(len) {
                for offset in 0..half {
                    let (wr, wi) = plan.twiddles[offset * stride];
                    let even = start + offset;
                    let odd = even + half;
                    let tr = wr * real[odd] - wi * imag[odd];
                    let ti = wr * imag[odd] + wi * real[odd];
                    real[odd] = real[even] - tr;
                    imag[odd] = imag[even] - ti;
                    real[even] += tr;
                    imag[even] += ti;
                }
            }
            len *= 2;
        }

        let mut bands = [0.0f32; SPECTRUM_BANDS];
        let mut max_v = 1e-6f32;
        for b in 0..SPECTRUM_BANDS {
            let t = (b as f32 + 0.5) / SPECTRUM_BANDS as f32;
            let k = (1.0 + t * t * (ANALYSIS_SIZE as f32 * 0.45 - 1.0))
                .clamp(1.0, (ANALYSIS_SIZE / 2 - 1) as f32);
            let low_bin = k.floor() as usize;
            let high_bin = k.ceil() as usize;
            let low_magnitude = real[low_bin].hypot(imag[low_bin]);
            let high_magnitude = real[high_bin].hypot(imag[high_bin]);
            let fraction = k - low_bin as f32;
            let mag = (low_magnitude + (high_magnitude - low_magnitude) * fraction)
                / ANALYSIS_SIZE as f32;
            let v = (mag * 22.0).powf(0.68);
            bands[b] = v;
            if v > max_v {
                max_v = v;
            }
        }
        let norm = max_v.max(0.05);
        for b in bands.iter_mut() {
            *b = (*b / norm).clamp(0.0, 1.0);
        }
        if let Ok(mut g) = LATEST_SPECTRUM.lock() {
            *g = bands;
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
    fn total_duration(&self) -> Option<std::time::Duration> {
        self.inner.total_duration()
    }
}
