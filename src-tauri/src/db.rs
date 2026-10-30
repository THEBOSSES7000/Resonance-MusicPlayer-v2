//! Base de datos SQLite de la biblioteca (pistas, playlists, favoritos, conteos).
//! Conexión reutilizada en proceso + actualizaciones puntuales.

use super::*;
use rusqlite::{params, Connection, OptionalExtension};
use std::sync::Mutex;

const DB_NAME: &str = "library.db";
const SCHEMA_VERSION: i32 = 1;

/// Conexión única reutilizada (evita abrir/cerrar el archivo en cada comando).
static GLOBAL_DB: Mutex<Option<(String, Connection)>> = Mutex::new(None);

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::library_cache::library_cache_directory(app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(DB_NAME))
}

fn open_db_fresh(app: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    let mut conn = Connection::open(&path).map_err(|e| format!("No se pudo abrir SQLite: {e}"))?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         PRAGMA foreign_keys=ON;
         PRAGMA temp_store=MEMORY;",
    )
    .map_err(|e| e.to_string())?;
    init_schema(&conn)?;
    migrate_from_json_if_needed(app, &mut conn)?;
    Ok(conn)
}

/// Ejecuta un cierre sobre la conexión global (la crea si hace falta).
pub fn with_db<R>(app: &AppHandle, f: impl FnOnce(&mut Connection) -> Result<R, String>) -> Result<R, String> {
    let path = db_path(app)?;
    let path_key = path.to_string_lossy().to_string();
    let mut guard = GLOBAL_DB
        .lock()
        .map_err(|_| "No se pudo bloquear la base de datos.".to_string())?;
    let needs_open = match guard.as_ref() {
        Some((existing, _)) => existing != &path_key,
        None => true,
    };
    if needs_open {
        *guard = Some((path_key, open_db_fresh(app)?));
    }
    let conn = &mut guard
        .as_mut()
        .ok_or_else(|| "Base de datos no inicializada.".to_string())?
        .1;
    f(conn)
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tracks (
            path TEXT PRIMARY KEY NOT NULL,
            name TEXT,
            directory_path TEXT,
            relative_path TEXT,
            size INTEGER DEFAULT 0,
            last_modified INTEGER DEFAULT 0,
            metadata_parser_version INTEGER DEFAULT 0,
            title TEXT,
            artist TEXT,
            album TEXT,
            track_number INTEGER,
            cover_url TEXT,
            duration REAL DEFAULT 0,
            sample_rate INTEGER,
            channels INTEGER,
            bit_depth INTEGER,
            codec TEXT,
            genre TEXT,
            replay_gain_db REAL,
            is_favorite INTEGER NOT NULL DEFAULT 0,
            unavailable INTEGER NOT NULL DEFAULT 0,
            metadata_loaded INTEGER NOT NULL DEFAULT 0,
            favorite_added_at INTEGER,
            play_count INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
        CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
        CREATE INDEX IF NOT EXISTS idx_tracks_directory ON tracks(directory_path);
        CREATE INDEX IF NOT EXISTS idx_tracks_favorite ON tracks(is_favorite);
        CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);

        CREATE TABLE IF NOT EXISTS playlists (
            id TEXT PRIMARY KEY NOT NULL,
            title TEXT,
            description TEXT,
            cover_url TEXT,
            smart_filter TEXT,
            author TEXT,
            created_at INTEGER,
            sort_order INTEGER DEFAULT 0,
            extra_json TEXT
        );

        CREATE TABLE IF NOT EXISTS playlist_tracks (
            playlist_id TEXT NOT NULL,
            track_path TEXT NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (playlist_id, track_path),
            FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_playlist_tracks_pos
            ON playlist_tracks(playlist_id, position);
        "#,
    )
    .map_err(|e| format!("No se pudo crear el esquema SQLite: {e}"))?;

    let version: i32 = conn
        .query_row(
            "SELECT value FROM meta WHERE key = 'schema_version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    if version < SCHEMA_VERSION {
        conn.execute(
            "INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', ?1)",
            params![SCHEMA_VERSION.to_string()],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn migrate_from_json_if_needed(app: &AppHandle, conn: &mut Connection) -> Result<(), String> {
    let migrated: bool = conn
        .query_row(
            "SELECT value FROM meta WHERE key = 'migrated_from_json'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .map(|v| v == "1")
        .unwrap_or(false);
    if migrated {
        return Ok(());
    }

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM tracks", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if count > 0 {
        conn.execute(
            "INSERT OR REPLACE INTO meta(key, value) VALUES ('migrated_from_json', '1')",
            [],
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let json_path = crate::library_cache::library_cache_directory(app)?.join("library.json");
    if json_path.is_file() {
        let contents = fs::read_to_string(&json_path).map_err(|e| e.to_string())?;
        if let Ok(tracks) = serde_json::from_str::<Vec<serde_json::Value>>(&contents) {
            replace_all_tracks(conn, &tracks)?;
            eprintln!(
                "[Resonance] Migradas {} pistas de library.json → SQLite",
                tracks.len()
            );
        }
    }

    conn.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES ('migrated_from_json', '1')",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn json_bool(obj: &serde_json::Map<String, serde_json::Value>, k: &str) -> bool {
    obj.get(k)
        .map(|v| match v {
            serde_json::Value::Bool(b) => *b,
            serde_json::Value::Number(n) => n.as_i64().unwrap_or(0) != 0,
            serde_json::Value::String(s) => s == "true" || s == "1",
            _ => false,
        })
        .unwrap_or(false)
}

fn upsert_track_row(conn: &Connection, track: &serde_json::Value) -> Result<(), String> {
    let obj = match track.as_object() {
        Some(o) => o,
        None => return Ok(()),
    };
    let path = obj.get("path").and_then(|v| v.as_str()).unwrap_or("");
    if path.is_empty() {
        return Ok(());
    }
    let s = |k: &str| obj.get(k).and_then(|v| v.as_str()).map(|s| s.to_string());
    let i = |k: &str| {
        obj.get(k)
            .and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)))
    };
    let f = |k: &str| obj.get(k).and_then(|v| v.as_f64());

    conn.execute(
        r#"INSERT INTO tracks (
            path, name, directory_path, relative_path, size, last_modified,
            metadata_parser_version, title, artist, album, track_number, cover_url,
            duration, sample_rate, channels, bit_depth, codec, genre, replay_gain_db,
            is_favorite, unavailable, metadata_loaded, favorite_added_at, play_count
        ) VALUES (
            ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24
        )
        ON CONFLICT(path) DO UPDATE SET
            name=excluded.name,
            directory_path=excluded.directory_path,
            relative_path=excluded.relative_path,
            size=excluded.size,
            last_modified=excluded.last_modified,
            metadata_parser_version=excluded.metadata_parser_version,
            title=excluded.title,
            artist=excluded.artist,
            album=excluded.album,
            track_number=excluded.track_number,
            cover_url=excluded.cover_url,
            duration=excluded.duration,
            sample_rate=excluded.sample_rate,
            channels=excluded.channels,
            bit_depth=excluded.bit_depth,
            codec=excluded.codec,
            genre=excluded.genre,
            replay_gain_db=excluded.replay_gain_db,
            is_favorite=excluded.is_favorite,
            unavailable=excluded.unavailable,
            metadata_loaded=excluded.metadata_loaded,
            favorite_added_at=excluded.favorite_added_at,
            play_count=excluded.play_count
        "#,
        params![
            path,
            s("name"),
            s("directoryPath"),
            s("relativePath"),
            i("size").unwrap_or(0),
            i("lastModified").unwrap_or(0),
            i("metadataParserVersion").unwrap_or(0),
            s("title"),
            s("artist"),
            s("album"),
            i("trackNumber"),
            s("coverUrl"),
            f("duration").unwrap_or(0.0),
            i("sampleRate"),
            i("channels"),
            i("bitDepth"),
            s("codec"),
            s("genre"),
            f("replayGainDb"),
            if json_bool(obj, "isFavorite") { 1 } else { 0 },
            if json_bool(obj, "unavailable") { 1 } else { 0 },
            if json_bool(obj, "metadataLoaded") { 1 } else { 0 },
            i("favoriteAddedAt"),
            i("playCount").unwrap_or(0),
        ],
    )
    .map_err(|e| format!("Error upsert pista: {e}"))?;
    Ok(())
}

/// Reemplazo completo optimizado: UPSERT de todas + borrar huérfanas (transacción).
pub fn replace_all_tracks(conn: &mut Connection, tracks: &[serde_json::Value]) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS _keep_paths (path TEXT PRIMARY KEY);
         DELETE FROM _keep_paths;",
    )
    .map_err(|e| e.to_string())?;

    {
        let mut keep = tx
            .prepare("INSERT OR IGNORE INTO _keep_paths(path) VALUES (?1)")
            .map_err(|e| e.to_string())?;
        for track in tracks {
            if let Some(path) = track.get("path").and_then(|v| v.as_str()) {
                if !path.is_empty() {
                    keep.execute(params![path]).map_err(|e| e.to_string())?;
                }
            }
            upsert_track_row(&*tx, track)?;
        }
    }

    tx.execute(
        "DELETE FROM tracks WHERE path NOT IN (SELECT path FROM _keep_paths)",
        [],
    )
    .map_err(|e| e.to_string())?;
    tx.execute_batch("DELETE FROM _keep_paths;")
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_all_tracks(conn: &Connection) -> Result<Vec<serde_json::Value>, String> {
    let mut stmt = conn
        .prepare(
            r#"SELECT path, name, directory_path, relative_path, size, last_modified,
               metadata_parser_version, title, artist, album, track_number, cover_url,
               duration, sample_rate, channels, bit_depth, codec, genre, replay_gain_db,
               is_favorite, unavailable, metadata_loaded, favorite_added_at, play_count
               FROM tracks ORDER BY last_modified DESC"#,
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "path": row.get::<_, String>(0)?,
                "name": row.get::<_, Option<String>>(1)?,
                "directoryPath": row.get::<_, Option<String>>(2)?,
                "relativePath": row.get::<_, Option<String>>(3)?,
                "size": row.get::<_, i64>(4)?,
                "lastModified": row.get::<_, i64>(5)?,
                "metadataParserVersion": row.get::<_, i64>(6)?,
                "title": row.get::<_, Option<String>>(7)?,
                "artist": row.get::<_, Option<String>>(8)?,
                "album": row.get::<_, Option<String>>(9)?,
                "trackNumber": row.get::<_, Option<i64>>(10)?,
                "coverUrl": row.get::<_, Option<String>>(11)?,
                "duration": row.get::<_, f64>(12)?,
                "sampleRate": row.get::<_, Option<i64>>(13)?,
                "channels": row.get::<_, Option<i64>>(14)?,
                "bitDepth": row.get::<_, Option<i64>>(15)?,
                "codec": row.get::<_, Option<String>>(16)?,
                "genre": row.get::<_, Option<String>>(17)?,
                "replayGainDb": row.get::<_, Option<f64>>(18)?,
                "isFavorite": row.get::<_, i64>(19)? != 0,
                "unavailable": row.get::<_, i64>(20)? != 0,
                "metadataLoaded": row.get::<_, i64>(21)? != 0,
                "favoriteAddedAt": row.get::<_, Option<i64>>(22)?,
                "playCount": row.get::<_, i64>(23)?,
            }))
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn save_playlists_payload(conn: &mut Connection, playlists: &[serde_json::Value]) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM playlist_tracks", []).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM playlists", []).map_err(|e| e.to_string())?;

    {
        let mut ins_pl = tx
            .prepare(
                r#"INSERT INTO playlists (id, title, description, cover_url, smart_filter, author, created_at, sort_order, extra_json)
                   VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)"#,
            )
            .map_err(|e| e.to_string())?;
        let mut ins_tr = tx
            .prepare(
                r#"INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_path, position)
                   VALUES (?1,?2,?3)"#,
            )
            .map_err(|e| e.to_string())?;

        for (order, pl) in playlists.iter().enumerate() {
            let obj = match pl.as_object() {
                Some(o) => o,
                None => continue,
            };
            let id = obj.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if id.is_empty() {
                continue;
            }
            let smart = obj.get("smartFilter").map(|v| v.to_string());
            let mut extra = obj.clone();
            for k in [
                "id", "title", "description", "coverUrl", "smartFilter", "author", "songs", "createdAt",
            ] {
                extra.remove(k);
            }
            let extra_json = if extra.is_empty() {
                None
            } else {
                Some(serde_json::Value::Object(extra).to_string())
            };

            ins_pl
                .execute(params![
                    id,
                    obj.get("title").and_then(|v| v.as_str()),
                    obj.get("description").and_then(|v| v.as_str()),
                    obj.get("coverUrl").and_then(|v| v.as_str()),
                    smart,
                    obj.get("author").and_then(|v| v.as_str()),
                    obj.get("createdAt").and_then(|v| v.as_i64()),
                    order as i64,
                    extra_json,
                ])
                .map_err(|e| e.to_string())?;

            if let Some(songs) = obj.get("songs").and_then(|v| v.as_array()) {
                for (pos, song) in songs.iter().enumerate() {
                    let path = song
                        .get("path")
                        .or_else(|| song.get("file").and_then(|f| f.get("path")))
                        .and_then(|v| v.as_str())
                        .or_else(|| song.as_str())
                        .unwrap_or("");
                    if path.is_empty() {
                        let title = song.get("title").and_then(|v| v.as_str()).unwrap_or("");
                        let artist = song.get("artist").and_then(|v| v.as_str()).unwrap_or("");
                        if title.is_empty() {
                            continue;
                        }
                        let pseudo = format!("ref:{title}:::{artist}");
                        ins_tr
                            .execute(params![id, pseudo, pos as i64])
                            .map_err(|e| e.to_string())?;
                        continue;
                    }
                    ins_tr
                        .execute(params![id, path, pos as i64])
                        .map_err(|e| e.to_string())?;
                }
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_playlists_payload(conn: &Connection) -> Result<Vec<serde_json::Value>, String> {
    let mut stmt = conn
        .prepare(
            r#"SELECT id, title, description, cover_url, smart_filter, author, created_at, sort_order, extra_json
               FROM playlists ORDER BY sort_order ASC, title ASC"#,
        )
        .map_err(|e| e.to_string())?;

    let playlists: Vec<(String, serde_json::Value)> = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let smart: Option<String> = row.get(4)?;
            let extra: Option<String> = row.get(8)?;
            let mut obj = serde_json::Map::new();
            obj.insert("id".into(), serde_json::json!(id.clone()));
            obj.insert("title".into(), serde_json::json!(row.get::<_, Option<String>>(1)?));
            obj.insert("description".into(), serde_json::json!(row.get::<_, Option<String>>(2)?));
            obj.insert("coverUrl".into(), serde_json::json!(row.get::<_, Option<String>>(3)?));
            if let Some(s) = smart {
                if let Ok(v) = serde_json::from_str(&s) {
                    obj.insert("smartFilter".into(), v);
                }
            }
            obj.insert("author".into(), serde_json::json!(row.get::<_, Option<String>>(5)?));
            obj.insert("createdAt".into(), serde_json::json!(row.get::<_, Option<i64>>(6)?));
            if let Some(e) = extra {
                if let Ok(serde_json::Value::Object(map)) = serde_json::from_str(&e) {
                    for (k, v) in map {
                        obj.entry(k).or_insert(v);
                    }
                }
            }
            obj.insert("songs".into(), serde_json::json!([]));
            Ok((id, serde_json::Value::Object(obj)))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for (id, mut pl) in playlists {
        let mut track_stmt = conn
            .prepare(
                "SELECT track_path FROM playlist_tracks WHERE playlist_id = ?1 ORDER BY position ASC",
            )
            .map_err(|e| e.to_string())?;
        let paths: Vec<String> = track_stmt
            .query_map(params![id], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let songs: Vec<serde_json::Value> = paths
            .into_iter()
            .map(|path| {
                if let Some(rest) = path.strip_prefix("ref:") {
                    let mut parts = rest.splitn(2, ":::");
                    let title = parts.next().unwrap_or("");
                    let artist = parts.next().unwrap_or("");
                    serde_json::json!({ "title": title, "artist": artist })
                } else {
                    serde_json::json!({ "path": path })
                }
            })
            .collect();
        if let Some(obj) = pl.as_object_mut() {
            obj.insert("songs".into(), serde_json::Value::Array(songs));
        }
        out.push(pl);
    }
    Ok(out)
}

// ——— Comandos Tauri ———

#[tauri::command]
pub fn db_get_playlists(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
    with_db(&app, |conn| load_playlists_payload(conn))
}

#[tauri::command]
pub fn db_save_playlists(app: AppHandle, playlists: Vec<serde_json::Value>) -> Result<(), String> {
    with_db(&app, |conn| save_playlists_payload(conn, &playlists))
}

#[tauri::command]
pub fn db_get_play_counts(app: AppHandle) -> Result<serde_json::Value, String> {
    with_db(&app, |conn| {
        let mut stmt = conn
            .prepare("SELECT path, play_count FROM tracks WHERE play_count > 0")
            .map_err(|e| e.to_string())?;
        let mut map = serde_json::Map::new();
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (path, count) = row.map_err(|e| e.to_string())?;
            map.insert(path, serde_json::json!(count));
        }
        Ok(serde_json::Value::Object(map))
    })
}

#[tauri::command]
pub fn db_set_play_count(app: AppHandle, path: String, count: i64) -> Result<(), String> {
    with_db(&app, |conn| {
        conn.execute(
            "UPDATE tracks SET play_count = ?1 WHERE path = ?2",
            params![count, path],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

/// Actualización puntual (favorito / unavailable / path nuevo al reubicar).
#[tauri::command]
pub fn db_update_track_fields(
    app: AppHandle,
    path: String,
    is_favorite: Option<bool>,
    unavailable: Option<bool>,
    favorite_added_at: Option<i64>,
    new_path: Option<String>,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration: Option<f64>,
    cover_url: Option<String>,
    play_count: Option<i64>,
) -> Result<(), String> {
    with_db(&app, |conn| {
        if let Some(ref np) = new_path {
            if np != &path {
                // Reubicar clave primaria
                conn.execute(
                    "UPDATE tracks SET path = ?1 WHERE path = ?2",
                    params![np, path],
                )
                .map_err(|e| e.to_string())?;
                conn.execute(
                    "UPDATE playlist_tracks SET track_path = ?1 WHERE track_path = ?2",
                    params![np, path],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        let key = new_path.as_deref().unwrap_or(path.as_str());
        if let Some(v) = is_favorite {
            conn.execute(
                "UPDATE tracks SET is_favorite = ?1 WHERE path = ?2",
                params![if v { 1 } else { 0 }, key],
            )
            .map_err(|e| e.to_string())?;
        }
        if let Some(v) = unavailable {
            conn.execute(
                "UPDATE tracks SET unavailable = ?1 WHERE path = ?2",
                params![if v { 1 } else { 0 }, key],
            )
            .map_err(|e| e.to_string())?;
        }
        if let Some(v) = favorite_added_at {
            conn.execute(
                "UPDATE tracks SET favorite_added_at = ?1 WHERE path = ?2",
                params![v, key],
            )
            .map_err(|e| e.to_string())?;
        }
        if let Some(v) = title {
            conn.execute("UPDATE tracks SET title = ?1 WHERE path = ?2", params![v, key])
                .map_err(|e| e.to_string())?;
        }
        if let Some(v) = artist {
            conn.execute("UPDATE tracks SET artist = ?1 WHERE path = ?2", params![v, key])
                .map_err(|e| e.to_string())?;
        }
        if let Some(v) = album {
            conn.execute("UPDATE tracks SET album = ?1 WHERE path = ?2", params![v, key])
                .map_err(|e| e.to_string())?;
        }
        if let Some(v) = duration {
            conn.execute("UPDATE tracks SET duration = ?1 WHERE path = ?2", params![v, key])
                .map_err(|e| e.to_string())?;
        }
        if let Some(v) = cover_url {
            conn.execute("UPDATE tracks SET cover_url = ?1 WHERE path = ?2", params![v, key])
                .map_err(|e| e.to_string())?;
        }
        if let Some(v) = play_count {
            conn.execute("UPDATE tracks SET play_count = ?1 WHERE path = ?2", params![v, key])
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    })
}

/// Upsert de una sola pista (reubicar / metadatos nuevos).
#[tauri::command]
pub fn db_upsert_track(app: AppHandle, track: serde_json::Value) -> Result<(), String> {
    with_db(&app, |conn| upsert_track_row(conn, &track))
}
