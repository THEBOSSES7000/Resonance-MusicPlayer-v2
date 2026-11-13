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
    pub consecutive_decode_errors: u8,
    pub consecutive_resets: u8,
    pub reported_error: bool,
    pub playback_error: Arc<Mutex<Option<String>>>,
}

impl SymphoniaPlaySource {
    pub fn open(
        path: &Path,
        start_secs: f64,
        playback_error: Arc<Mutex<Option<String>>>,
    ) -> Result<Self, String> {
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
            format
                .seek(
                    SeekMode::Accurate,
                    SeekTo::Time {
                        track_id: Some(track_id),
                        time,
                    },
                )
                .map_err(|error| format!("No se pudo buscar en el audio: {error}"))?;
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
            consecutive_decode_errors: 0,
            consecutive_resets: 0,
            reported_error: false,
            playback_error,
        })
    }

    fn fail(&mut self, message: String) {
        let mut error = self
            .playback_error
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *error = Some(message);
        self.reported_error = true;
        self.exhausted = true;
    }

    fn report_error(&mut self, message: String) {
        if self.reported_error {
            return;
        }
        let mut error = self
            .playback_error
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if error.is_none() {
            *error = Some(message);
        }
        self.reported_error = true;
    }

    pub fn fill_interleave(&mut self) -> bool {
        if self.exhausted {
            return false;
        }
        loop {
            let packet = match self.format.next_packet() {
                Ok(p) => p,
                Err(SymphoniaError::ResetRequired) => {
                    self.consecutive_resets = self.consecutive_resets.saturating_add(1);
                    if self.consecutive_resets >= 8 {
                        self.fail(
                            "El contenedor solicitó demasiados reinicios del decodificador."
                                .to_string(),
                        );
                        return false;
                    }
                    self.decoder.reset();
                    continue;
                }
                Err(SymphoniaError::IoError(ref e))
                    if e.kind() == std::io::ErrorKind::UnexpectedEof =>
                {
                    self.exhausted = true;
                    return false;
                }
                Err(error) => {
                    self.fail(format!("No se pudo leer un paquete de audio: {error}"));
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
                    self.consecutive_decode_errors = 0;
                    self.consecutive_resets = 0;
                    if !self.interleave.is_empty() {
                        return true;
                    }
                }
                Err(SymphoniaError::DecodeError(message)) => {
                    self.consecutive_decode_errors =
                        self.consecutive_decode_errors.saturating_add(1);
                    self.report_error(format!(
                        "Se omitió un paquete de audio no decodificable: {message}"
                    ));
                    if self.consecutive_decode_errors >= 32 {
                        self.fail(format!(
                            "No se pudo decodificar el audio tras 32 paquetes consecutivos: {message}"
                        ));
                        return false;
                    }
                    continue;
                }
                Err(error) => {
                    self.fail(format!("Falló el decodificador de audio: {error}"));
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

/// Decodes ahead on a worker thread and keeps a bounded queue ready for the output mixer.
pub struct BufferedSource {
    receiver: std::sync::mpsc::Receiver<Vec<f32>>,
    current: std::vec::IntoIter<f32>,
    channels: u16,
    sample_rate: u32,
}

impl BufferedSource {
    pub fn new<S>(mut inner: S) -> Result<Self, String>
    where
        S: Source<Item = f32> + Send + 'static,
    {
        const BUFFER_FRAMES: usize = 4096;
        let channels = inner.channels().max(1);
        let sample_rate = inner.sample_rate();
        let samples_per_buffer = BUFFER_FRAMES * channels as usize;
        let (sender, receiver) = std::sync::mpsc::sync_channel::<Vec<f32>>(4);
        let _worker = thread::Builder::new()
            .name("resonance-audio-decode".into())
            .spawn(move || loop {
                let mut samples = Vec::with_capacity(samples_per_buffer);
                while samples.len() < samples_per_buffer {
                    match inner.next() {
                        Some(sample) => samples.push(sample),
                        None => break,
                    }
                }
                if samples.is_empty() || sender.send(samples).is_err() {
                    break;
                }
                if inner.current_frame_len() == Some(0) {
                    break;
                }
            })
            .map_err(|error| format!("No se pudo crear el hilo de decodificación: {error}"))?;

        let current = receiver.recv().unwrap_or_default().into_iter();
        Ok(Self {
            receiver,
            current,
            channels,
            sample_rate,
        })
    }
}

impl Iterator for BufferedSource {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        loop {
            if let Some(sample) = self.current.next() {
                return Some(sample);
            }
            self.current = self.receiver.recv().ok()?.into_iter();
        }
    }
}

impl Source for BufferedSource {
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

#[cfg(test)]
mod tests {
    use super::*;
    use rodio::buffer::SamplesBuffer;

    #[test]
    fn buffered_source_preserves_interleaved_samples() {
        let samples = (0..20_000)
            .map(|index| (index as f32 / 20_000.0) * 2.0 - 1.0)
            .collect::<Vec<_>>();
        let source = SamplesBuffer::new(2, 48_000, samples.clone());
        let output = BufferedSource::new(source)
            .expect("decoder worker should start")
            .collect::<Vec<_>>();

        assert_eq!(output, samples);
    }
}
