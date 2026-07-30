#!/bin/zsh
set -euo pipefail

# Обновляет Excalidraw до свежего коммита, сохраняя наши правки.
#
#   ./scripts/update-editor.sh              # до последнего master
#   ./scripts/update-editor.sh <коммит|тег>  # до конкретного
#
# Смысл всей затеи: чужой редактор развивается, и его улучшения нам нужны, а
# своих правок внутри него — единицы, и они лежат отдельными патчами. Поэтому
# обновление здесь — это смена одного хеша и повторное наложение патчей, а не
# слияние двух версий чужого кода.
#
# Если патч не лёг на новый коммит, скрипт останавливается и говорит, какой
# именно. Это и есть нужное поведение: молча пропущенная правка означала бы,
# что подсказка вернулась, а никто не заметил.

PROJECT_ROOT="${0:A:h:h}"
UPSTREAM_DIR="$PROJECT_ROOT/upstream-excalidraw"
SETUP="$PROJECT_ROOT/scripts/setup.sh"
TARGET="${1:-master}"

if [[ ! -d "$UPSTREAM_DIR/.git" ]]; then
  print -u2 "Апстрима ещё нет. Сначала: scripts/setup.sh"
  exit 2
fi

CURRENT=$(git -C "$UPSTREAM_DIR" rev-parse HEAD)

print "Ищу $TARGET…"
git -C "$UPSTREAM_DIR" fetch -q --depth 1 origin "$TARGET"
NEXT=$(git -C "$UPSTREAM_DIR" rev-parse FETCH_HEAD)

if [[ "$NEXT" == "$CURRENT" ]]; then
  print "Уже на ${CURRENT:0:8} — обновлять нечего."
  exit 0
fi

print "Было ${CURRENT:0:8} → станет ${NEXT:0:8}"
git -C "$UPSTREAM_DIR" log --oneline -1 FETCH_HEAD

# Пин живёт в setup.sh: он единственный источник правды о версии редактора,
# и чистая установка на другой машине обязана принести ровно этот коммит.
sed -i '' "s/^UPSTREAM_COMMIT=\".*\"/UPSTREAM_COMMIT=\"$NEXT\"/" "$SETUP"

# Рабочее дерево возвращается к чистому состоянию: патчи накладываются поверх
# нового коммита с нуля, иначе они пытались бы лечь на уже пропатченный код.
git -C "$UPSTREAM_DIR" checkout -q -- .
git -C "$UPSTREAM_DIR" checkout -q FETCH_HEAD

# Сборка пакетов пропускается, когда `dist` на месте, — а после смены коммита
# там лежит старая версия редактора.
rm -rf "$UPSTREAM_DIR/packages"/*/dist

if ! "$SETUP"; then
  print -u2 ""
  print -u2 "Обновление остановлено. Пин уже переставлен на ${NEXT:0:8};"
  print -u2 "почини патч в patches/ и запусти scripts/setup.sh снова,"
  print -u2 "либо верни прежний коммит: git -C upstream-excalidraw checkout $CURRENT"
  exit 3
fi

print ""
print "Редактор обновлён до ${NEXT:0:8}, патчи легли."
print "Дальше: ./scripts/build-release.sh --install — и глазами по доске."
