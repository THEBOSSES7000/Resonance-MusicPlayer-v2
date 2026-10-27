//! Velocidad y tono: fuente de audio con remuestreo.

use super::*;

/// Velocidad efectiva compartida (1.0 = normal). Tono = rate * 2^(semitonos/12) en el frontend.
#[derive(Clone)]
pub struct SharedRate {
    pub rate_bits: Arc<AtomicU32>,
}

impl SharedRate {
    pub fn new() -> Self {
        Self {
            rate_bits: Arc::new(AtomicU32::new(1.0f32.to_bits())),
        }
    }

    pub fn set(&self, rate: f32) {
        let r = rate.clamp(0.25, 4.0);
        self.rate_bits.store(r.to_bits(), Ordering::Release);
    }

    pub fn get(&self) -> f32 {
        f32::from_bits(self.rate_bits.load(Ordering::Acquire)).clamp(0.25, 4.0)
    }
}

/// Cambia tempo/tono saltando o repitiendo frames (igual que HTML audio.playbackRate).
pub struct RateSource<S>
where
    S: Source<Item = f32>,
{
    pub inner: S,
    pub shared: SharedRate,
    pub channels: usize,
    pub chan: usize,
    pub frame: Vec<f32>,
    pub have_frame: bool,
    pub phase: f64,
}

impl<S> RateSource<S>
where
    S: Source<Item = f32>,
{
    pub fn new(inner: S, shared: SharedRate) -> Self {
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

    pub fn pull_frame(&mut self) -> bool {
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
