# Release runbook

Use this checklist for every Outgroove release. The release is not complete
until the tagged source, all three ZIPs, their smoke/manual evidence, the
checksum manifest, release metadata, Gitflow back-merge, and branch cleanup
have all been verified.

Automated GitHub Actions publication is the preferred path. The manual path
below is a narrowly scoped fallback for the known Actions budget restriction;
it is not evidence that CI passed.

## 1. Prepare and merge the release

1. Start `release/<version>` from a clean, synchronized `develop` with
   `npm run flow:release -- <version>`.
2. Finalize `CHANGELOG.md`, `package.json`, and `package-lock.json` before
   building artifacts. Do not change release documentation after checksums are
   recorded without rebuilding affected artifacts.
3. Run the full local macOS baseline:

   ```sh
   npm ci
   npm run format:check
   npm run lint
   npm run typecheck
   npm run verify
   npm run package
   npm run test:smoke
   ```

4. Open `release/<version>` against `main`. Record exact command results,
   test/skip counts, the OS and architecture actually tested, manual UI
   results, and every remaining limitation on the release PR.
5. Merge with a merge commit. Synchronize local `main`, run
   `npm run release:tag`, confirm the annotated `v<version>` points to that
   merge, then push only that tag.

Never build a release ZIP from a moving branch or an uncommitted worktree.
Every manual builder checks out the exact pushed tag.

## 2. Inspect GitHub Actions honestly

The tag normally starts native macOS arm64, Windows x64, and Linux x64 builds
and publishes the prerelease only after all three pass.

If a job reports failure without starting, inspect both its annotation and its
steps. The currently authorized administrative fallback applies only when:

- the job has zero steps; and
- the annotation is exactly:
  `The job was not started because an Actions budget is preventing further use.`

Record the annotation and complete local verification on the release PR. Say
“CI did not pass”; never describe a zero-step job as passed. Any other failure
must be diagnosed normally and does not authorize the fallback.

## 3. Build the exact tag manually

Use only checked-in redistributable fixtures and temporary/isolated profiles.
Do not select a real music library, mounted DAP, or irreplaceable file.

### macOS arm64

From a clean detached worktree at the exact tag:

```sh
npm ci
npm run verify
npm run make
npm run test:smoke
```

The ZIP is:

```text
out/make/zip/darwin/arm64/outgroove-darwin-arm64-<version>.zip
```

Record `shasum -a 256 <zip>` and `stat -f '%z' <zip>`.

### Windows x64 manual handoff

Use native Windows x64, Node 24+, npm 11+, Git, and GitHub CLI. In PowerShell:

```powershell
$version = "<version>"
$tag = "v$version"

git fetch --tags origin
git switch --detach $tag
git status --short --branch
npm ci
npm run verify
npm run make
npm run test:smoke

$artifact = Resolve-Path "out\make\zip\win32\x64\outgroove-win32-x64-$version.zip"
(Get-FileHash $artifact -Algorithm SHA256).Hash.ToLower()
(Get-Item $artifact).Length
```

`npm run verify` must pass as a whole. A timed-out UI test is not a pass. An
`EPERM` while creating the symlink safety fixture means Windows lacks symlink
permission; enable Windows Developer Mode or use an appropriately privileged
test shell, then rerun verification. Do not skip or weaken the safety test.

Open the packaged executable discovered under `out\` and perform the release
PR's manual acceptance checks. At minimum verify:

- the sandboxed renderer loads and the isolated fixture scan/backup smoke
  already passed;
- the changed workflow has correct changed/unchanged states, alignment,
  accessible names, and keyboard reachability;
- a narrow window and long values remain usable where practical;
- no preview or write is started against the real catalog; and
- the packaged application is closed after inspection.

Report the exact Windows edition/architecture, command results, SHA-256, byte
length, and an explicit manual result such as “everything looked good.” Do not
reduce the handoff to only the checksum.

Once the coordinator has created the matching prerelease, the Windows operator
may upload directly:

```powershell
gh release upload $tag $artifact --clobber
```

The coordinator must still audit the server-side asset name, byte length,
state, and digest before considering Windows complete.

### Linux x64 fallback on Apple Silicon

Linux remains beta. A Debian Bookworm amd64 container under emulation verifies
the x64 ZIP but is not native Linux hardware or a manual Linux desktop check.
Create a disposable detached worktree at the exact tag, then mount only that
worktree:

```sh
git worktree add --detach /private/tmp/outgroove-linux-release "v<version>"

docker run --platform linux/amd64 --rm \
  -e CI=true \
  -v /private/tmp/outgroove-linux-release:/workspace \
  -w /workspace \
  node:24-bookworm bash -lc '
    set -e
    uname -m
    dpkg --print-architecture
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates git zip xvfb xauth libgtk-3-0 libnss3 libxss1 \
      libasound2 libatk-bridge2.0-0 libdrm2 libgbm1 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxrandr2 libcups2 libatspi2.0-0
    npm ci
    npm run verify
    npm run make
    Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp -ac \
      >/tmp/outgroove-xvfb.log 2>&1 &
    export DISPLAY=:99
    sleep 2
    npm run test:smoke
  '
```

The explicit `CI=true` permits Electron's test-only root-container sandbox
bypass; it does not change the packaged application. Starting `Xvfb` directly
also avoids `xvfb-run` waiting indefinitely for its readiness signal under
some x86-on-ARM emulators. Include `xauth` if `xvfb-run` is used instead.

The ZIP is:

```text
out/make/zip/linux/x64/outgroove-linux-x64-<version>.zip
```

Record its SHA-256 and byte length, upload it, verify the remote digest, then
remove only the disposable worktree:

```sh
git worktree remove --force /private/tmp/outgroove-linux-release
```

Release notes must say that this was an emulated Debian amd64 container/Xvfb
check and must not imply native Linux hardware or manual desktop validation.

## 4. Publish and audit every asset

For the manual fallback, create or update the prerelease with `--target` set to
the exact tagged `main` merge. Upload these four assets:

- `outgroove-darwin-arm64-<version>.zip`
- `outgroove-win32-x64-<version>.zip`
- `outgroove-linux-x64-<version>.zip`
- `SHA256SUMS.txt`

`SHA256SUMS.txt` contains one lowercase SHA-256 line for each ZIP. Generate it
only after all three final artifacts exist. Do not announce the prerelease
while any platform or checksum is missing.

Audit the result with:

```sh
gh release view "v<version>" \
  --json assets,body,isPrerelease,targetCommitish,url
```

Confirm:

- exactly the expected three ZIPs and checksum file are present;
- every asset state is `uploaded`;
- remote sizes and SHA-256 digests match the recorded local/Windows evidence;
- `targetCommitish` is the tagged `main` merge, not `develop`;
- notes name the platforms actually tested and their limitations;
- unsigned/notarized warnings remain present; and
- the tag dereferences to the expected merge commit.

## 5. Back-merge and clean up

1. Open `main` against `develop` and record the release verification.
2. Inspect any failed check annotation again before using the exact
   budget-restriction administrative merge fallback.
3. Merge with a merge commit and synchronize local `develop`.
4. Delete the merged local and remote `release/<version>` branches.
5. Confirm `main`, `develop`, the tag, release target, and remote branches are
   synchronized; the normal worktree must be clean.

The final handoff lists the feature/release commits, release PR, tag, `main`
merge, back-merge PR/commit, branch cleanup, commands and results, actual
platforms, hashes/sizes, CI status, and unverified risks.
