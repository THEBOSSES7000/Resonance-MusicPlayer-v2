//! Integración con Windows: controles multimedia, barra de tareas e identificador de app.

use super::*;

#[derive(Default)]
pub struct WindowsMediaSession {
    #[cfg(windows)]
    pub inner: Mutex<Option<WindowsMediaSessionState>>,
}

#[cfg(windows)]
pub struct WindowsMediaSessionState {
    pub _player: MediaPlayer,
    pub controls: SystemMediaTransportControls,
    pub _artwork_stream: Option<RandomAccessStreamReference>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsMediaControlEvent {
    pub action: String,
    pub position_seconds: Option<f64>,
}

#[tauri::command]
pub fn set_taskbar_playback_progress(
    app: AppHandle,
    progress: Option<u64>,
    paused: bool,
) -> Result<(), String> {
    use tauri::window::{ProgressBarState, ProgressBarStatus};

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "No se encontró la ventana principal.".to_string())?;
    let status = if progress.is_none() {
        ProgressBarStatus::None
    } else if paused {
        ProgressBarStatus::Paused
    } else {
        ProgressBarStatus::Normal
    };
    window
        .set_progress_bar(ProgressBarState {
            status: Some(status),
            progress,
        })
        .map_err(|error| {
            format!("No se pudo actualizar el progreso de la barra de tareas: {error}")
        })
}

#[cfg(windows)]
pub fn initialize_windows_media_session(
    app: &AppHandle,
    session: &WindowsMediaSession,
) -> Result<(), String> {
    let player = MediaPlayer::new().map_err(|error| error.to_string())?;
    let _ = player.SetVolume(0.0);
    let _ = player.SetIsMuted(true);
    let command_manager = player.CommandManager().map_err(|error| error.to_string())?;
    command_manager
        .SetIsEnabled(true)
        .map_err(|error| error.to_string())?;
    let controls = player
        .SystemMediaTransportControls()
        .map_err(|error| error.to_string())?;
    controls
        .SetIsEnabled(true)
        .map_err(|error| error.to_string())?;
    controls
        .SetIsPlayEnabled(true)
        .map_err(|error| error.to_string())?;
    controls
        .SetIsPauseEnabled(true)
        .map_err(|error| error.to_string())?;
    controls
        .SetIsNextEnabled(true)
        .map_err(|error| error.to_string())?;
    controls
        .SetIsPreviousEnabled(true)
        .map_err(|error| error.to_string())?;

    let control_app = app.clone();
    controls
        .ButtonPressed(&TypedEventHandler::new(
            move |_,
                  args: windows::core::Ref<
                '_,
                SystemMediaTransportControlsButtonPressedEventArgs,
            >| {
                let args = args.as_ref();
                let Some(args) = args else {
                    return Ok(());
                };
                let action = match args.Button()? {
                    SystemMediaTransportControlsButton::Play => "play",
                    SystemMediaTransportControlsButton::Pause => "pause",
                    SystemMediaTransportControlsButton::Next => "next",
                    SystemMediaTransportControlsButton::Previous => "previous",
                    _ => return Ok(()),
                };
                if let Err(error) = control_app.emit(
                    "windows-media-control",
                    WindowsMediaControlEvent {
                        action: action.to_string(),
                        position_seconds: None,
                    },
                ) {
                    eprintln!("No se pudo enviar el control multimedia de Windows: {error}");
                }
                Ok(())
            },
        ))
        .map_err(|error| error.to_string())?;

    let seek_app = app.clone();
    controls
        .PlaybackPositionChangeRequested(&TypedEventHandler::new(
            move |_, args: windows::core::Ref<'_, PlaybackPositionChangeRequestedEventArgs>| {
                let Some(args) = args.as_ref() else {
                    return Ok(());
                };
                let position_seconds =
                    args.RequestedPlaybackPosition()?.Duration as f64 / 10_000_000.0;
                if let Err(error) = seek_app.emit(
                    "windows-media-control",
                    WindowsMediaControlEvent {
                        action: "seek".to_string(),
                        position_seconds: Some(position_seconds),
                    },
                ) {
                    eprintln!("No se pudo enviar la búsqueda multimedia de Windows: {error}");
                }
                Ok(())
            },
        ))
        .map_err(|error| error.to_string())?;

    let mut media_session = session
        .inner
        .lock()
        .map_err(|error| format!("No se pudo inicializar la sesión multimedia: {error}"))?;
    *media_session = Some(WindowsMediaSessionState {
        _player: player,
        controls,
        _artwork_stream: None,
    });
    Ok(())
}

