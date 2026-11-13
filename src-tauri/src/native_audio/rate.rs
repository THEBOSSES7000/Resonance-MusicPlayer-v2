//! Velocidad y tono: fuente de audio con remuestreo.

use super::*;
use std::collections::VecDeque;

/// Velocidad efectiva compartida (1.0 = normal). Tono = rate * 2^(semitonos/12) en el frontend.
#[derive(Clone)]
pub struct SharedRate {
    pub rate_bits: Arc<AtomicU32>,
    pub preserve_pitch: Arc<AtomicBool>,
}

impl SharedRate {
    pub fn new() -> Self {
        Self {
            rate_bits: Arc::new(AtomicU32::new(1.0f32.to_bits())),
            preserve_pitch: Arc::new(AtomicBool::new(true)),
        }
    }

    pub fn set(&self, rate: f32, preserve_pitch: bool) {
        let r = rate.clamp(0.25, 4.0);
        self.rate_bits.store(r.to_bits(), Ordering::Release);
        self.preserve_pitch.store(preserve_pitch, Ordering::Release);
    }

    pub fn get(&self) -> f32 {
        f32::from_bits(self.rate_bits.load(Ordering::Acquire)).clamp(0.25, 4.0)
    }

    pub fn preserves_pitch(&self) -> bool {
        self.preserve_pitch.load(Ordering::Acquire)
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

const WSOLA_WINDOW: usize = 1024;
const WSOLA_OVERLAP: usize = 256;
const WSOLA_HOP: usize = WSOLA_WINDOW - WSOLA_OVERLAP;
const WSOLA_SEARCH: u64 = 128;

/// WSOLA tempo adjustment: changes duration while retaining the source pitch.
pub struct TimeStretchSource<S>
where
    S: Source<Item = f32>,
{
    inner: S,
    shared: SharedRate,
    channels: usize,
    input: VecDeque<f32>,
    input_base: u64,
    input_end: u64,
    expected_start: Option<u64>,
    previous_tail: Vec<Vec<f32>>,
    output: VecDeque<f32>,
    input_finished: bool,
    finished: bool,
}

impl<S> TimeStretchSource<S>
where
    S: Source<Item = f32>,
{
    pub fn new(inner: S, shared: SharedRate) -> Self {
        let channels = inner.channels().max(1) as usize;
        Self {
            inner,
            shared,
            channels,
            input: VecDeque::new(),
            input_base: 0,
            input_end: 0,
            expected_start: None,
            previous_tail: vec![vec![0.0; WSOLA_OVERLAP]; channels],
            output: VecDeque::new(),
            input_finished: false,
            finished: false,
        }
    }

    fn fill_to(&mut self, end: u64) {
        while self.input_end < end && !self.input_finished {
            let mut frame_samples = 0;
            for _ in 0..self.channels {
                match self.inner.next() {
                    Some(sample) => {
                        self.input.push_back(sample);
                        frame_samples += 1;
                    }
                    None => {
                        for _ in 0..frame_samples {
                            self.input.pop_back();
                        }
                        self.input_finished = true;
                        return;
                    }
                }
            }
            self.input_end += 1;
        }
    }

    fn sample_frame(&self, frame: u64, channel: usize) -> Option<f32> {
        let frame_offset = usize::try_from(frame.checked_sub(self.input_base)?).ok()?;
        let sample_offset = frame_offset
            .checked_mul(self.channels)?
            .checked_add(channel)?;
        self.input.get(sample_offset).copied()
    }

    fn correlation(&self, candidate: u64, overlap: usize) -> f64 {
        let mut dot = 0.0f64;
        let mut left_energy = 1e-12f64;
        let mut right_energy = 1e-12f64;
        for frame in 0..overlap {
            for channel in 0..self.channels {
                let left = self.previous_tail[channel][frame] as f64;
                let Some(right) = self.sample_frame(candidate + frame as u64, channel) else {
                    continue;
                };
                let right = right as f64;
                dot += left * right;
                left_energy += left * left;
                right_energy += right * right;
            }
        }
        dot / (left_energy * right_energy).sqrt()
    }

    fn generate_block(&mut self) {
        if self.output.len() > self.channels * WSOLA_HOP || self.finished {
            return;
        }
        let Some(expected_start) = self.expected_start else {
            self.fill_to(WSOLA_WINDOW as u64);
            let available = (self.input_end - self.input_base) as usize;
            if available == 0 {
                self.finished = true;
                return;
            }
            if available < WSOLA_WINDOW {
                self.output.extend(self.input.iter().copied());
                self.finished = true;
                return;
            }
            for frame in 0..WSOLA_HOP {
                for channel in 0..self.channels {
                    self.output
                        .push_back(self.sample_frame(frame as u64, channel).unwrap_or(0.0));
                }
            }
            for frame in 0..WSOLA_OVERLAP {
                for channel in 0..self.channels {
                    self.previous_tail[channel][frame] = self
                        .sample_frame((WSOLA_HOP + frame) as u64, channel)
                        .unwrap_or(0.0);
                }
            }
            self.expected_start = Some(WSOLA_HOP as u64);
            return;
        };

        let rate = self.shared.get();
        let analysis_hop = (WSOLA_HOP as f64 * rate as f64).round() as u64;
        let expected = expected_start;
        let search = if (rate - 1.0).abs() < 0.001 {
            0
        } else {
            WSOLA_SEARCH
        };
        let first = expected.saturating_sub(search).max(self.input_base);
        let last = expected.saturating_add(search);
        self.fill_to(last.saturating_add(WSOLA_WINDOW as u64));

        let available_end = self.input_end;
        let first_with_overlap = first.max(self.input_base);
        if available_end.saturating_sub(first_with_overlap) < WSOLA_OVERLAP as u64 {
            self.output.extend(self.input.iter().copied());
            self.finished = true;
            return;
        }

        let last_candidate = last.min(available_end - WSOLA_OVERLAP as u64);
        let mut best = first_with_overlap.min(last_candidate);
        if search > 0 {
            let mut best_score = f64::NEG_INFINITY;
            for candidate in first_with_overlap..=last_candidate {
                let overlap = (available_end - candidate).min(WSOLA_OVERLAP as u64) as usize;
                let score = self.correlation(candidate, overlap);
                if score > best_score {
                    best_score = score;
                    best = candidate;
                }
            }
        }

        let available = (available_end - best) as usize;
        let overlap = available.min(WSOLA_OVERLAP);
        for frame in 0..overlap {
            for channel in 0..self.channels {
                let incoming = self
                    .sample_frame(best + frame as u64, channel)
                    .unwrap_or(0.0);
                if search == 0 {
                    self.output.push_back(incoming);
                } else {
                    let t = (frame as f32 + 0.5) / overlap.max(1) as f32;
                    let fade_out = (t * std::f32::consts::FRAC_PI_2).cos();
                    let fade_in = (t * std::f32::consts::FRAC_PI_2).sin();
                    self.output.push_back(
                        self.previous_tail[channel][frame] * fade_out + incoming * fade_in,
                    );
                }
            }
        }
        let body = available
            .saturating_sub(overlap)
            .min(WSOLA_HOP - WSOLA_OVERLAP);
        for frame in 0..body {
            for channel in 0..self.channels {
                self.output.push_back(
                    self.sample_frame(best + (overlap + frame) as u64, channel)
                        .unwrap_or(0.0),
                );
            }
        }

        if available >= WSOLA_WINDOW {
            for frame in 0..WSOLA_OVERLAP {
                for channel in 0..self.channels {
                    self.previous_tail[channel][frame] = self
                        .sample_frame(best + (WSOLA_HOP + frame) as u64, channel)
                        .unwrap_or(0.0);
                }
            }
        } else {
            let emitted_frames = overlap + body;
            let remaining_start = best.saturating_add(emitted_frames as u64);
            for frame in remaining_start..available_end {
                for channel in 0..self.channels {
                    if let Some(sample) = self.sample_frame(frame, channel) {
                        self.output.push_back(sample);
                    }
                }
            }
            self.finished = true;
        }

        let next_expected = expected.saturating_add(analysis_hop);
        self.expected_start = Some(next_expected);
        let retain_from = next_expected
            .saturating_sub(WSOLA_SEARCH)
            .max(self.input_base);
        let drop_frames = retain_from.saturating_sub(self.input_base);
        let drop_samples = usize::try_from(drop_frames)
            .unwrap_or(usize::MAX)
            .saturating_mul(self.channels)
            .min(self.input.len());
        for _ in 0..drop_samples {
            self.input.pop_front();
        }
        self.input_base = self
            .input_base
            .saturating_add((drop_samples / self.channels) as u64);
    }
}

impl<S> Iterator for TimeStretchSource<S>
where
    S: Source<Item = f32>,
{
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        if self.output.is_empty() && !self.finished {
            self.generate_block();
        }
        self.output.pop_front()
    }
}

impl<S> Source for TimeStretchSource<S>
where
    S: Source<Item = f32>,
{
    fn current_frame_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> u16 {
        self.inner.channels()
    }

    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        None
    }
}

