//! Ajustes de la app y posición/tamaño de la ventana.

use super::*;

pub fn read_window_bounds(app: &AppHandle) -> Result<Option<WindowBounds>, String> {
    let path = settings_store_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let settings: HashMap<String, serde_json::Value> =
        serde_json::from_str(&contents).map_err(|error| error.to_string())?;
    let Some(value) = settings.get(WINDOW_BOUNDS_SETTING) else {
        return Ok(None);
    };
    let serialized = value
        .as_str()
        .ok_or_else(|| "La geometría guardada de la ventana no es válida.".to_string())?;
    let bounds: WindowBounds = serde_json::from_str(serialized)
        .map_err(|error| format!("No se pudo leer la geometría de la ventana: {error}"))?;
    if !(MIN_WINDOW_WIDTH..=MAX_WINDOW_DIMENSION).contains(&bounds.width)
        || !(MIN_WINDOW_HEIGHT..=MAX_WINDOW_DIMENSION).contains(&bounds.height)
    {
        return Ok(None);
    }
    Ok(Some(bounds))
}

pub fn write_window_bounds(app: &AppHandle, mut bounds: WindowBounds) -> Result<(), String> {
    if !(MIN_WINDOW_WIDTH..=MAX_WINDOW_DIMENSION).contains(&bounds.width)
        || !(MIN_WINDOW_HEIGHT..=MAX_WINDOW_DIMENSION).contains(&bounds.height)
    {
        return Err(
            "El tamaño guardado de la ventana está fuera de los límites permitidos.".into(),
        );
    }
    let path = settings_store_path(app)?;
    let mut settings: HashMap<String, serde_json::Value> = if path.exists() {
        let contents = fs::read_to_string(&path).map_err(|error| error.to_string())?;
        serde_json::from_str(&contents).map_err(|error| error.to_string())?
    } else {
        HashMap::new()
    };
    if bounds.maximized {
        if let Some(previous_bounds) = settings
            .get(WINDOW_BOUNDS_SETTING)
            .and_then(serde_json::Value::as_str)
            .and_then(|value| serde_json::from_str::<WindowBounds>(value).ok())
        {
            bounds.x = previous_bounds.x;
            bounds.y = previous_bounds.y;
            bounds.width = previous_bounds.width;
            bounds.height = previous_bounds.height;
        }
    }
    let serialized = serde_json::to_string(&bounds).map_err(|error| error.to_string())?;
    settings.insert(
        WINDOW_BOUNDS_SETTING.to_string(),
        serde_json::Value::String(serialized),
    );
    let contents = serde_json::to_vec_pretty(&settings).map_err(|error| error.to_string())?;
    fs::write(path, contents).map_err(|error| error.to_string())
}

pub fn persist_window_bounds_from_window(window: &tauri::Window) -> Result<(), String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let maximized = window.is_maximized().map_err(|error| error.to_string())?;
    write_window_bounds(
        window.app_handle(),
        WindowBounds {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
            maximized,
        },
    )
}

pub fn restore_window_bounds(window: &tauri::WebviewWindow) -> Result<(), String> {
    let Some(bounds) = read_window_bounds(window.app_handle())? else {
        return Ok(());
    };
    let monitors = window
        .available_monitors()
        .map_err(|error| error.to_string())?;
    let intersects_monitor = monitors.iter().any(|monitor| {
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let right = i64::from(bounds.x) + i64::from(bounds.width);
        let bottom = i64::from(bounds.y) + i64::from(bounds.height);
        let monitor_right = i64::from(monitor_position.x) + i64::from(monitor_size.width);
        let monitor_bottom = i64::from(monitor_position.y) + i64::from(monitor_size.height);
        right > i64::from(monitor_position.x)
            && i64::from(bounds.x) < monitor_right
            && bottom > i64::from(monitor_position.y)
            && i64::from(bounds.y) < monitor_bottom
    });
    let (x, y) = if intersects_monitor {
        (bounds.x, bounds.y)
    } else {
        let monitor = window
            .primary_monitor()
            .map_err(|error| error.to_string())?
            .or_else(|| monitors.first().cloned());
        if let Some(monitor) = monitor {
            let position = monitor.position();
            let size = monitor.size();
            (
                position.x + (size.width.saturating_sub(bounds.width) / 2) as i32,
                position.y + (size.height.saturating_sub(bounds.height) / 2) as i32,
            )
        } else {
            (bounds.x, bounds.y)
        }
    };
    window
        .set_size(tauri::Size::Physical(PhysicalSize::new(
            bounds.width,
            bounds.height,
        )))
        .map_err(|error| error.to_string())?;
    window
        .set_position(tauri::Position::Physical(PhysicalPosition::new(x, y)))
        .map_err(|error| error.to_string())?;
    if bounds.maximized {
        window.maximize().map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn is_valid_app_setting(key: &str, value: &serde_json::Value) -> bool {
    match key {
        "discord_rpc_enabled" | "pn_discord_rpc_enabled" => {
            value.is_boolean() || value.as_str().is_some()
        }
        "visual_plus" => {
            // Objeto Visual+: aceptar formas actuales y legacy (no tumbar todo el settings.json)
            if let Some(settings) = value.as_object() {
                return settings
                    .get("enabled")
                    .map_or(true, |v| v.is_boolean() || v.as_str().is_some());
            }
            false
        }
        "pn_visual_plus" => value.is_string() || value.is_object(),
        _ => key.starts_with("pn_") && value.is_string(),
    }
}

#[tauri::command]
pub fn load_app_settings(app: AppHandle) -> Result<Option<HashMap<String, serde_json::Value>>, String> {
    let path = settings_store_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let settings: HashMap<String, serde_json::Value> =
        serde_json::from_str(&contents).map_err(|error| error.to_string())?;
    // Filtrar claves/valores inválidos en lugar de rechazar todo el archivo
    // (evita dejar la app sin settings y sin arrancar la UI).
    let filtered: HashMap<String, serde_json::Value> = settings
        .into_iter()
        .filter(|(key, value)| is_valid_app_setting(key, value))
        .collect();
    if filtered.is_empty() {
        return Ok(None);
    }
    Ok(Some(filtered))
}

#[tauri::command]
pub fn save_app_settings(
    app: AppHandle,
    mut settings: HashMap<String, serde_json::Value>,
) -> Result<(), String> {
    if settings.len() > 10_000
        || settings.iter().any(|(key, value)| {
            key.len() > 256
                || !is_valid_app_setting(key, value)
                || (key.starts_with("pn_")
                    && value.as_str().map_or(true, |value| value.len() > 1_000_000))
        })
    {
        return Err(
            "La configuración contiene valores fuera de los límites permitidos.".to_string(),
        );
    }
    if !settings.contains_key(WINDOW_BOUNDS_SETTING) {
        if let Some(saved_bounds) = load_app_settings(app.clone())?
            .and_then(|saved_settings| saved_settings.get(WINDOW_BOUNDS_SETTING).cloned())
        {
            settings.insert(WINDOW_BOUNDS_SETTING.to_string(), saved_bounds);
        }
    }
    let contents = serde_json::to_vec_pretty(&settings).map_err(|error| error.to_string())?;
    fs::write(settings_store_path(&app)?, contents).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_window_bounds(app: AppHandle, bounds: WindowBounds) -> Result<(), String> {
    write_window_bounds(&app, bounds)
}
