# Third-party notices

This file supplements the license files shipped with Outgroove's dependencies.
It is not legal advice.

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
