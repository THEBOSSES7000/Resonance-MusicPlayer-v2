//! Comandos de Tauri del motor nativo (cargar, reproducir, pausar, buscar, volumen, ecualizador...).

use super::*;

pub fn send_cmd_blocking(
    tx: &Sender<AudioCmd>,
    build: impl FnOnce(Sender<Result<NativeAudioStatus, String>>) -> AudioCmd,
) -> Result<NativeAudioStatus, String> {
    let (reply_tx, reply_rx) = mpsc::channel();
    let cmd = build(reply_tx);
    tx.send(cmd)
        .map_err(|_| "El hilo de audio nativo no está disponible.".to_string())?;
    reply_rx
        .recv_timeout(Duration::from_secs(45))
        .map_err(|_| "Tiempo de espera agotado en el motor de audio.".to_string())?
}

pub fn with_tx<R>(
    state: &State<'_, NativeAudioState>,
    f: impl FnOnce(&Sender<AudioCmd>) -> Result<R, String>,
) -> Result<R, String> {
    let guard = state
        .tx
        .lock()
        .map_err(|_| "No se pudo acceder al motor de audio.".to_string())?;
    f(&guard)
}

#[tauri::command]
pub async fn native_audio_load(
    state: State<'_, NativeAudioState>,
    path: String,
    auto_play: bool,
    volume: Option<f32>,
    fade_in_secs: Option<f64>,
) -> Result<NativeAudioStatus, String> {
    let fade_in_secs = fade_in_secs.unwrap_or(0.0);
    let tx = with_tx(&state, |tx| Ok(tx.clone()))?;
    tauri::async_runtime::spawn_blocking(move || {
        send_cmd_blocking(&tx, |reply| AudioCmd::Load {
            path,
            auto_play,
            volume,
            fade_in_secs,
            reply,
        })
    })
    .await
    .map_err(|e| format!("Error en el motor de audio: {e}"))?
}

#[tauri::command]
pub async fn native_audio_crossfade(
    state: State<'_, NativeAudioState>,
    path: String,
    duration_secs: Option<f64>,
    volume: Option<f32>,
) -> Result<NativeAudioStatus, String> {
    let duration_secs = duration_secs.unwrap_or(4.0).clamp(0.25, 12.0);
    let tx = with_tx(&state, |tx| Ok(tx.clone()))?;
    tauri::async_runtime::spawn_blocking(move || {
        send_cmd_blocking(&tx, |reply| AudioCmd::Crossfade {
            path,
            duration_secs,
            volume,
            reply,
        })
    })
    .await
    .map_err(|e| format!("Error en el motor de audio: {e}"))?
}

#[tauri::command]
pub async fn native_audio_play(
    state: State<'_, NativeAudioState>,
    fade_in_secs: Option<f64>,
) -> Result<NativeAudioStatus, String> {
    let fade_in_secs = fade_in_secs.unwrap_or(0.0);
    let tx = with_tx(&state, |tx| Ok(tx.clone()))?;
    tauri::async_runtime::spawn_blocking(move || {
        send_cmd_blocking(&tx, |reply| AudioCmd::Play {
            fade_in_secs,
            reply,
        })
    })
    .await
    .map_err(|e| format!("Error en el motor de audio: {e}"))?
}

#[tauri::command]
pub async fn native_audio_pause(
    state: State<'_, NativeAudioState>,
    fade_out_secs: Option<f64>,
) -> Result<NativeAudioStatus, String> {
    let fade_out_secs = fade_out_secs.unwrap_or(0.0);
    let tx = with_tx(&state, |tx| Ok(tx.clone()))?;
    tauri::async_runtime::spawn_blocking(move || {
        send_cmd_blocking(&tx, |reply| AudioCmd::Pause {
            fade_out_secs,
            reply,
        })
    })
    .await
    .map_err(|e| format!("Error en el motor de audio: {e}"))?
}

#[tauri::command]
pub async fn native_audio_seek(
    state: State<'_, NativeAudioState>,
    position_seconds: f64,
) -> Result<NativeAudioStatus, String> {
    let tx = with_tx(&state, |tx| Ok(tx.clone()))?;
    tauri::async_runtime::spawn_blocking(move || {
        send_cmd_blocking(&tx, |reply| AudioCmd::Seek {
            position_seconds,
            reply,
        })
    })
    .await
    .map_err(|e| format!("Error en el motor de audio: {e}"))?
}

