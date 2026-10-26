// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Forzar a WebView2 a procesar el audio dentro del proceso principal para unificar el mezclador de Windows
    #[cfg(target_os = "windows")]
    {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--disable-features=AudioServiceOutOfProcess",
        );
    }

    // Obligatorio ANTES de crear ventanas / WebView2 (docs Microsoft AppUserModelID)
    purple_note_lib::set_app_user_model_id();
    purple_note_lib::run()
}