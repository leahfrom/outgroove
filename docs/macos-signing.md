# macOS Developer ID signing and notarization

Outgroove is distributed directly, outside the Mac App Store. Its primary
macOS artifact is therefore a read-only UDZO disk image containing the
application and an Applications-folder alias. The application uses the stable
bundle identifier `de.leahfrom.outgroove`; the separately signed disk-image
container uses `de.leahfrom.outgroove.dmg`.

Apple recommends signing nested code from the inside out, signing the
distribution container, notarizing only the outermost container, and stapling
the accepted ticket to that container. Outgroove follows that sequence:

1. Electron Forge signs the application and its nested code with hardened
   runtime and a secure timestamp.
2. The DMG maker creates the drag-to-Applications image and signs it with the
   same Developer ID Application identity.
3. The completed DMG is uploaded to Apple's automated notarization service
   with `notarytool`. This is not App Store submission or App Review.
4. A successful ticket is stapled to the DMG.
5. Separate checks verify the DMG, mounted application, staple, and Gatekeeper
   assessment.

Unsigned local packaging remains available and performs no Apple network
request. Release signing is opt-in and refuses incomplete or conflicting
credentials.

## 1. Create and install the Developer ID Application certificate

Only the Apple Developer Program Account Holder can create a Developer ID
certificate. An individual enrollee is their own Account Holder.

1. Open **Keychain Access**.
2. Choose **Keychain Access → Certificate Assistant → Request a Certificate
   From a Certificate Authority**.
3. Enter the Apple Developer account email and a recognizable common name,
   choose **Saved to disk**, and save the certificate signing request. This
   also creates the matching private key in the login keychain.
4. Open Apple Developer
   **Certificates, Identifiers & Profiles → Certificates**, press **+**, and
   choose **Developer ID Application**. Do not choose Developer ID Installer,
   Mac Distribution, or Apple Development.
5. Upload the certificate signing request, download the resulting `.cer`, and
   double-click it to install it in the login keychain.
6. In Keychain Access, open **login → My Certificates**. Expand the new
   Developer ID Application certificate and confirm that its private key is
   nested underneath it.
7. Verify the identity from Terminal:

   ```sh
   security find-identity -v -p codesigning
   ```

   Record the complete quoted identity, including the team ID. It has the form
   `Developer ID Application: Name (TEAMID)`.

For GitHub Actions, select the certificate and nested private key together in
**My Certificates**, then choose **File → Export Items**. Export a `.p12` and
protect it with a new strong password used only for this export. Store the
`.p12` and password in a password manager. Never commit either item.

## 2. Create a Team App Store Connect API key

`notarytool` accepts an App Store Connect API key. It must be a **Team key**;
Apple says individual API keys cannot use `notarytool`.

1. Open **App Store Connect → Users and Access → Integrations → App Store
   Connect API**.
2. If API access has not been enabled, the Account Holder must enable it.
3. Under **Team Keys**, generate a key named `Outgroove Notarization` with the
   **Developer** role. This is a delivery credential, not an app-content or
   financial credential.
4. Record the **Issuer ID** and **Key ID**.
5. Download the `AuthKey_<KEY_ID>.p8` file. Apple permits this download only
   once, so store it in the password manager immediately.

If the portal does not show Team Keys or the Developer role cannot notarize,
stop and resolve the account role/access in App Store Connect instead of using
a broader personal credential in the repository.

## 3. Test the credentials locally

Store the API key in the macOS Keychain through `notarytool`; the profile name
is not secret:

```sh
xcrun notarytool store-credentials "outgroove-notary" \
  --key "/absolute/private/path/AuthKey_<KEY_ID>.p8" \
  --key-id "<KEY_ID>" \
  --issuer "<ISSUER_ID>"
```

`store-credentials` validates the values before saving them. Then build from a
clean worktree:

```sh
OUTGROOVE_MAC_SIGNING=1 \
OUTGROOVE_MAC_SIGNING_IDENTITY='Developer ID Application: Name (TEAMID)' \
OUTGROOVE_MAC_NOTARY_KEYCHAIN_PROFILE='outgroove-notary' \
npm run make
```

The make command waits for Apple's result and staples an accepted ticket. Then
run:

```sh
./scripts/verify-macos-release.sh
npm run test:smoke
```

Mount the DMG in Finder, drag Outgroove to Applications, launch that copy, and
confirm that Gatekeeper does not require a privacy-bypassing workaround. Use
only the checked-in fixtures or an isolated profile. Verify the Radar
notification preference and a consented test notification, then close the app.

If notarization fails, do not publish the artifact. Retrieve the notarization log
with `xcrun notarytool log <submission-id> --keychain-profile
outgroove-notary`, correct the signing problem, and rebuild from the beginning.
Never edit or re-sign a DMG after stapling it.

## 4. Configure GitHub Actions secrets

The release workflow requires all five repository Actions secrets and fails
before packaging when any is absent:

- `MACOS_CERTIFICATE_P12_BASE64`
- `MACOS_CERTIFICATE_PASSWORD`
- `APPLE_API_KEY_P8_BASE64`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

The GitHub CLI encrypts values locally. From the repository, upload the two
files as base64 without printing their contents:

```sh
base64 -i "/absolute/private/path/outgroove-signing.p12" |
  gh secret set MACOS_CERTIFICATE_P12_BASE64
base64 -i "/absolute/private/path/AuthKey_<KEY_ID>.p8" |
  gh secret set APPLE_API_KEY_P8_BASE64
```

Set the three text values through hidden interactive prompts:

```sh
gh secret set MACOS_CERTIFICATE_PASSWORD
gh secret set APPLE_API_KEY_ID
gh secret set APPLE_API_ISSUER
```

Do not use `--body` for the password or key material because that can leave a
secret in shell history. Confirm only the names:

```sh
gh secret list
```

On the macOS runner, the workflow decodes both files under `RUNNER_TEMP`,
imports the certificate into a temporary keychain, derives the public signing
identity, and exports only environment variables needed by Forge. An
`always()` cleanup step deletes the temporary keychain and both temporary
files. GitHub never receives the local `notarytool` keychain profile.

The current GitHub Actions spending restriction can prevent every job from
starting. Secret configuration does not bypass that restriction. Until it is
resolved, create the signed/notarized macOS DMG locally from the exact release
tag, record all verification, digest, byte length, and manual evidence on the
release PR, and use only the release runbook's authorized fallback. Never claim
that CI passed when the runner had zero steps.

## References

- [Apple: Developer ID](https://developer.apple.com/support/developer-id/)
- [Apple: create Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)
- [Apple: package Mac software for distribution](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)
- [Apple: notarize macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [Apple: create App Store Connect API keys](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api)
- [Electron Forge: macOS code signing](https://www.electronforge.io/guides/code-signing/code-signing-macos)
- [Electron Forge: DMG maker](https://www.electronforge.io/config/makers/dmg)
