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
    write_agent_guide(app, &dir);
    Ok(dir)
}

/// Ящик для схем: сюда внешний инструмент кладёт запрос на вставку, отсюда
/// приложение его забирает. Лежит внутри папки досок, чтобы переезд папки
/// переносил и его, и чтобы не появлялось второго места «где что-то лежит».
fn inbox_dir(directory: &Path) -> PathBuf {
    directory.join("_inbox")
}

/// Версия протокола в инструкции. Растёт, когда меняется формат запроса —
/// по ней файл переписывается у тех, кто обновил приложение.
const AGENT_PROTOCOL_VERSION: u32 = 1;

fn board_cli_path(app: &AppHandle) -> String {
    app.path()
        .resolve("board.mjs", tauri::path::BaseDirectory::Resource)
        .map(|path| path.to_string_lossy().to_string())
        // В дев-режиме ресурса рядом нет — тогда путь из репозитория.
        .unwrap_or_else(|_| "scripts/board.mjs".to_string())
}

/// Кладёт в папку досок инструкцию для ИИ-ассистента.
///
/// Смысл файла — в его местоположении. Агент, которого открыли в этой папке,
/// читает лежащий рядом `CLAUDE.md` первым делом, и этого достаточно, чтобы он
/// понял протокол: ни настроек, ни объяснений от человека не требуется.
/// Поэтому инструкция живёт с досками, а не в репозитории приложения.
fn write_agent_guide(app: &AppHandle, directory: &Path) {
    let guide = directory.join("CLAUDE.md");
    let marker = format!("<!-- localboard-protocol: {AGENT_PROTOCOL_VERSION} -->");

    // Переписываем только свою же устаревшую версию: если человек правил файл
    // под себя, затирать его правки приложение не вправе.
    if let Ok(existing) = fs::read_to_string(&guide) {
        let is_ours = existing.contains("localboard-protocol");
        let is_current = existing.starts_with(&marker);
        if is_current || !is_ours {
            return;
        }
    }

    let cli = board_cli_path(app);
    let contents = format!(
        r#"{marker}
# Доски LocalBoard — инструкция для ИИ-ассистента

В этой папке лежат доски приложения **LocalBoard** (macOS): каждая доска — файл
`*.excalidraw`, обычный JSON формата Excalidraw. Ты можешь читать эти доски и
класть на них схемы. Ниже — весь протокол.

## Прочитать доску

```bash
node "{cli}" list                 # какие доски есть и сколько в них элементов
node "{cli}" read "<имя доски>"   # пересказ: схемы, узлы, связи, координаты
```

Читай именно через `read`, а не открывай `.excalidraw` целиком: в сыром JSON
девять десятых объёма — служебные поля, и по нему не видно, что схема говорит.

## Нарисовать схему на открытой доске

Схему кладёт само приложение — ты только оставляешь ему запрос:

```bash
node "{cli}" send запрос.json
```

Файл запроса:

```json
{{
  "title": "Пайплайн диктовки",
  "mermaid": "flowchart TD\n  a([Старт]) --> b[Шаг]\n  b --> c{{Развилка?}}",
  "place": "right",
  "anchor": "Готовность",
  "gap": 200,
  "roles": {{ "Старт": "terminal", "Отказ": "error" }}
}}
```

- `mermaid` — описание схемы. Раскладку считает mermaid, поэтому координаты
  задавать не нужно. Поддержан flowchart и остальные типы диаграмм mermaid.
- `place` — `"right"` (по умолчанию), `"below"` или `{{"x": 0, "y": 0}}`.
- `anchor` — текст узла существующей схемы: «положи рядом вот с этой».
  Без него схема встаёт правее всего, что уже нарисовано.
- `roles` — переназначение роли узла по его тексту: `step`, `decision`,
  `terminal`, `accent`, `error`. По умолчанию роль выводится из формы.

## Правила

1. **Приложение должно быть запущено, и доска открыта.** Иначе запрос будет
   отклонён: рядом с ним появится файл `.error.txt` с причиной — прочитай его,
   если схема не появилась.
2. **Схемы приходят чёрно-белыми, и это намеренно.** Цвет на доске означает
   смысл, и расставляет его владелец доски. Не добавляй цвета и заливки, пока
   тебя об этом не попросили прямо.
3. **Не редактируй `.excalidraw` руками.** Стрелки держатся привязками к
   фигурам; правка JSON снаружи их рвёт, и схема разваливается при первом же
   перетаскивании блока. Всё, что нужно, делается через `send`.
4. Файлы в `_inbox` приложение забирает само в течение полутора секунд и
   удаляет. Ничего дополнительно чистить не нужно.

## Что удобно поручать

- «Прочитай доску N и скажи, что в схеме не покрыто» — `read` даёт узлы и
  связи, по ним видно недостающие ветки и тупики.
- «Нарисуй схему такого-то куска кода правее схемы X» — `send` с `anchor`.
- «Разбери, что тут вообще нарисовано» — `list`, затем `read`.
"#
    );

    let _ = fs::write(&guide, contents);
    let _ = fs::write(
        directory.join("AGENTS.md"),
        "Инструкция для ИИ-ассистента по работе с этими досками — в `CLAUDE.md` рядом.\n",
    );
}

