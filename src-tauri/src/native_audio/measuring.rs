//! Medición de energía de la señal (evento audio-energy para Visual+).

use super::*;
use std::sync::atomic::{AtomicBool, Ordering};

/// Solo emitir `audio-energy` al frontend cuando Visual+ (u otro análisis) lo pide.
pub static ENERGY_EMIT_ENABLED: AtomicBool = AtomicBool::new(false);

/// Source wrapper que calcula RMS en tiempo real y cuenta frames consumidos
/// para el reloj de posición (más fiable que Instant del sistema).
pub struct MeasuringSource<S>
where
    S: Source<Item = f32>,
{
    pub inner: S,
    pub energy: Arc<AtomicU32>,
    /// Frames de audio consumidos (1 frame = 1 sample por canal).
    pub frames: Arc<AtomicU64>,
    pub channels: u16,
    pub interleave_pos: u16,
    pub sum_sq: f64,
    pub count: u32,
    pub window: u32,
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
            // ~10–12 ms a 44.1 kHz estéreo → respuesta fluida para animaciones
            window: 512,
        }
    }

    pub fn push_sample(&mut self, sample: f32) {
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
