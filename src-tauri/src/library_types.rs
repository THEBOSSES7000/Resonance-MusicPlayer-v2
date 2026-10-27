//! Tipos de la biblioteca: directorios, subcarpetas, archivos y vigilante.

use super::*;

#[derive(Default)]
pub struct MusicWatcher(pub Mutex<Option<RecommendedWatcher>>);

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicDirectory {
    pub path: String,
    pub name: String,
    /// Subcarpetas inmediatas (rutas absolutas) excluidas del escaneo
    #[serde(default)]
    pub excluded_subfolders: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicSubfolder {
    pub name: String,
    pub path: String,
    pub excluded: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicFile {
    pub name: String,
    pub path: String,
    pub directory_path: String,
    pub relative_path: String,
    pub size: u64,
    pub last_modified: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicLibrary {
    pub directories: Vec<MusicDirectory>,
    pub files: Vec<MusicFile>,
}
