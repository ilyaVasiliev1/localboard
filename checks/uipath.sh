#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${ORC_ARTIFACTS:?uipath must receive ORC_ARTIFACTS for screenshots}"
mkdir -p "${ORC_ARTIFACTS}"

cd "${root_dir}"
app_path="${root_dir}/src-tauri/target/release/bundle/macos/LocalBoard.app"
input_fingerprint="$({
  git ls-files -co --exclude-standard -z -- \
    src src-tauri/src src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json \
    package.json package-lock.json vite.config.ts tsconfig.json upstream-excalidraw
} | while IFS= read -r -d '' file; do
  printf '%s\0' "${file}"
  git hash-object "${file}"
done | shasum -a 256 | awk '{print $1}')"
stamp="${root_dir}/src-tauri/target/release/.orc-uipath-input"

if [[ -d "${app_path}" && -f "${stamp}" && "$(<"${stamp}")" == "${input_fingerprint}" ]]; then
  echo "reusing LocalBoard.app built from the same UI inputs…" >&2
else
  echo "building LocalBoard.app for UI acceptance…" >&2
  npm run tauri -- build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'
  printf '%s\n' "${input_fingerprint}" >"${stamp}"
fi
if [[ ! -d "${app_path}" ]]; then
  echo "UI acceptance failed: build did not produce ${app_path}" >&2
  exit 1
fi

data_root="$(mktemp -d "${TMPDIR:-/tmp}/localboard-uipath-data.XXXXXX")"
app_root="$(mktemp -d "${TMPDIR:-/tmp}/localboard-uipath-app.XXXXXX")"
cleanup() {
  rm -rf "${data_root}" "${app_root}"
}
trap cleanup EXIT

mkdir -p "${data_root}/boards"
for board in "Проверочная схема" "Вторая схема"; do
  printf '%s\n' '{"type":"excalidraw","version":2,"source":"localboard-uipath","elements":[],"appState":{},"files":{}}' \
    >"${data_root}/boards/${board}.excalidraw"
done

verification_app="${app_root}/LocalBoard.app"
cp -R "${app_path}" "${verification_app}"
plist="${verification_app}/Contents/Info.plist"
bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "${plist}")"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier ${bundle_id}.uipath.$$" "${plist}"
codesign --force --deep --sign - "${verification_app}"

echo "running LocalBoard through its accessibility tree…" >&2
swift "${root_dir}/checks/uipath/Scenario.swift" \
  "${verification_app}" "${data_root}" "${ORC_ARTIFACTS}"
