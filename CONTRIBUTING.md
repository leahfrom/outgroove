# Contributing to Outgroove

Read `AGENTS.md` and the relevant parts of `PLAN.md` before changing product behavior. Outgroove uses Gitflow for branch integration and stable semantic versions for releases.

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

For an urgent production fix, replace the start command with:

```sh
git switch main
git pull --ff-only
npm run flow:hotfix -- 0.1.1
```

The remaining version commit, main pull request, tag, and develop back-merge steps are the same.

## Repository settings

On the private GitHub repository, protect both long-lived branches:

- require pull requests and the `verify-and-package` CI check;
- block force pushes and deletion;
- require branches to be current before merging;
- restrict `main` pull requests to the Gitflow policy enforced by CI;
- use merge commits for release/hotfix PRs and the `main` back-merge.

Signing, notarization, installer publication, and automatic GitHub releases are not enabled yet. A SemVer tag identifies reviewed source; it does not claim an artifact is signed or production-supported.
