//! Reproductor: flujo de salida, hilo de audio y control de pistas.

use super::*;

pub struct Player {
    pub _stream: Option<rodio::OutputStream>,
    pub handle: Option<rodio::OutputStreamHandle>,
    pub sink: Option<rodio::Sink>,
    /// Sink de la pista entrante durante un crossfade.
    pub crossfade_sink: Option<rodio::Sink>,
    pub crossfade: Option<CrossfadeState>,
    pub path: Option<String>,
    pub volume: f32,
    pub applied_volume: f32,
    pub duration_secs: f64,
    pub offset_secs: f64,
    pub playing_since: Option<Instant>,
    pub fade: Option<FadeState>,
    /// Shared energy meter updated by MeasuringSource while samples are consumed.
    pub energy: Arc<AtomicU32>,
    /// Frames consumidos desde el último seek/load (reloj de audio real).
    pub frames_played: Arc<AtomicU64>,
    pub sample_rate: u32,
    pub eq: SharedEq,
    pub rate: SharedRate,
    /// Nombre del dispositivo cpal actual (`None` = default del sistema).
    pub output_device_id: Option<String>,
}

pub fn open_output_stream(
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
    pub fn try_new(energy: Arc<AtomicU32>, eq: SharedEq, rate: SharedRate) -> Result<Self, String> {
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
    pub fn ensure_output(&mut self) -> Result<(), String> {
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

    pub fn sink_mut(&mut self) -> Result<&mut rodio::Sink, String> {
        self.ensure_output()?;
        self.sink
            .as_mut()
            .ok_or_else(|| "Sink de audio no disponible".to_string())
    }

    pub fn handle_ref(&mut self) -> Result<&rodio::OutputStreamHandle, String> {
        self.ensure_output()?;
        self.handle
            .as_ref()
            .ok_or_else(|| "Handle de audio no disponible".to_string())
    }

    /// Reabre el stream en otro dispositivo (WASAPI shared) y restaura pista/posición.
    pub fn set_output_device(&mut self, device_id: Option<String>) -> Result<(), String> {
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

    pub fn position_seconds(&self) -> f64 {
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

    pub fn is_playing(&self) -> bool {
        if self.crossfade.is_some() {
            return true;
        }
        self.playing_since.is_some() && !self.sink.as_ref().map(|s| s.is_paused()).unwrap_or(true) && !self.sink.as_ref().map(|s| s.empty()).unwrap_or(true)
    }

    pub fn is_crossfading(&self) -> bool {
        self.crossfade.is_some()
    }

    pub fn cancel_fade(&mut self) {
        self.fade = None;
    }

    /// Aborta un crossfade en curso: detiene el sink saliente y promueve el entrante (si hay).
    pub fn abort_crossfade(&mut self, promote_incoming: bool) {
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

    pub fn apply_sink_volume(&mut self, vol: f32) {
        self.applied_volume = vol.clamp(0.0, 1.0);
        if let Some(ref mut s) = self.sink {
            s.set_volume(self.applied_volume);
        }
    }

    pub fn finish_pause_now(&mut self) {
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
    pub fn start_fade_in(&mut self, secs: f64) {
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

    pub fn start_fade_out(&mut self, secs: f64, pause_when_done: bool) {
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

    pub fn tick_fade(&mut self) {
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

    pub fn status(&self) -> NativeAudioStatus {
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

    pub fn append_path(&mut self, path: &Path, start_secs: f64, fade_in_secs: f64) -> Result<(), String> {
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
    pub fn start_crossfade(
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

    pub fn tick_crossfade(&mut self) {
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

    pub fn finish_crossfade(&mut self) {
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

pub fn probe_duration_secs(path: &Path) -> f64 {
    if let Ok(tagged) = lofty::read_from_path(path) {
        let secs = tagged.properties().duration().as_secs_f64();
        if secs.is_finite() && secs > 0.0 {
            return secs;
        }
    }
    0.0
}

pub fn audio_thread_main(
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

                // Emitir energía solo si el frontend lo activó (Visual+ / análisis de audio)
                if super::measuring::ENERGY_EMIT_ENABLED.load(Ordering::Relaxed) {
                    energy_emit_skip = energy_emit_skip.wrapping_add(1);
                    if energy_emit_skip % 2 == 0 {
                        if let Some(ref app) = app_handle {
                            let bits = energy.load(Ordering::Relaxed);
                            let level = f32::from_bits(bits);
                            let last = f32::from_bits(last_emitted_bits);
                            if player.is_playing() || level > 0.002 || last > 0.002 {
                                let _ = app.emit("audio-energy", level);
                                last_emitted_bits = bits;
                                // Espectro real para Wave Sound
                                if let Ok(spec) = super::measuring::LATEST_SPECTRUM.lock() {
                                    let bands: Vec<f32> = spec.iter().copied().collect();
                                    let _ = app.emit("audio-spectrum", bands);
                                }
                            }
                        }
                    }
                } else if energy_emit_skip != 0 {
                    energy_emit_skip = 0;
                    energy.store(0f32.to_bits(), Ordering::Relaxed);
                    last_emitted_bits = 0;
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
