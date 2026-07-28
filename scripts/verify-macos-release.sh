#!/bin/bash

set -euo pipefail

dmg_directory="${1:-out/make}"
dmg_path="$(find "$dmg_directory" -maxdepth 1 -type f -name '*.dmg' -print -quit)"
if [[ -z "$dmg_path" ]]; then
  echo "No macOS DMG found in $dmg_directory." >&2
  exit 1
fi

codesign --verify --strict --verbose=2 "$dmg_path"
xcrun stapler validate "$dmg_path"
spctl --assess --type open --context context:primary-signature --verbose=2 \
  "$dmg_path"
hdiutil verify "$dmg_path"

mount_point="$(mktemp -d "${TMPDIR%/}/outgroove-dmg.XXXXXX")"
mounted=0
cleanup() {
  if [[ "$mounted" -eq 1 ]]; then
    hdiutil detach "$mount_point"
  fi
  rmdir "$mount_point"
}
trap cleanup EXIT

hdiutil attach -nobrowse -readonly -mountpoint "$mount_point" "$dmg_path"
mounted=1
app_path="$(find "$mount_point" -maxdepth 1 -type d -name '*.app' -print -quit)"
if [[ -z "$app_path" ]]; then
  echo "The mounted DMG contains no application bundle." >&2
  exit 1
fi

codesign --verify --deep --strict --verbose=2 "$app_path"
spctl --assess --type execute --verbose=2 "$app_path"
