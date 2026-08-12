# Точки входа

Обмен местный: интерфейс обращается к оболочке по каналу команд Tauri. Сетевой
службы у продукта нет, поэтому адрес каждой точки — «канал.операция», а не путь
HTTP.

---

## API-folders.list — Список подключённых папок
Исчезнувшая папка выпадает из списка молча; сокращённый список сохраняется.
Каждая оставшаяся папка готовится к работе.
- in: полей нет
- out: folders — массив: path (строка), name (строка)
- links: DM-config, EC-005, L-005
- impl: app:src-tauri/src/main.rs

## API-folders.add — Подключение папки
Повторное подключение той же папки список не удлиняет.
- in: path (строка) — путь к каталогу
- out: folders — массив: path (строка), name (строка); отказ — «Такой папки нет»
- links: DM-config, EC-006
- impl: app:src-tauri/src/main.rs

## API-folders.remove — Отключение папки
Система ОБЯЗАНА НЕ трогать ни один файл: папка отключается, а не удаляется.
- in: path (строка)
- out: folders — массив: path (строка), name (строка)
- links: DM-config, EC-005
- impl: app:src-tauri/src/main.rs

## API-boards.list — Доски папки
В список попадают файлы с расширением `.excalidraw`. Порядок — по названию без
учёта регистра.
- in: directory (строка)
- out: boards — массив: name (строка), path (строка)
- links: DM-board, EC-005
- impl: app:src-tauri/src/main.rs

## API-boards.create — Создание доски
- in: directory (строка), name (строка)
- out: board — name (строка), path (строка); отказы — имя занято, имя не даёт имени файла
- links: DM-board, EC-001, EC-002
- impl: app:src-tauri/src/main.rs

## API-boards.read — Чтение доски
- in: path (строка)
- out: content (строка) — JSON доски; отказ — причина чтения файла
- links: DM-board, EC-005
- impl: app:src-tauri/src/main.rs

## API-boards.save — Сохранение доски
Запись идёт через временный файл рядом с доской и переименование поверх
целевого, поэтому сбой посреди сохранения ОБЯЗАН НЕ оставлять обрезанный файл.
- in: path (строка), content (строка)
- out: полей нет; отказ — причина записи файла
- links: DM-board, EC-005, INV-001
- impl: app:src-tauri/src/main.rs

## API-boards.rename — Переименование доски
Расширение `.excalidraw` дописывается, если его нет.
- in: path (строка), name (строка)
- out: board — name (строка), path (строка); отказы — имя занято, имя не даёт имени файла
- links: DM-board, EC-001, EC-002
- impl: app:src-tauri/src/main.rs

## API-boards.move — Перенос доски в другую папку
Содержимое доски при переносе не меняется.
- in: path (строка), directory (строка)
- out: board — name (строка), path (строка); отказы — папки назначения нет, имя занято
- links: DM-board, EC-003, EC-004
- impl: app:src-tauri/src/main.rs

## API-boards.delete — Удаление доски
Доска уезжает в корзину пользователя. Занятое имя в корзине получает числовой
суффикс.
- in: path (строка)
- out: полей нет; отказ — причина переноса файла
- links: DM-board, EC-007, L-004
- impl: app:src-tauri/src/main.rs

## API-inbox.take — Выдача запроса схемы
Отдаётся самый ранний по имени запрос. Файл при этом не удаляется.
- in: directory (строка)
- out: request — name (строка), content (строка); пусто, когда запросов нет
- links: DM-request, EC-008
- impl: app:src-tauri/src/main.rs

## API-inbox.finish — Закрытие запроса схемы
Когда причина передана, рядом с запросом появляется файл `.error.txt` с нею.
Файл запроса удаляется в обоих исходах.
- in: directory (строка), name (строка), error (строка, необязательное)
- out: полей нет
- links: DM-request, EC-009
- impl: app:src-tauri/src/main.rs

## API-agent.setup — Сведения для настройки ассистента
- in: directory (строка)
- out: boardsDir (строка), guide (строка), cli (строка)
- links: TERM-guide, EC-005
- impl: app:src-tauri/src/main.rs

## API-shell.reveal — Показ пути в Finder
- in: path (строка)
- out: полей нет; отказ — причина запуска
- links: EC-005
- impl: app:src-tauri/src/main.rs

## API-file.export — Запись файла выгрузки
Двоичные выгрузки идут в base64: массив байтов пересекал бы мост обмена как
список чисел и вырос бы в несколько раз.
- in: path (строка), content (строка, текст) либо data (строка, base64)
- out: полей нет; отказ — причина записи файла
- links: DM-board, EC-005
- impl: app:src-tauri/src/main.rs, app:src/tauri-fs.ts

## API-update.check — Проверка обновления
Запрос выполняет оболочка, а не интерфейс. Принимается только пакет, подписанный
ключом автора.
- in: полей нет
- out: update — версия (строка) и заметки (строка); пусто, когда установлена последняя
- links: DEP-github-releases, EC-010, EC-011, EC-012, INV-003
- impl: app:src/updates.ts
