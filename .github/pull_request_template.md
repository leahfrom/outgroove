## Summary

<!-- What user-visible or architectural outcome does this change deliver? -->

## Verification

- [ ] `npm run verify`
- [ ] Relevant package/smoke/manual checks are listed below

## Safety review

- [ ] No source audio or target-deletion invariant was weakened
- [ ] Renderer/IPC/filesystem boundaries remain intact or have focused tests
- [ ] User data migrations and write failure paths were considered where relevant

## Gitflow

- [ ] `feature/*` targets `develop`
- [ ] Only `release/*` or `hotfix/*` targets `main`
- [ ] Release/hotfix changes are merged back to `develop`
- [ ] Release/hotfix platform evidence and assets follow `docs/release-runbook.md` (or not applicable)
