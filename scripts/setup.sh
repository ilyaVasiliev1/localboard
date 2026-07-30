#!/bin/zsh
set -euo pipefail

# Готовит дерево к сборке: приносит редактор Excalidraw и ставит зависимости.
#
# Апстрим не вендорится в репозиторий — он клонируется здесь на строго
# зафиксированном коммите. Пин важен: LocalBoard собирается из исходников
# редактора, а не из опубликованного пакета, поэтому «просто свежий master»
# однажды поменяет API под ногами.

PROJECT_ROOT="${0:A:h:h}"
UPSTREAM_DIR="$PROJECT_ROOT/upstream-excalidraw"
UPSTREAM_REPO="https://github.com/excalidraw/excalidraw.git"
UPSTREAM_COMMIT="1acf66edabc2ac5bbd4aed0714aed7dca7cc2aab"

if [[ ! -d "$UPSTREAM_DIR/.git" ]]; then
  print "Клонирую Excalidraw на коммите ${UPSTREAM_COMMIT:0:8}…"
  rm -rf "$UPSTREAM_DIR"
  git init -q "$UPSTREAM_DIR"
  git -C "$UPSTREAM_DIR" remote add origin "$UPSTREAM_REPO"
fi

CURRENT="$(git -C "$UPSTREAM_DIR" rev-parse HEAD 2>/dev/null || print none)"
if [[ "$CURRENT" != "$UPSTREAM_COMMIT" ]]; then
  # Тянем только нужный коммит: полная история редактора — это лишние ~35 МБ
  # и минуты, из которых для сборки не используется ничего.
  git -C "$UPSTREAM_DIR" fetch -q --depth 1 origin "$UPSTREAM_COMMIT"
  git -C "$UPSTREAM_DIR" checkout -q FETCH_HEAD
fi

# Пакеты редактора отдают не исходники, а сборку: `exports` каждого из них
# указывает на `dist/`, которого в репозитории Excalidraw нет — он там в
# .gitignore. Без этого шага Vite не может разрешить @excalidraw/excalidraw, и
# всё падает на первом же импорте. Собирается один раз и переживает npm install.
if [[ ! -d "$UPSTREAM_DIR/packages/excalidraw/dist" ]]; then
  if ! command -v yarn >/dev/null 2>&1; then
    print -u2 "Нужен yarn 1.x — Excalidraw собирается только им (packageManager: yarn@1.22)."
    print -u2 "Поставить: npm install -g yarn"
    exit 2
  fi
  print "Собираю пакеты Excalidraw (первый раз — долго)…"
  (cd "$UPSTREAM_DIR" && yarn install && yarn build:packages)
fi

# Собственные зависимости пакетов редактора npm ставит в корневой node_modules,
# поэтому больше внутри upstream-excalidraw ничего не нужно.
print "Ставлю зависимости…"
cd "$PROJECT_ROOT"
npm install

print "Готово. Дальше: npm run tauri dev — или scripts/build-release.sh для DMG."