pub fn rate_source<S>(source: S, shared: SharedRate) -> Box<dyn Source<Item = f32> + Send>
where
    S: Source<Item = f32> + Send + 'static,
{
    if shared.preserves_pitch() {
        Box::new(TimeStretchSource::new(source, shared))
    } else {
        Box::new(RateSource::new(source, shared))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rodio::buffer::SamplesBuffer;

    fn stretched_sine(rate: f32) -> Vec<f32> {
        let sample_rate = 48_000u32;
        let samples = (0..sample_rate)
            .map(|index| {
                (2.0 * std::f32::consts::PI * 440.0 * index as f32 / sample_rate as f32).sin()
            })
            .collect::<Vec<_>>();
        let source = SamplesBuffer::new(1, sample_rate, samples);
        let shared = SharedRate::new();
        shared.set(rate, true);
        TimeStretchSource::new(source, shared).collect()
    }

    #[test]
    fn preserves_duration_at_normal_rate() {
        let output = stretched_sine(1.0);
        assert_eq!(output.len(), 48_000);
    }

    #[test]
    fn changes_tempo_without_changing_pitch() {
        let output = stretched_sine(2.0);
        assert!((22_000..=26_000).contains(&output.len()));

        let crossings = output
            .windows(2)
            .filter(|pair| pair[0] <= 0.0 && pair[1] > 0.0)
            .count();
        assert!((190..=250).contains(&crossings));
    }

    #[test]
    fn slows_tempo_without_changing_pitch() {
        let output = stretched_sine(0.5);
        assert!(
            (90_000..=102_000).contains(&output.len()),
            "unexpected stretched sample count: {}",
            output.len()
        );

        let crossings = output
            .windows(2)
            .filter(|pair| pair[0] <= 0.0 && pair[1] > 0.0)
            .count();
        assert!((820..=940).contains(&crossings));
    }
}
