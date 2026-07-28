#!/bin/bash

set -euo pipefail

: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${GITHUB_ENV:?GITHUB_ENV is required}"
: "${MACOS_CERTIFICATE_P12_BASE64:?macOS certificate secret is required}"
: "${MACOS_CERTIFICATE_PASSWORD:?macOS certificate password is required}"
: "${APPLE_API_KEY_P8_BASE64:?Apple API key secret is required}"
: "${APPLE_API_KEY_ID:?Apple API key ID is required}"
: "${APPLE_API_ISSUER:?Apple API issuer is required}"

certificate_path="$RUNNER_TEMP/outgroove-signing.p12"
api_key_path="$RUNNER_TEMP/AuthKey_${APPLE_API_KEY_ID}.p8"
keychain_path="$RUNNER_TEMP/outgroove-signing.keychain-db"
keychain_password="$(openssl rand -hex 32)"

{
  echo "OUTGROOVE_MAC_TEMP_KEYCHAIN=$keychain_path"
  echo "OUTGROOVE_MAC_TEMP_CERTIFICATE=$certificate_path"
  echo "OUTGROOVE_MAC_TEMP_API_KEY=$api_key_path"
} >>"$GITHUB_ENV"

printf '%s' "$MACOS_CERTIFICATE_P12_BASE64" |
  base64 --decode >"$certificate_path"
printf '%s' "$APPLE_API_KEY_P8_BASE64" |
  base64 --decode >"$api_key_path"
chmod 600 "$certificate_path" "$api_key_path"

security create-keychain -p "$keychain_password" "$keychain_path"
security set-keychain-settings -lut 21600 "$keychain_path"
security unlock-keychain -p "$keychain_password" "$keychain_path"
security import "$certificate_path" \
  -k "$keychain_path" \
  -P "$MACOS_CERTIFICATE_PASSWORD" \
  -T /usr/bin/codesign \
  -T /usr/bin/security
security set-key-partition-list \
  -S apple-tool:,apple:,codesign: \
  -s \
  -k "$keychain_password" \
  "$keychain_path"
security list-keychains -d user -s "$keychain_path"

signing_identity="$(
  security find-identity -v -p codesigning "$keychain_path" |
    sed -n 's/.*"\(Developer ID Application:.*\)"/\1/p' |
    head -n 1
)"
if [[ -z "$signing_identity" ]]; then
  echo "No Developer ID Application identity was imported." >&2
  exit 1
fi

{
  echo "OUTGROOVE_MAC_SIGNING=1"
  echo "OUTGROOVE_MAC_SIGNING_IDENTITY=$signing_identity"
  echo "OUTGROOVE_MAC_NOTARY_API_KEY_PATH=$api_key_path"
  echo "OUTGROOVE_MAC_NOTARY_API_KEY_ID=$APPLE_API_KEY_ID"
  echo "OUTGROOVE_MAC_NOTARY_API_ISSUER=$APPLE_API_ISSUER"
} >>"$GITHUB_ENV"
