//! Atajos globales, bandeja del sistema y minimizar a bandeja.

use super::*;

pub static MINIMIZE_TO_TRAY: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalShortcutBinding {
    pub action: String,
    pub shortcut: String,
}

#[derive(Default)]
pub struct GlobalShortcutRegistry(pub Mutex<Vec<GlobalShortcutBinding>>);

#[tauri::command]
pub fn set_minimize_to_tray(enabled: bool, app: AppHandle) {
    MINIMIZE_TO_TRAY.store(enabled, Ordering::Relaxed);
    if !enabled {
        // Sin la opción activa, el icono de bandeja no debe permanecer visible
        set_tray_visible(&app, false);
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
        }
    }
}

pub fn replace_global_shortcuts(
    app: &AppHandle,
    bindings: &[GlobalShortcutBinding],
) -> Result<(), String> {
    let mut parsed = Vec::with_capacity(bindings.len());
    let mut registered_ids = HashSet::with_capacity(bindings.len());
    for binding in bindings {
        if ![
            "playPause",
            "nextTrack",
            "prevTrack",
            "seekForward10",
            "seekBackward10",
            "volumeUp",
            "volumeDown",
            "mute",
            "shuffle",
            "repeat",
            "lyrics",
            "queue",
        ]
        .contains(&binding.action.as_str())
        {
            return Err(format!("Acción de atajo desconocida: {}", binding.action));
        }
        let shortcut = binding
            .shortcut
            .parse::<tauri_plugin_global_shortcut::Shortcut>()
            .map_err(|error| {
                format!(
                    "La combinación global \"{}\" no es válida: {error}",
                    binding.shortcut
                )
            })?;
        if !registered_ids.insert(shortcut.id) {
            return Err(format!(
                "La combinación global \"{}\" ya está asignada.",
                binding.shortcut
            ));
        }
        parsed.push((shortcut, binding.action.clone()));
    }

    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    app.global_shortcut().unregister_all().map_err(|error| {
        format!("No se pudieron quitar los atajos globales anteriores: {error}")
    })?;

    for (shortcut, action) in parsed {
        if let Err(error) =
            app.global_shortcut()
                .on_shortcut(shortcut, move |app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Err(error) = app.emit("global-shortcut-action", action.clone()) {
                            eprintln!("No se pudo enviar la acción de atajo global: {error}");
                        }
                    }
                })
        {
            let cleanup_error = app
                .global_shortcut()
                .unregister_all()
                .err()
                .map(|cleanup| format!(" Tampoco se pudo limpiar el registro parcial: {cleanup}"))
                .unwrap_or_default();
            return Err(format!(
                "No se pudo registrar un atajo global: {error}.{cleanup_error}"
            ));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn set_global_shortcuts(
    app: AppHandle,
    bindings: Vec<GlobalShortcutBinding>,
    registry: State<'_, GlobalShortcutRegistry>,
) -> Result<(), String> {
    let mut current_bindings = registry
        .0
        .lock()
        .map_err(|error| format!("No se pudo acceder al registro de atajos: {error}"))?;
    let previous_bindings = current_bindings.clone();

    if let Err(error) = replace_global_shortcuts(&app, &bindings) {
        if let Err(rollback_error) = replace_global_shortcuts(&app, &previous_bindings) {
            return Err(format!(
                "{error} No se pudieron restaurar los atajos anteriores: {rollback_error}"
            ));
        }
        return Err(error);
    }

    *current_bindings = bindings;
    Ok(())
}

pub fn set_tray_visible(app: &AppHandle, visible: bool) {
    if let Some(tray) = app.tray_by_id("resonance-tray") {
        if let Err(error) = tray.set_visible(visible) {
            eprintln!("No se pudo cambiar la visibilidad de la bandeja: {error}");
        }
    }
}

pub fn build_system_tray(app: &tauri::App) -> tauri::Result<()> {
    let play_pause = MenuItem::with_id(
        app,
        "tray_play_pause",
        "Reproducir / Pausar",
        true,
        None::<&str>,
    )?;
    let next = MenuItem::with_id(app, "tray_next", "Siguiente", true, None::<&str>)?;
    let previous = MenuItem::with_id(app, "tray_previous", "Anterior", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "tray_show", "Mostrar Resonance", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray_quit", "Salir", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[&play_pause, &next, &previous, &separator, &show, &quit],
    )?;

    let mut tray = TrayIconBuilder::with_id("resonance-tray")
        .menu(&menu)
        .tooltip("Resonance")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray_play_pause" => {
                if let Err(error) = app.emit("tray-playback-action", "play-pause") {
                    eprintln!("No se pudo enviar la acción de reproducción: {error}");
                }
            }
            "tray_next" => {
                if let Err(error) = app.emit("tray-playback-action", "next") {
                    eprintln!("No se pudo enviar la acción siguiente: {error}");
                }
            }
            "tray_previous" => {
                if let Err(error) = app.emit("tray-playback-action", "previous") {
                    eprintln!("No se pudo enviar la acción anterior: {error}");
                }
            }
            "tray_show" => {
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(error) = window.show() {
                        eprintln!("No se pudo mostrar Resonance: {error}");
                    } else if let Err(error) = window.set_focus() {
                        eprintln!("No se pudo enfocar Resonance: {error}");
                    }
                }
                set_tray_visible(app, false);
            }
            "tray_quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                set_tray_visible(app, false);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    let tray_icon = tray.build(app)?;
    // Oculto al iniciar; solo se muestra al minimizar/cerrar con la opción activada
    if let Err(error) = tray_icon.set_visible(false) {
        eprintln!("No se pudo ocultar el icono de bandeja al inicio: {error}");
    }
    Ok(())
}