#[cfg(not(windows))]
pub fn initialize_windows_media_session(
    _app: &AppHandle,
    _session: &WindowsMediaSession,
) -> Result<(), String> {
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsMediaMetadata {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub cover_path: Option<String>,
    pub artwork_base64: Option<String>,
}

#[tauri::command]
pub fn update_windows_media_metadata(
    metadata: WindowsMediaMetadata,
    session: State<'_, WindowsMediaSession>,
    app: AppHandle,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        {
            let needs_init = session
                .inner
                .lock()
                .map(|g| g.is_none())
                .unwrap_or(false);
            if needs_init {
                initialize_windows_media_session(&app, &session)?;
            }
        }
        if metadata.title.len() > 1024
            || metadata.artist.len() > 1024
            || metadata.album.len() > 1024
        {
            return Err("Los metadatos de la pista superan el tamaño permitido.".to_string());
        }
        if metadata
            .artwork_base64
            .as_ref()
            .is_some_and(|artwork| artwork.len() > 12 * 1024 * 1024)
        {
            return Err("La portada supera el tamaño máximo permitido de 8 MiB.".to_string());
        }

        let mut session = session
            .inner
            .lock()
            .map_err(|error| format!("No se pudo acceder a la sesión multimedia: {error}"))?;
        let media_session = session
            .as_mut()
            .ok_or_else(|| "La sesión multimedia de Windows no está inicializada.".to_string())?;
        let updater = media_session
            .controls
            .DisplayUpdater()
            .map_err(|error| error.to_string())?;
        updater.ClearAll().map_err(|error| error.to_string())?;
        updater
            .SetType(MediaPlaybackType::Music)
            .map_err(|error| error.to_string())?;
        let properties = updater
            .MusicProperties()
            .map_err(|error| error.to_string())?;
        properties
            .SetTitle(&windows::core::HSTRING::from(metadata.title))
            .map_err(|error| error.to_string())?;
        properties
            .SetArtist(&windows::core::HSTRING::from(metadata.artist))
            .map_err(|error| error.to_string())?;
        properties
            .SetAlbumTitle(&windows::core::HSTRING::from(metadata.album))
            .map_err(|error| error.to_string())?;

        // Priorizar lectura directa de archivo en disco para evitar mandar Base64 desde WebView2
        let raw_bytes: Option<Vec<u8>> = if let Some(ref cover_path) = metadata
            .cover_path
            .as_deref()
            .filter(|p| !p.is_empty() && *p != "none")
        {
            let p = Path::new(cover_path);
            if p.is_file() {
                fs::read(p).ok()
            } else {
                None
            }
        } else if let Some(artwork_base64) = metadata.artwork_base64 {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD
                .decode(artwork_base64)
                .ok()
        } else {
            None
        };

        let artwork_stream = if let Some(bytes) = raw_bytes {
            if bytes.len() <= 8 * 1024 * 1024 {
                let stream = InMemoryRandomAccessStream::new().map_err(|error| error.to_string())?;
                let writer =
                    DataWriter::CreateDataWriter(&stream).map_err(|error| error.to_string())?;
                writer
                    .WriteBytes(&bytes)
                    .map_err(|error| error.to_string())?;
                writer
                    .StoreAsync()
                    .map_err(|error| error.to_string())?
                    .join()
                    .map_err(|error| error.to_string())?;
                writer
                    .FlushAsync()
                    .map_err(|error| error.to_string())?
                    .join()
                    .map_err(|error| error.to_string())?;
                writer.DetachStream().map_err(|error| error.to_string())?;
                stream.Seek(0).map_err(|error| error.to_string())?;
                let reference = RandomAccessStreamReference::CreateFromStream(&stream)
                    .map_err(|error| error.to_string())?;
                updater
                    .SetThumbnail(&reference)
                    .map_err(|error| error.to_string())?;
                Some(reference)
            } else {
                None
            }
        } else {
            None
        };

        updater.Update().map_err(|error| error.to_string())?;
        media_session._artwork_stream = artwork_stream;
    }
    #[cfg(not(windows))]
    let _ = (metadata, session);
    Ok(())
}

