# Third-party notices

Outgroove's original source code is licensed under GPL-3.0-or-later. This file
supplements the license files shipped with its dependencies; every third-party
component retains its own license and copyright notices.

The direct JavaScript dependencies use GPL-compatible MIT, Apache-2.0, BSD, or
ISC terms. The LGPL components called out below remain separately replaceable
files and retain their LGPL terms. This inventory is not legal advice.

## taglib-wasm 1.5.3

Outgroove uses the JavaScript/TypeScript wrapper from `taglib-wasm` 1.5.3 under
the MIT License. Its packaged `taglib-web.wasm` and `taglib-wasi.wasm` binaries
contain TagLib and are licensed under LGPL-2.1-or-later.

- Project and exact source release:
  <https://github.com/CharlesWiltgen/TagLib-Wasm/tree/v1.5.3>
- TagLib project: <https://taglib.org/>
- GNU LGPL 2.1 text:
  <https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html>
- The installed wrapper's MIT notice and additional licensing information are
  retained as `node_modules/taglib-wasm/LICENSE` in the packaged application.

To build compatible replacement WebAssembly binaries, obtain the exact source
release (including its TagLib source), modify it if desired, install its pinned
build prerequisites, and run:

```sh
npm run build:wasm
```

The resulting `taglib-web.wasm` and `taglib-wasi.wasm` can replace the
corresponding files in a macOS package at:

```text
Outgroove.app/Contents/Resources/app.asar.unpacked/node_modules/taglib-wasm/dist/
```

Windows and Linux packages use the equivalent
`resources/app.asar.unpacked/node_modules/taglib-wasm/dist/` directory.
Outgroove loads these binaries as separate runtime files; rebuilding Outgroove
is not required to substitute a compatible modified TagLib-Wasm build.

## Chromaprint fpcalc 1.6.1

Outgroove bundles the official `fpcalc` executable for macOS arm64, Windows
x64, and Linux x64. Chromaprint's own code is MIT-licensed and includes FFmpeg
code under LGPL-2.1; the upstream project describes the combined work as
LGPL-2.1. The exact upstream notice is copied into packaged application
resources as `LICENSE.md`.

- Project and exact source release:
  <https://github.com/acoustid/chromaprint/tree/v1.6.1>
- Official binary release and checksums:
  <https://github.com/acoustid/chromaprint/releases/tag/v1.6.1>
- GNU LGPL 2.1 text:
  <https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html>

The helper remains a separate executable outside `app.asar`. A compatible
modified build can replace `fpcalc` (`fpcalc.exe` on Windows) under the
application's resources directory without rebuilding Outgroove. The checked-in
[`resources/fpcalc/README.md`](resources/fpcalc/README.md) records exact archive
and executable SHA-256 values.
