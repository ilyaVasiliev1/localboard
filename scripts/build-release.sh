#!/bin/zsh
set -euo pipefail

# Собирает распространяемый LocalBoard.dmg.
#
# Без Developer ID скрипт намеренно делает установщик для «своих»: он ставится
# через Системные настройки → Конфиденциальность и безопасность, но не проходит
# нотаризацию Apple для публичной раздачи. С сертификатом:
#   SIGN_IDENTITY="Developer ID Application: …"
#   NOTARY_PROFILE=localboard-notary
#
# Флаг --install в конце кладёт свежую сборку в /Applications и убирает все
# прочие копии LocalBoard.app с диска — на машине остаётся ровно одна, актуальная.

PROJECT_ROOT="${0:A:h:h}"
SIGN_IDENTITY="${SIGN_IDENTITY:--}"
NOTARY_PROFILE="${NOTARY_PROFILE:-}"
OUTPUT_DIR="$PROJECT_ROOT/.tmp/release-artifacts"
STAGING="$PROJECT_ROOT/.tmp/release"
APP_PATH="$PROJECT_ROOT/src-tauri/target/release/bundle/macos/LocalBoard.app"
VOLUME_NAME="LocalBoard"

INSTALL=0
for arg in "$@"; do
  [[ "$arg" == "--install" ]] && INSTALL=1
done

if [[ ! -d "$PROJECT_ROOT/upstream-excalidraw/.git" || ! -d "$PROJECT_ROOT/node_modules" ]]; then
  print -u2 "Дерево не готово к сборке. Сначала: scripts/setup.sh"
  exit 2
fi

mkdir -p "$OUTPUT_DIR" "$STAGING"

# --bundles app: DMG собирается ниже вручную, потому что стандартный установщик
# Tauri не умеет ни фона, ни раскладки окна.
cd "$PROJECT_ROOT"
npm run tauri -- build --bundles app

if [[ ! -d "$APP_PATH" ]]; then
  print -u2 "Сборка не дала $APP_PATH"
  exit 3
fi

if [[ "$SIGN_IDENTITY" == "-" ]]; then
  codesign --force --deep --sign - "$APP_PATH"
  ARTIFACT_NAME="LocalBoard.dmg"
else
  SIGN_ARGS=(--force --deep --sign "$SIGN_IDENTITY")
  if [[ "$SIGN_IDENTITY" == "Developer ID Application:"* ]]; then
    SIGN_ARGS+=(--options runtime --timestamp)
  fi
  codesign "${SIGN_ARGS[@]}" "$APP_PATH"
  ARTIFACT_NAME="LocalBoard.dmg"
fi

codesign --verify --deep --strict --verbose=2 "$APP_PATH"

DMG_ROOT="$STAGING/dmg-root"
rm -rf "$DMG_ROOT"
mkdir -p "$DMG_ROOT/.background"
ditto "$APP_PATH" "$DMG_ROOT/LocalBoard.app"
ln -s /Applications "$DMG_ROOT/Applications"
swift "$PROJECT_ROOT/scripts/make-dmg-background.swift" \
  "$DMG_ROOT/.background/background.tiff" >/dev/null

# Окно установщика раскладывается явно. Один `hdiutil create` даёт неоформленное
# окно Finder — какой у человека вид списка и размер окна по умолчанию, такой и
# будет. Это и есть разница между установщиком, который сделали, и тем, который
# просто выпал из сборки.
#
# Раскладку можно применить только к *записываемому* смонтированному образу,
# поэтому DMG сначала собирается read/write, оформляется через Finder и лишь
# затем конвертируется в сжатый read-only артефакт, который уезжает в релиз.
RW_DMG="$STAGING/LocalBoard-rw.dmg"
APP_MEGABYTES=$(du -sm "$APP_PATH" | cut -f1)
rm -f "$RW_DMG"
hdiutil create -quiet -volname "$VOLUME_NAME" -srcfolder "$DMG_ROOT" \
  -fs HFS+ -format UDRW -size $((APP_MEGABYTES + 64))m -ov "$RW_DMG"

# Точка монтирования обязана быть под /Volumes: Finder адресует диск по имени и
# не видит образ, смонтированный где-то ещё (падает с -1728).
MOUNT_POINT="/Volumes/$VOLUME_NAME"
if [[ -d "$MOUNT_POINT" ]]; then
  hdiutil detach "$MOUNT_POINT" -quiet -force || true
fi
hdiutil attach "$RW_DMG" -mountpoint "$MOUNT_POINT" -quiet

# Центры иконок обязаны совпадать с `make-dmg-background.swift`: он рисует
# стрелку ровно между этими двумя точками.
# Порядок команд не косметика, и отсутствующий `close` — намеренно. Закрытие
# окна заставляет Finder переписать `.DS_Store` дефолтами, и установщик
# открывается без фона, хотя все опции были применены. Поэтому окно остаётся
# открытым, а том отмонтируется под ним — после `update` и паузы, достаточной,
# чтобы запись дошла до образа.
osascript <<APPLESCRIPT
tell application "Finder"
  tell disk "$VOLUME_NAME"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {240, 140, 880, 560}
    set viewOptions to the icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to 128
    set text size of viewOptions to 13
    set background picture of viewOptions to POSIX file "$MOUNT_POINT/.background/background.tiff"
    set position of item "LocalBoard.app" of container window to {160, 210}
    set position of item "Applications" of container window to {480, 210}
    update without registering applications
    delay 3
  end tell
end tell
APPLESCRIPT

sync
sleep 3
hdiutil detach "$MOUNT_POINT" -quiet -force

rm -f "$OUTPUT_DIR/$ARTIFACT_NAME"
hdiutil convert -quiet "$RW_DMG" -format UDZO -imagekey zlib-level=9 \
  -o "$OUTPUT_DIR/$ARTIFACT_NAME"
rm -f "$RW_DMG"

if [[ -n "$NOTARY_PROFILE" && "$SIGN_IDENTITY" != "-" ]]; then
  xcrun notarytool submit "$OUTPUT_DIR/$ARTIFACT_NAME" \
    --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$OUTPUT_DIR/$ARTIFACT_NAME"
  xcrun stapler validate "$OUTPUT_DIR/$ARTIFACT_NAME"
fi

if (( INSTALL )); then
  "$PROJECT_ROOT/scripts/install-local.sh" "$APP_PATH"
fi

print "$OUTPUT_DIR/$ARTIFACT_NAME"
