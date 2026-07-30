# Contributing to Outgroove

Read `AGENTS.md` and the relevant parts of `PLAN.md` before changing product behavior. Outgroove uses Gitflow for branch integration and stable semantic versions for releases.

## Contribution license and provenance

Outgroove's original source code is licensed under GPL-3.0-or-later. By
submitting a contribution, you agree that your contribution may be distributed
under that license and confirm that you have the right to submit it.

Do not submit copied code, generated assets, audio, artwork, fonts, or other
material unless its provenance and license allow redistribution under the
project's terms. Identify any incorporated third-party material in the pull
request and update `THIRD_PARTY_NOTICES.md` when required. Tests must use the
checked-in CC0 fixtures or newly generated redistributable fixtures in temporary
directories, never a real music library.

Never commit credentials, signing material, provider keys, personal databases,
unredacted diagnostic exports, real user paths, or private metadata. If you find
a security issue or exposed secret, follow [SECURITY.md](SECURITY.md) instead of
opening a public issue.

## Branches

- `main` contains release-ready history. Only `release/*` and `hotfix/*` pull requests merge into it.
- `develop` is the integration branch for the next release.
- `feature/<name>` branches start from and merge into `develop`.
- `release/<version>` branches start from `develop`, carry the version bump, merge into `main`, and are then merged back into `develop`.
- `hotfix/<version>` branches start from `main`, merge into `main`, and are then merged back into `develop`.

Do not commit directly to protected `main` or `develop` once branch protection is enabled. Use focused pull requests and merge commits (not squash merges) for release/hotfix back-merges so the branch topology remains visible. Feature pull requests may be squashed.

## Daily feature work

Start with a clean, current `develop` branch:

```sh
git switch develop
git pull --ff-only
npm run flow:feature -- scan-progress
```

Commit with a concise conventional prefix such as `feat:`, `fix:`, `test:`, `docs:`, `refactor:`, or `chore:`. Push the branch and open its pull request against `develop`.

## Versions and releases

`package.json` is the version source used by Electron Forge. `package-lock.json` must match it, and `npm run version:check` enforces that invariant. Versions use stable [Semantic Versioning](https://semver.org/):

- patch (`0.1.1`) for compatible bug fixes;
- minor (`0.2.0`) for compatible features;
- major (`1.0.0`) for incompatible product/data/API changes.

Pre-1.0 releases may still contain product changes, but migrations and user-data compatibility must be treated deliberately.

To prepare a normal release:

```sh
git switch develop
git pull --ff-only
npm run flow:release -- 0.2.0
git add package.json package-lock.json
git commit -m "chore(release): 0.2.0"
```

Finish release notes and validation on that branch, then open a pull request to `main`. After it merges:

```sh
git switch main
git pull --ff-only
npm run release:tag
git push origin v0.2.0
```

`release:tag` refuses a dirty/non-main worktree, checks version synchronization, runs the full verification suite, and creates an annotated local tag. Pushing the tag is intentionally separate. Merge `main` back into `develop` afterward through a pull request.

Pushing a stable `vX.Y.Z` tag starts the release workflow. It independently
verifies and packages macOS arm64, Windows x64, and Linux x64, then publishes
the signed/notarized macOS DMG, Windows and Linux ZIPs, Windows Setup
application, and SHA-256 checksums as a GitHub prerelease. The release is
published only after every platform build succeeds.

Use the [release runbook](docs/release-runbook.md) for the complete release
checklist and for the only authorized manual fallback when GitHub Actions jobs
cannot start because of the known budget restriction. It includes the native
Windows verification/manual-inspection handoff and direct upload, Linux x64
container verification, checksum and remote-asset audit, honest CI reporting,
and mandatory `main` → `develop` back-merge and branch cleanup.

For an urgent production fix, replace the start command with:

```sh
git switch main
git pull --ff-only
npm run flow:hotfix -- 0.1.1
```

The remaining version commit, main pull request, tag, and develop back-merge steps are the same.

## Repository settings

Protect both long-lived branches:

- require pull requests and the `Verify, package, and smoke (Linux)` CI check;
- block force pushes and deletion;
- require branches to be current before merging;
- restrict `main` pull requests to the Gitflow policy enforced by CI;
- use merge commits for release/hotfix PRs and the `main` back-merge.

The ordinary CI workflow runs on `pull_request` with read-only repository
permission and does not receive release secrets from fork pull requests. Never
change it to `pull_request_target` or add secrets to that workflow merely to
make an external contribution pass. Tagged releases remain the only workflow
that uses signing or provider credentials.

Tagged macOS builds require the Developer ID certificate and App Store Connect
Team API-key secrets documented in
[the macOS signing guide](docs/macos-signing.md). Missing credentials fail the
macOS job instead of publishing an unsigned substitute. Windows artifacts
remain unsigned, and prerelease publication does not by itself claim full
production support.
