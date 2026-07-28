# AcoustID application setup

Outgroove's optional recording lookup fingerprints one explicitly selected
track locally with Chromaprint. A separate confirmation sends only the
fingerprint and whole-file duration to AcoustID. It never submits fingerprints
to the database, uploads audio, or sends paths, artwork, existing tags, titles,
or artists.

## Register the application

1. Sign in at <https://acoustid.org/api-key>.
2. Register an application for Outgroove. AcoustID distinguishes this
   application key from a personal user API key; Outgroove needs only the
   application key used by the lookup endpoint.
3. Keep the registered usage non-commercial unless a commercial AcoustID
   agreement has been arranged. The public service currently permits free
   non-commercial use, limits clients to three requests per second, and asks
   applications expecting significant traffic to contact the project.

The application key identifies the client to AcoustID and is necessarily
included in lookup requests. Outgroove embeds it only in the privileged main
bundle; it is not exposed through preload, renderer state, diagnostics, logs,
or IPC payloads.

## Local development and packaging

Set the key only for the command that builds or starts Outgroove:

```sh
OUTGROOVE_ACOUSTID_API_KEY="registered-key" npm start
OUTGROOVE_ACOUSTID_API_KEY="registered-key" npm run package
```

PowerShell:

```powershell
$env:OUTGROOVE_ACOUSTID_API_KEY = "registered-key"
npm start
```

Without the variable, Outgroove still builds and every local feature remains
available. Local fingerprint preview works, but confirmed AcoustID lookup
reports that the build has no registered application key.

## GitHub release secret

Create the repository Actions secret `ACOUSTID_API_KEY` with the registered
application key. The release workflow maps it to
`OUTGROOVE_ACOUSTID_API_KEY` only for `npm run make`. Pull-request CI does not
need provider credentials and uses recorded responses.

The existing Actions spending restriction can prevent jobs from starting. As
with the rest of the release workflow, a zero-step budget failure is not
evidence that the AcoustID-enabled package was built or tested. Use the
documented native macOS, Windows, and Linux handoff when that restriction is
active.

## Bundled helper

Outgroove packages the official Chromaprint 1.6.1 `fpcalc` executable for
macOS arm64, Windows x64, and Linux x64. Checksums and replacement details are
recorded in [`resources/fpcalc/README.md`](../resources/fpcalc/README.md).
Unsupported architectures fail locally and never fall back to an executable
from `PATH`.
