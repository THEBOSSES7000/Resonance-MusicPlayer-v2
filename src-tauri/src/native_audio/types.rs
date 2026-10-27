//! Tipos públicos del motor nativo: estado, comandos internos y estado de reproducción.

use super::*;

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

pub enum AudioCmd {
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
    pub tx: Mutex<Sender<AudioCmd>>,
    /// Energía RMS normalizada (0.0–1.0) como bits de f32, actualizada desde el hilo de audio.
    #[allow(dead_code)]
    pub energy: Arc<AtomicU32>,
    /// AppHandle para emitir el evento `audio-energy` hacia el frontend (Visual+).
    pub app: Mutex<Option<AppHandle>>,
    /// Canal de un solo uso para entregar AppHandle al hilo de audio tras el setup.
    pub app_tx: Mutex<Option<Sender<AppHandle>>>,
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
