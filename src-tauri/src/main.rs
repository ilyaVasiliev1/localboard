use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

const EXT: &str = "excalidraw";
const EMPTY_BOARD: &str =
    r#"{"type":"excalidraw","version":2,"source":"localboard","elements":[],"appState":{},"files":{}}"#;

#[derive(Serialize)]
struct Board {
    name: String,
    path: String,
}

/// Persisted next to the app's other support files, not inside the project, so
/// the chosen boards folder survives rebuilds and moving the sources around.
#[derive(Default, Serialize, Deserialize)]
struct Config {
    boards_dir: Option<String>,
}

fn board(path: &Path) -> Board {
    Board {
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
        path: path.to_string_lossy().to_string(),
    }
}

fn config_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

fn read_config(app: &AppHandle) -> Config {
    config_file(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_config(app: &AppHandle, config: &Config) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(config_file(app)?, raw).map_err(|e| e.to_string())
}

fn default_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("LocalBoard")
}

/// Boards used to live in a `boards/` folder next to the sources. Copy them
/// over once, so upgrading to a user-chosen folder doesn't hide existing work.
fn migrate_legacy_boards(target: &Path) -> Result<(), String> {
    let legacy = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("boards");
    if !legacy.is_dir() || legacy == target {
        return Ok(());
    }
    for entry in fs::read_dir(legacy).map_err(|e| e.to_string())?.flatten() {
        let source = entry.path();
        if source.extension().is_some_and(|e| e == EXT) {
            let destination = target.join(entry.file_name());
            if !destination.exists() {
                fs::copy(&source, &destination).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

fn resolve_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let config = read_config(app);
    let dir = match config.boards_dir {
        Some(dir) => {
            let dir = PathBuf::from(dir);
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            dir
        }
        None => {
            let dir = default_dir(app);
            let is_new = !dir.exists();
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            if is_new {
                migrate_legacy_boards(&dir)?;
            }
            dir
        }
    };
    // Ящик существует всегда, а не создаётся первым же запросом: иначе
    // внешнему инструменту пришлось бы знать, где именно у пользователя доски,
    // и создавать каталог за приложение.
    let _ = fs::create_dir_all(inbox_dir(&dir));
    Ok(dir)
}

/// Ящик для схем: сюда внешний инструмент кладёт запрос на вставку, отсюда
/// приложение его забирает. Лежит внутри папки досок, чтобы переезд папки
/// переносил и его, и чтобы не появлялось второго места «где что-то лежит».
fn inbox_dir(directory: &Path) -> PathBuf {
    directory.join("_inbox")
}

/// `Название.excalidraw`, or `Название (2).excalidraw` when taken.
fn unique_path(directory: &Path, name: &str) -> PathBuf {
    let stem = name.trim_end_matches(&format!(".{EXT}")).trim();
    let mut candidate = directory.join(format!("{stem}.{EXT}"));
    let mut counter = 2;
    while candidate.exists() {
        candidate = directory.join(format!("{stem} ({counter}).{EXT}"));
        counter += 1;
    }
    candidate
}

#[tauri::command]
fn get_board_directory(app: AppHandle) -> Result<String, String> {
    Ok(resolve_dir(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
fn set_board_directory(app: AppHandle, directory: String) -> Result<String, String> {
    let dir = PathBuf::from(&directory);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    write_config(
        &app,
        &Config {
            boards_dir: Some(dir.to_string_lossy().to_string()),
        },
    )?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
fn list_boards(directory: String) -> Result<Vec<Board>, String> {
    let mut out: Vec<_> = fs::read_dir(directory)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == EXT))
        .map(|p| board(&p))
        .collect();
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

#[tauri::command]
fn create_board(directory: String, name: String) -> Result<Board, String> {
    let safe = Path::new(&name).file_name().ok_or("Некорректное название")?;
    let path = Path::new(&directory).join(safe);
    if path.exists() {
        return Err("Доска с таким названием уже существует".into());
    }
    fs::write(&path, EMPTY_BOARD).map_err(|e| e.to_string())?;
    Ok(board(&path))
}

/// Copies an external `.excalidraw` file into the boards folder, so every board
/// the app knows about is a file in one place.
#[tauri::command]
fn import_board(directory: String, source: String) -> Result<Board, String> {
    let source = PathBuf::from(source);
    let raw = fs::read_to_string(&source).map_err(|e| e.to_string())?;
    serde_json::from_str::<serde_json::Value>(&raw)
        .map_err(|_| "Файл не похож на доску Excalidraw".to_string())?;
    let name = source
        .file_stem()
        .ok_or("Некорректное имя файла")?
        .to_string_lossy()
        .to_string();
    let path = unique_path(Path::new(&directory), &name);
    fs::write(&path, raw).map_err(|e| e.to_string())?;
    Ok(board(&path))
}

#[tauri::command]
fn read_board(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct SchemeRequest {
    name: String,
    content: String,
}

/// Отдаёт самый ранний по имени запрос из ящика, не удаляя его: удаление —
/// дело `finish_scheme_request`, уже после того как схема легла на холст.
/// Иначе сбой конвертации терял бы запрос молча.
#[tauri::command]
fn take_scheme_request(directory: String) -> Result<Option<SchemeRequest>, String> {
    let dir = inbox_dir(Path::new(&directory));
    if !dir.is_dir() {
        return Ok(None);
    }
    let mut requests: Vec<PathBuf> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .collect();
    requests.sort();

    let Some(path) = requests.first() else {
        return Ok(None);
    };
    Ok(Some(SchemeRequest {
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
        content: fs::read_to_string(path).map_err(|e| e.to_string())?,
    }))
}

/// Закрывает запрос. Ошибка не теряется в консоли приложения, которую никто не
/// видит, а ложится рядом файлом — там её и найдёт тот, кто запрос положил.
#[tauri::command]
fn finish_scheme_request(
    directory: String,
    name: String,
    error: Option<String>,
) -> Result<(), String> {
    let dir = inbox_dir(Path::new(&directory));
    let safe = Path::new(&name).file_name().ok_or("Некорректное имя")?;
    let path = dir.join(safe);
    if let Some(message) = error {
        let report = path.with_extension("error.txt");
        fs::write(report, message).map_err(|e| e.to_string())?;
    }
    fs::remove_file(&path).map_err(|e| e.to_string())
}

/// Write-then-rename, so a crash mid-save can never truncate a board.
#[tauri::command]
fn save_board(path: String, content: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    let tmp = path.with_extension("excalidraw.tmp");
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(tmp, path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_text(path: String, content: String) -> Result<(), String> {
    fs::write(path, content).map_err(|e| e.to_string())
}

/// Binary payloads arrive base64-encoded: a byte array would cross the IPC
/// bridge as a JSON list of numbers, which is several times larger.
#[tauri::command]
fn write_base64(path: String, data: String) -> Result<(), String> {
    let bytes = BASE64.decode(data).map_err(|e| e.to_string())?;
    fs::write(path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_base64(path: String) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    Ok(BASE64.encode(bytes))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_board_directory,
            set_board_directory,
            list_boards,
            create_board,
            import_board,
            read_board,
            save_board,
            take_scheme_request,
            finish_scheme_request,
            write_text,
            write_base64,
            read_base64
        ])
        .run(tauri::generate_context!())
        .expect("error while running LocalBoard");
}
