//! Decodificador Symphonia con búsqueda rápida.

use super::*;

/// Source que decodifica con symphonia desde una posición (seek real, no skip de samples).
pub struct SymphoniaPlaySource {
    pub decoder: Box<dyn symphonia::core::codecs::Decoder>,
    pub format: Box<dyn symphonia::core::formats::FormatReader>,
    pub track_id: u32,
    pub sample_rate: u32,
    pub channels: u16,
    pub buffer: SampleBuffer<f32>,
    pub interleave_pos: usize,
    pub interleave: Vec<f32>,
    pub exhausted: bool,
}

impl SymphoniaPlaySource {
    pub fn open(path: &Path, start_secs: f64) -> Result<Self, String> {
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

    pub fn fill_interleave(&mut self) -> bool {
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
