use discord_rich_presence::{
    activity::{Activity, ActivityType, Assets, Timestamps},
    DiscordIpc, DiscordIpcClient,
};
use notify::{event::ModifyKind, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock, RwLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

mod native_audio;
mod shortcuts_tray;
mod replay_gain;
mod performance;
mod discord;
mod windows_media;
mod library_types;
mod storage;
mod settings;
mod library_cache;
mod music_directories;
mod exports;
mod metadata;
mod online_metadata;
mod library_scan;

use shortcuts_tray::*;
use discord::*;
use windows_media::*;
use library_types::*;
use storage::*;
use settings::*;
use library_cache::*;
use music_directories::*;
use metadata::*;

/// `main.rs` (otro crate) llama a esta función, así que debe seguir siendo pública en la raíz de la librería.
pub use windows_media::set_app_user_model_id;

#[cfg(windows)]
use windows::{
    Foundation::{TimeSpan, TypedEventHandler},
    Media::Playback::MediaPlayer,
    Media::{
        MediaPlaybackStatus, MediaPlaybackType, PlaybackPositionChangeRequestedEventArgs,
        SystemMediaTransportControls, SystemMediaTransportControlsButton,
        SystemMediaTransportControlsButtonPressedEventArgs,
        SystemMediaTransportControlsTimelineProperties,
    },
    Storage::Streams::{DataWriter, InMemoryRandomAccessStream, RandomAccessStreamReference},
};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Ruta al icono .ico de la app (junto al .exe en release, o icons/ en dev).
#[cfg(windows)]

/// Renombra en el mezclador las sesiones de audio de WebView2 / Chromium a "Resonance"
/// y les asigna el icono de la app (workaround Core Audio; limitación de Microsoft).
/// Antes se reetiquetaban sesiones ajenas del mezclador como «Resonance» (heurística
/// demasiado amplia: renombraba otras apps). Ya no se toca ninguna sesión externa.
/// WebView2 va con --mute-audio; el audio real solo sale de rodio.



#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    set_app_user_model_id();
    tauri::Builder::default()
        .manage(MusicWatcher::default())
        .manage(native_audio::NativeAudioState::default())
        .manage(WindowsMediaSession::default())
        .manage(GlobalShortcutRegistry::default())
        .manage(DiscordRpcState::default())
        .manage(DiscordCoverCache::default())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = window.unminimize() {
                    eprintln!("No se pudo restaurar la ventana de Resonance: {error}");
                }
                if let Err(error) = window.show() {
                    eprintln!("No se pudo mostrar la instancia existente de Resonance: {error}");
                }
                if let Err(error) = window.set_focus() {
                    eprintln!("No se pudo enfocar la instancia existente de Resonance: {error}");
                }
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            build_system_tray(app)?;
            // Entregar AppHandle al motor de audio nativo para emitir `audio-energy` (Visual+)
            app.state::<native_audio::NativeAudioState>()
                .set_app_handle(app.handle().clone());
            // Caché persistente de waveforms en el directorio de datos de la app
            match app_data_storage_directory(app.handle()) {
                Ok(dir) => native_audio::init_waveform_cache_dir(dir),
                Err(error) => eprintln!(
                    "No se pudo inicializar la caché de waveforms en disco: {error}"
                ),
            }
            if let Err(error) =
                initialize_discord_cover_cache(app.handle(), &app.state::<DiscordCoverCache>())
            {
                eprintln!("No se pudo inicializar la caché de carátulas de Discord: {error}");
            }
            if let Err(error) =
                initialize_windows_media_session(app.handle(), &app.state::<WindowsMediaSession>())
            {
                eprintln!("No se pudo inicializar la sesión multimedia de Windows: {error}");
            }
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = restore_window_bounds(&window) {
                    eprintln!(
                        "No se pudo restaurar el tamaño y la posición de la ventana: {error}"
                    );
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                if let Err(error) = persist_window_bounds_from_window(window) {
                    eprintln!("No se pudo guardar el tamaño y la posición de la ventana: {error}");
                }
                if MINIMIZE_TO_TRAY.load(Ordering::Relaxed) {
                    api.prevent_close();
                    if let Err(error) = window.hide() {
                        eprintln!("No se pudo ocultar Resonance en la bandeja: {error}");
                    } else {
                        set_tray_visible(window.app_handle(), true);
                    }
                }
            }
            WindowEvent::Resized(size)
                if MINIMIZE_TO_TRAY.load(Ordering::Relaxed)
                    && (size.width == 0 || size.height == 0) =>
            {
                if let Err(error) = window.hide() {
                    eprintln!("No se pudo minimizar Resonance en la bandeja: {error}");
                } else {
                    set_tray_visible(window.app_handle(), true);
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            storage::get_storage_info,
            storage::open_storage_directory,
            storage::set_storage_location,
            settings::load_app_settings,
            settings::save_app_settings,
            settings::save_window_bounds,
            discord::set_discord_rpc_enabled,
            discord::update_discord_presence,
            music_directories::add_music_directory,
            music_directories::select_music_file,
            exports::save_m3u8_file,
            exports::save_settings_backup,
            music_directories::remove_music_directory,
            music_directories::list_music_subfolders,
            music_directories::set_music_subfolder_excluded,
            music_directories::get_music_directories,
            music_directories::replace_music_directories,
            library_scan::scan_music_library,
            library_scan::cancel_music_library_scan,
            library_cache::get_cached_music_library,
            library_cache::save_cached_music_library,
            exports::save_playlist_cover,
            library_cache::get_library_cache_size,
            library_cache::clear_library_cache,
            music_directories::configure_music_watcher,
            shortcuts_tray::set_minimize_to_tray,
            shortcuts_tray::set_global_shortcuts,
            windows_media::update_windows_media_metadata,
            windows_media::update_windows_media_playback,
            windows_media::seek_windows_media_position,
            music_directories::delete_music_file,
            metadata::update_track_tags,
            metadata::read_track_text_metadata,
            metadata::scan_file_metadata,
            metadata::scan_files_metadata,
            online_metadata::fetch_metadata_by_text,
            online_metadata::fetch_metadata_by_fingerprint,
            online_metadata::fetch_cover_art,
            online_metadata::search_lrclib_lyrics,
            online_metadata::search_lyricsplus_lyrics,
            online_metadata::search_deezer_lyrics,
            replay_gain::scan_missing_replay_gain,
            replay_gain::cancel_replay_gain_scan,
            windows_media::set_taskbar_playback_progress,
            performance::get_performance_metrics,
            native_audio::commands::native_audio_load,
            native_audio::commands::native_audio_crossfade,
            native_audio::commands::native_audio_play,
            native_audio::commands::native_audio_pause,
            native_audio::commands::native_audio_seek,
            native_audio::commands::native_audio_set_volume,
            native_audio::commands::native_audio_set_eq,
            native_audio::commands::native_audio_set_rate,
            native_audio::commands::native_audio_list_output_devices,
            native_audio::commands::native_audio_set_output_device,
            native_audio::commands::native_audio_stop,
            native_audio::commands::native_audio_status,
            native_audio::waveform::native_audio_waveform_peaks
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


#[cfg(test)]
mod tests {
    use super::{
        copy_directory_contents, copy_directory_contents_if_missing, is_valid_app_setting,
    };
    use std::{fs, time::SystemTime};

    #[test]
    fn visual_plus_settings_accept_known_shapes() {
        let valid: serde_json::Value = serde_json::json!({
            "enabled": false,
            "theme": "shooting_stars",
            "starCount": 120,
            "shootingStarCount": 2,
            "shootingInterval": 4,
            "shootingSpeed": 100,
            "trailLength": 170
        });
        let other_theme: serde_json::Value =
            serde_json::json!({ "enabled": true, "theme": "atmospheric" });
        let with_extra: serde_json::Value =
            serde_json::json!({ "enabled": true, "theme": "shooting_stars", "extra": true });

        assert!(is_valid_app_setting("visual_plus", &valid));
        assert!(is_valid_app_setting("visual_plus", &other_theme));
        assert!(is_valid_app_setting("visual_plus", &with_extra));
        assert!(!is_valid_app_setting(
            "visual_plus",
            &serde_json::Value::String("nope".into())
        ));
    }

    #[test]
    fn new_prefixed_settings_are_persistable_as_strings() {
        let volume = serde_json::Value::String("72".to_string());
        let visual_plus = serde_json::Value::String(
            serde_json::json!({
                "enabled": true,
                "theme": "atmospheric",
                "particleCount": 90,
                "particleColorMode": "custom",
                "particleColor": "#c084fc",
                "firefliesEnabled": true,
                "rainEnabled": true
            })
            .to_string(),
        );

        assert!(is_valid_app_setting("pn_volume", &volume));
        assert!(is_valid_app_setting("pn_visual_plus", &visual_plus));
        assert!(!is_valid_app_setting(
            "pn_volume",
            &serde_json::json!(72)
        ));
    }

    #[test]
    fn storage_migration_copies_nested_files() {
        let unique_id = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system clock should be after UNIX epoch")
            .as_nanos();
        let test_root = std::env::temp_dir().join(format!(
            "resonance-storage-migration-{}-{unique_id}",
            std::process::id()
        ));
        let source = test_root.join("source");
        let destination = test_root.join("destination");
        let nested_directory = source.join("library-cache").join("covers");
        fs::create_dir_all(&nested_directory).expect("source directories should be created");
        fs::write(source.join("music-directories.json"), b"[]")
            .expect("configuration should be written");
        fs::write(nested_directory.join("cover.jpg"), b"cover").expect("cover should be written");

        copy_directory_contents(&source, &destination).expect("storage should be copied");

        assert_eq!(
            fs::read(destination.join("music-directories.json"))
                .expect("configuration should be copied"),
            b"[]"
        );
        assert_eq!(
            fs::read(
                destination
                    .join("library-cache")
                    .join("covers")
                    .join("cover.jpg")
            )
            .expect("cover should be copied"),
            b"cover"
        );
        fs::remove_dir_all(test_root).expect("test data should be removed");
    }

    #[test]
    fn storage_migration_preserves_existing_files_and_copies_missing_ones() {
        let unique_id = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system clock should be after UNIX epoch")
            .as_nanos();
        let test_root = std::env::temp_dir().join(format!(
            "resonance-storage-merge-{}-{unique_id}",
            std::process::id()
        ));
        let source = test_root.join("legacy");
        let destination = test_root.join("ResonanceMusicPlayer");
        fs::create_dir_all(source.join("library-cache"))
            .expect("legacy cache directory should be created");
        fs::create_dir_all(destination.join("library-cache"))
            .expect("destination cache directory should be created");
        fs::write(source.join("settings.json"), b"legacy")
            .expect("legacy settings should be written");
        fs::write(destination.join("settings.json"), b"current")
            .expect("current settings should be written");
        fs::write(source.join("library-cache").join("cover.jpg"), b"cover")
            .expect("legacy cover should be written");

        copy_directory_contents_if_missing(&source, &destination)
            .expect("legacy data should be merged");

        assert_eq!(
            fs::read(destination.join("settings.json")).expect("settings should remain"),
            b"current"
        );
        assert_eq!(
            fs::read(destination.join("library-cache").join("cover.jpg"))
                .expect("missing cache file should be copied"),
            b"cover"
        );
        fs::remove_dir_all(test_root).expect("test data should be removed");
    }

    #[test]
    fn shortcut_default_and_recorded_keys_parse() {
        for shortcut in [
            "MediaPlayPause",
            "MediaTrackNext",
            "MediaTrackPrevious",
            "AudioVolumeUp",
            "AudioVolumeDown",
            "AudioVolumeMute",
            "Space",
            "Ctrl+ArrowRight",
            "Ctrl+ArrowLeft",
            "Ctrl+Alt+ArrowRight",
            "Ctrl+Alt+ArrowLeft",
            "Ctrl+ArrowUp",
            "Ctrl+ArrowDown",
            "Ctrl+Shift+M",
        ] {
            assert!(
                shortcut
                    .parse::<tauri_plugin_global_shortcut::Shortcut>()
                    .is_ok(),
                "Shortcut should parse: {shortcut}"
            );
        }
    }
}