#[tauri::command]
pub fn update_windows_media_playback(
    playing: bool,
    position_seconds: f64,
    duration_seconds: f64,
    session: State<'_, WindowsMediaSession>,
    app: AppHandle,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        // Lazy: el MediaPlayer de SMTC abre una sesión en el mezclador; solo al usar controles de medios
        {
            let needs_init = session
                .inner
                .lock()
                .map(|g| g.is_none())
                .unwrap_or(false);
            if needs_init {
                initialize_windows_media_session(&app, &session)?;
            }
        }

        let session = session
            .inner
            .lock()
            .map_err(|error| format!("No se pudo acceder a la sesión multimedia: {error}"))?;
        let media_session = session
            .as_ref()
            .ok_or_else(|| "La sesión multimedia de Windows no está inicializada.".to_string())?;
        media_session
            .controls
            .SetPlaybackStatus(if playing {
                MediaPlaybackStatus::Playing
            } else {
                MediaPlaybackStatus::Paused
            })
            .map_err(|error| error.to_string())?;

        if duration_seconds.is_finite() && duration_seconds > 0.0 {
            let position = if position_seconds.is_finite() {
                position_seconds.clamp(0.0, duration_seconds)
            } else {
                0.0
            };
            let timeline = SystemMediaTransportControlsTimelineProperties::new()
                .map_err(|error| error.to_string())?;
            timeline
                .SetStartTime(TimeSpan { Duration: 0 })
                .map_err(|error| error.to_string())?;
            timeline
                .SetEndTime(TimeSpan {
                    Duration: (duration_seconds * 10_000_000.0) as i64,
                })
                .map_err(|error| error.to_string())?;
            timeline
                .SetPosition(TimeSpan {
                    Duration: (position * 10_000_000.0) as i64,
                })
                .map_err(|error| error.to_string())?;
            media_session
                .controls
                .UpdateTimelineProperties(&timeline)
                .map_err(|error| error.to_string())?;
        }
    }
    #[cfg(not(windows))]
    let _ = (playing, position_seconds, duration_seconds, session);
    Ok(())
}

#[tauri::command]
pub fn seek_windows_media_position(
    position_seconds: f64,
    duration_seconds: f64,
    session: State<'_, WindowsMediaSession>,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        if !position_seconds.is_finite() || !duration_seconds.is_finite() || duration_seconds <= 0.0
        {
            return Err("La posición multimedia recibida no es válida.".to_string());
        }
        let session = session
            .inner
            .lock()
            .map_err(|error| format!("No se pudo acceder a la sesión multimedia: {error}"))?;
        let media_session = session
            .as_ref()
            .ok_or_else(|| "La sesión multimedia de Windows no está inicializada.".to_string())?;
        let position = position_seconds.clamp(0.0, duration_seconds);
        let timeline = SystemMediaTransportControlsTimelineProperties::new()
            .map_err(|error| error.to_string())?;
        timeline
            .SetStartTime(TimeSpan { Duration: 0 })
            .map_err(|error| error.to_string())?;
        timeline
            .SetEndTime(TimeSpan {
                Duration: (duration_seconds * 10_000_000.0) as i64,
            })
            .map_err(|error| error.to_string())?;
        timeline
            .SetPosition(TimeSpan {
                Duration: (position * 10_000_000.0) as i64,
            })
            .map_err(|error| error.to_string())?;
        media_session
            .controls
            .UpdateTimelineProperties(&timeline)
            .map_err(|error| error.to_string())?;
    }
    #[cfg(not(windows))]
    let _ = (position_seconds, duration_seconds, session);
    Ok(())
}

/// AppUserModelID explícito (mismo que `identifier` en tauri.conf.json).
/// Debe llamarse antes de mostrar UI / crear WebView2.
#[cfg(windows)]
pub fn set_app_user_model_id() {
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
    let aumid: Vec<u16> = "com.resonance.app"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        if let Err(error) = SetCurrentProcessExplicitAppUserModelID(PCWSTR(aumid.as_ptr())) {
            eprintln!("[Resonance] AppUserModelID: {error}");
        }
    }
}

#[cfg(not(windows))]
pub fn set_app_user_model_id() {}