#[tauri::command]
pub async fn native_audio_set_volume(
    state: State<'_, NativeAudioState>,
    volume: f32,
) -> Result<NativeAudioStatus, String> {
    let tx = with_tx(&state, |tx| Ok(tx.clone()))?;
    tauri::async_runtime::spawn_blocking(move || {
        send_cmd_blocking(&tx, |reply| AudioCmd::SetVolume { volume, reply })
    })
    .await
    .map_err(|e| format!("Error en el motor de audio: {e}"))?
}

/// Aplica el ecualizador gráfico nativo (20 bandas en dB, rango típico ±15).
#[tauri::command]
pub async fn native_audio_set_eq(
    state: State<'_, NativeAudioState>,
    enabled: bool,
    gains_db: Vec<f32>,
) -> Result<NativeAudioStatus, String> {
    let tx = with_tx(&state, |tx| Ok(tx.clone()))?;
    tauri::async_runtime::spawn_blocking(move || {
        send_cmd_blocking(&tx, |reply| AudioCmd::SetEq {
            enabled,
            gains_db,
            reply,
        })
    })
    .await
    .map_err(|e| format!("Error en el motor de audio: {e}"))?
}

/// Velocidad de reproducción efectiva (1.0 = normal). El tono se combina en el frontend.
#[tauri::command]
pub async fn native_audio_set_rate(
    state: State<'_, NativeAudioState>,
    rate: f32,
) -> Result<NativeAudioStatus, String> {
    let tx = with_tx(&state, |tx| Ok(tx.clone()))?;
    tauri::async_runtime::spawn_blocking(move || {
        send_cmd_blocking(&tx, |reply| AudioCmd::SetRate { rate, reply })
    })
    .await
    .map_err(|e| format!("Error en el motor de audio: {e}"))?
}

/// Lista dispositivos de salida (cpal / WASAPI compartido en Windows).
#[tauri::command]
pub fn native_audio_list_output_devices() -> Result<Vec<OutputDeviceInfo>, String> {
    use cpal::traits::{DeviceTrait, HostTrait};

    let host = cpal::default_host();
    let default_name = host
        .default_output_device()
        .and_then(|d| d.name().ok())
        .unwrap_or_default();
    let mut list = Vec::new();
    let devices = host
        .output_devices()
        .map_err(|e| format!("No se pudieron enumerar salidas de audio: {e}"))?;
    for device in devices {
        let Ok(name) = device.name() else {
            continue;
        };
        let is_default = !default_name.is_empty() && name == default_name;
        list.push(OutputDeviceInfo {
            id: name.clone(),
            name,
            is_default,
        });
    }
    Ok(list)
}

/// Cambia el dispositivo de salida del motor nativo (`null`/omitido = predeterminado).
#[tauri::command]
pub async fn native_audio_set_output_device(
    state: State<'_, NativeAudioState>,
    device_id: Option<String>,
) -> Result<NativeAudioStatus, String> {
    let tx = with_tx(&state, |tx| Ok(tx.clone()))?;
    tauri::async_runtime::spawn_blocking(move || {
        send_cmd_blocking(&tx, |reply| AudioCmd::SetOutputDevice { device_id, reply })
    })
    .await
    .map_err(|e| format!("Error en el motor de audio: {e}"))?
}

#[tauri::command]
pub async fn native_audio_stop(
    state: State<'_, NativeAudioState>,
) -> Result<NativeAudioStatus, String> {
    let tx = with_tx(&state, |tx| Ok(tx.clone()))?;
    tauri::async_runtime::spawn_blocking(move || {
        send_cmd_blocking(&tx, |reply| AudioCmd::Stop { reply })
    })
    .await
    .map_err(|e| format!("Error en el motor de audio: {e}"))?
}

#[tauri::command]
pub async fn native_audio_status(
    state: State<'_, NativeAudioState>,
) -> Result<NativeAudioStatus, String> {
    let tx = with_tx(&state, |tx| Ok(tx.clone()))?;
    tauri::async_runtime::spawn_blocking(move || {
        send_cmd_blocking(&tx, |reply| AudioCmd::Status { reply })
    })
    .await
    .map_err(|e| format!("Error en el motor de audio: {e}"))?
}
