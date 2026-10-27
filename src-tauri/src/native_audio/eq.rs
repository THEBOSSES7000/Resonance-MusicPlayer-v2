//! Ecualizador de 20 bandas: filtros biquad y fuente de audio con ecualización.

use super::*;

/// Frecuencias centrales del EQ gráfico (20 bandas, estilo AIMP).
pub const EQ_FREQUENCIES_HZ: [f32; 20] = [
    31.0, 43.0, 63.0, 87.0, 125.0, 175.0, 250.0, 350.0, 500.0, 700.0, 1000.0, 1400.0, 2000.0,
    2800.0, 4000.0, 5600.0, 8000.0, 11200.0, 16000.0, 22000.0,
];

/// Estado compartido del EQ (UI → hilo de audio).
#[derive(Clone)]
pub struct SharedEq {
    pub enabled: Arc<AtomicBool>,
    /// bits de f32 por banda (dB)
    pub gains_bits: Arc<[AtomicU32; 20]>,
    /// Incrementa cuando cambian gains/enabled → rebuild de filtros en el Source
    pub generation: Arc<AtomicU64>,
}

impl SharedEq {
    pub fn new() -> Self {
        Self {
            enabled: Arc::new(AtomicBool::new(false)),
            gains_bits: Arc::new(std::array::from_fn(|_| AtomicU32::new(0f32.to_bits()))),
            generation: Arc::new(AtomicU64::new(0)),
        }
    }

    pub fn set(&self, enabled: bool, gains_db: &[f32]) {
        self.enabled.store(enabled, Ordering::Release);
        for i in 0..20 {
            let g = gains_db.get(i).copied().unwrap_or(0.0).clamp(-15.0, 15.0);
            self.gains_bits[i].store(g.to_bits(), Ordering::Release);
        }
        self.generation.fetch_add(1, Ordering::Release);
    }

    pub fn gains_db(&self) -> [f32; 20] {
        std::array::from_fn(|i| f32::from_bits(self.gains_bits[i].load(Ordering::Acquire)))
    }
}

#[derive(Clone, Copy)]
pub struct BiquadCoeffs {
    pub b0: f32,
    pub b1: f32,
    pub b2: f32,
    pub a1: f32,
    pub a2: f32,
}

impl BiquadCoeffs {
    pub fn identity() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
        }
    }

    /// Peaking EQ (RBJ cookbook).
    pub fn peaking(sample_rate: f32, freq: f32, gain_db: f32, q: f32) -> Self {
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
pub struct BiquadState {
    pub z1: f32,
    pub z2: f32,
}

impl BiquadState {
    pub fn new() -> Self {
        Self { z1: 0.0, z2: 0.0 }
    }

    #[inline]
    pub fn process(&mut self, x: f32, c: &BiquadCoeffs) -> f32 {
        let y = c.b0 * x + self.z1;
        self.z1 = c.b1 * x - c.a1 * y + self.z2;
        self.z2 = c.b2 * x - c.a2 * y;
        y
    }
}

/// Aplica hasta 20 peaking EQ en samples interleaved (por canal).
pub struct EqSource<S>
where
    S: Source<Item = f32>,
{
    pub inner: S,
    pub shared: SharedEq,
    pub sample_rate: u32,
    pub channels: u16,
    pub channel_ix: u16,
    pub generation: u64,
    pub coeffs: [BiquadCoeffs; 20],
    /// estado [banda][canal] — máx 2 canales para el gráfico típico
    pub states: [[BiquadState; 2]; 20],
    pub bypass: bool,
}

impl<S> EqSource<S>
where
    S: Source<Item = f32>,
{
    pub fn new(inner: S, shared: SharedEq) -> Self {
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

    pub fn rebuild_if_needed(&mut self) {
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
