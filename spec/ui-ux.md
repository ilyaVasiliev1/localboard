# Экраны и элементы

Окно одно, экранов внутри нет: адрес элемента — само окно.

---

## UI-board.canvas — Холст доски
- page: /
Редактор Excalidraw во всю площадь окна. Показывает открытую доску, берёт её
через чтение файла и отдаёт правки автосохранению.
- links: L-001, API-boards.read, DEP-excalidraw
- impl: app:src/EditorPortal.tsx, app:src/App.tsx

## UI-sidebar.boards — Список досок
- page: /
Боковая панель со списком досок подключённых папок. Строка списка открывает
доску. Панель закрывается и закрепляется; закреплённое состояние переживает
перезапуск. Состояния: доски есть, досок в папке нет, поиск ничего не нашёл,
папка отключена.
- links: L-008, API-boards.list, L-006
- impl: app:src/App.tsx

## UI-sidebar.folders — Папки в списке
- page: /
Папки — разделы списка досок: сворачиваются, открываются в Finder и
подключаются кнопкой внизу панели. Свёрнутое состояние переживает перезапуск.
- links: API-folders.list, API-folders.add, API-shell.reveal
- impl: app:src/App.tsx

## UI-sidebar.search — Поиск по доскам
- page: /
Поле поиска над списком отбирает доски по части названия. Пустой результат
показывает подсказку вместо списка.
- links: UI-sidebar.boards
- impl: app:src/App.tsx

## UI-board.status — Состояние сохранения
- page: /
Показывает одно из трёх: правки сохранены, есть несохранённые правки, идёт
сохранение.
- links: L-001, INV-001
- impl: app:src/App.tsx

## UI-board.menu — Меню доски и папки
- page: /
Правый клик по строке доски открывает системное меню macOS с переименованием и
удалением; по строке папки — с отключением папки. Меню строит система, а не
интерфейс.
- links: API-boards.rename, API-boards.delete, API-folders.remove, DEP-tauri
- impl: app:src-tauri/src/main.rs, app:src/App.tsx

## UI-agent.window — Работа с ассистентом
- page: /
Окно из трёх шагов: где лежат доски, где лежит инструкция, готовая команда
запуска ассистента. Пути показываются целиком, чтобы команду можно было
скопировать.
- links: API-agent.setup, TERM-guide
- impl: app:src/AgentPanel.tsx

## UI-app.menu — Пункты меню приложения
- page: /
Меню приложения содержит проверку обновлений, выгрузку копии доски и открытие
окна работы с ассистентом.
- links: API-update.check, L-007, API-file.export
- impl: app:src/App.tsx