/// Показать путь в Finder — из окна «Работа с Claude», чтобы человеку не
/// приходилось искать папку досок руками.
#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Путь к инструкции и к CLI — окно онбординга показывает их как есть,
/// чтобы команду можно было скопировать, а не переписывать с картинки.
#[tauri::command]
fn agent_setup(app: AppHandle, directory: String) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "boardsDir": directory,
        "guide": Path::new(&directory).join("CLAUDE.md").to_string_lossy(),
        "cli": board_cli_path(&app),
    }))
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
    // Новая папка досок получает ту же оснастку, что и стартовая: ящик и
    // инструкцию для ассистента. Иначе связка молча переставала работать
    // ровно в тот момент, когда человек переносит доски в другое место.
    let _ = fs::create_dir_all(inbox_dir(&dir));
    write_agent_guide(&app, &dir);
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

#[tauri::command]
fn read_board(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Переименование = переименование файла: имя доски нигде больше не хранится,
/// поэтому расходиться им не с чем.
#[tauri::command]
fn rename_board(path: String, name: String) -> Result<Board, String> {
    let source = PathBuf::from(&path);
    let directory = source.parent().ok_or("Некорректный путь")?;
    let safe = Path::new(&name).file_name().ok_or("Некорректное название")?;

    let mut target = directory.join(safe);
    if target.extension().is_none_or(|ext| ext != EXT) {
        target.set_extension(EXT);
    }
    if target == source {
        return Ok(board(&source));
    }
    if target.exists() {
        return Err("Доска с таким названием уже существует".into());
    }
    fs::rename(&source, &target).map_err(|e| e.to_string())?;
    Ok(board(&target))
}

/// Удаление доски — в корзину, а не в небытие.
///
/// Доска это часы работы, и подтверждение в диалоге защищает только от
/// случайного клика, но не от передумал-через-минуту. Корзина стоит одного
/// `rename` и возвращает файл в два клика.
#[tauri::command]
fn delete_board(app: AppHandle, path: String) -> Result<(), String> {
    let source = PathBuf::from(&path);
    let name = source
        .file_name()
        .ok_or("Некорректный путь")?
        .to_string_lossy()
        .to_string();

    let trash = app
        .path()
        .home_dir()
        .map_err(|e| e.to_string())?
        .join(".Trash");
    if !trash.is_dir() {
        return fs::remove_file(&source).map_err(|e| e.to_string());
    }

    let stem = source.file_stem().unwrap_or_default().to_string_lossy();
    let mut target = trash.join(&name);
    let mut counter = 2;
    while target.exists() {
        target = trash.join(format!("{stem} ({counter}).{EXT}"));
        counter += 1;
    }

    // Переименование работает, только пока корзина на том же томе. Доски могут
    // лежать на внешнем диске — тогда честная копия с последующим удалением.
    if fs::rename(&source, &target).is_ok() {
        return Ok(());
    }
    fs::copy(&source, &target).map_err(|e| e.to_string())?;
    fs::remove_file(&source).map_err(|e| e.to_string())
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
        // Регистрируется первым — так требует плагин. Второй запуск (из Dock,
        // из Finder или прямым вызовом бинарника в обход LaunchServices) не
        // создаёт вторую копию, а выводит вперёд уже открытое окно.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_board_directory,
            set_board_directory,
            list_boards,
            create_board,
            read_board,
            save_board,
            delete_board,
            rename_board,
            take_scheme_request,
            finish_scheme_request,
            reveal_path,
            agent_setup,
            write_text,
            write_base64,
            read_base64
        ])
        .run(tauri::generate_context!())
        .expect("error while running LocalBoard");
}
