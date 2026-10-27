//! Fundidos (fade in/out) y estado de crossfade.

use super::*;

/// Fundido de entrada en la cadena de samples (no depende del hilo de comandos).
pub struct FadeInSource {
    pub inner: SymphoniaPlaySource,
    /// Samples interleaved ya emitidos dentro del fade
    pub pos: usize,
    /// Total de samples interleaved del fade
    pub fade_len: usize,
}

impl FadeInSource {
    pub fn new(inner: SymphoniaPlaySource, fade_secs: f64) -> Self {
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
pub enum FadeKind {
    #[allow(dead_code)]
    In,
    Out,
}

/// Rampa por pasos (~20 ms). Más fiable que depender solo de Instant + curva.
pub struct FadeState {
    pub kind: FadeKind,
    pub steps_left: u32,
    pub current: f32,
    pub delta: f32,
    pub target: f32,
    pub pause_when_done: bool,
}

/// Rampa dual de volúmenes para crossfade (~20 ms por paso).
pub struct CrossfadeState {
    pub steps_left: u32,
    pub out_current: f32,
    pub out_delta: f32,
    pub in_current: f32,
    pub in_delta: f32,
}
