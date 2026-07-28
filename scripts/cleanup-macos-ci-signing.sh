#!/bin/bash

set -euo pipefail

: "${RUNNER_TEMP:?RUNNER_TEMP is required}"

require_runner_temp_path() {
  local path="$1"
  if [[ "$path" != "$RUNNER_TEMP/"* ]]; then
    echo "Refusing to remove a path outside RUNNER_TEMP." >&2
    exit 1
  fi
}

for temporary_file in \
  "${OUTGROOVE_MAC_TEMP_KEYCHAIN:-}" \
  "${OUTGROOVE_MAC_TEMP_CERTIFICATE:-}" \
  "${OUTGROOVE_MAC_TEMP_API_KEY:-}"; do
  if [[ -n "$temporary_file" ]]; then
    require_runner_temp_path "$temporary_file"
  fi
done

cleanup_status=0
if [[ -n "${OUTGROOVE_MAC_TEMP_KEYCHAIN:-}" ]]; then
  security delete-keychain "$OUTGROOVE_MAC_TEMP_KEYCHAIN" || cleanup_status=1
fi
if [[ -n "${OUTGROOVE_MAC_TEMP_CERTIFICATE:-}" ]]; then
  rm -f "$OUTGROOVE_MAC_TEMP_CERTIFICATE"
fi
if [[ -n "${OUTGROOVE_MAC_TEMP_API_KEY:-}" ]]; then
  rm -f "$OUTGROOVE_MAC_TEMP_API_KEY"
fi
exit "$cleanup_status"
