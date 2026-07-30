#!/bin/zsh
set -euo pipefail

# Ставит собранный LocalBoard.app в /Applications и оставляет на машине ровно
# одну копию приложения.
#
# Смысл в единственности: две сборки на диске — это гарантия однажды запустить
# вчерашнюю и проверять не то, что починил. Поэтому скрипт не просто копирует
# новую версию, но и убирает все прочие LocalBoard.app, которые найдёт в
# обычных местах установки.
#
#   scripts/install-local.sh [путь/к/LocalBoard.app]
# Без аргумента берётся свежая сборка из src-tauri/target/release/bundle/macos.

PROJECT_ROOT="${0:A:h:h}"
SOURCE_APP="${1:-$PROJECT_ROOT/src-tauri/target/release/bundle/macos/LocalBoard.app}"
TARGET_APP="/Applications/LocalBoard.app"

if [[ ! -d "$SOURCE_APP" ]]; then
  print -u2 "Нет собранного приложения: $SOURCE_APP"
  exit 2
fi

# Запущенная копия держит свой бандл; переустановка под ней даёт приложение,
# которое уже не соответствует ни одной версии на диске.
if pgrep -x LocalBoard >/dev/null 2>&1; then
  print "Закрываю запущенный LocalBoard…"
  osascript -e 'tell application "LocalBoard" to quit' >/dev/null 2>&1 || true
  sleep 2
  pkill -x LocalBoard 2>/dev/null || true
fi

# Прежняя установка убирается целиком, а не перезаписывается: ditto поверх
# существующего бандла оставляет файлы, которых в новой сборке уже нет.
rm -rf "$TARGET_APP"
ditto "$SOURCE_APP" "$TARGET_APP"

# Прочие копии в обычных местах установки — чтобы актуальная осталась одна.
for stray in "$HOME/Applications/LocalBoard.app" "$HOME/Desktop/LocalBoard.app" \
             "$HOME/Downloads/LocalBoard.app"; do
  if [[ -d "$stray" ]]; then
    print "Убираю лишнюю копию: $stray"
    rm -rf "$stray"
  fi
done

# Смонтированные установщики прошлых версий — тоже путь запустить не ту сборку.
for volume in /Volumes/LocalBoard*(N); do
  hdiutil detach "$volume" -quiet -force 2>/dev/null || true
done

# Карантин снимается только с того, что мы сами сейчас собрали: без этого
# первый запуск упирается в диалог неизвестного разработчика на своей же машине.
xattr -dr com.apple.quarantine "$TARGET_APP" 2>/dev/null || true

VERSION=$(defaults read "$TARGET_APP/Contents/Info.plist" CFBundleShortVersionString)
print "Установлено: $TARGET_APP (версия $VERSION) — единственная копия на машине."
