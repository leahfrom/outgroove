# Filesystem conformance procedure

This procedure collects narrow evidence for Outgroove's existing safe metadata
replacement and manifest-backed Sync paths. It is not a benchmark and does not
grant permission to scan, edit, or sync a real music library.

## Automated Windows locking evidence

`tests/platform/windows-locking.test.ts` runs only on Windows. A separate
PowerShell process opens the fixture with `System.IO.FileShare.None`, which
exercises Windows' real sharing and rename restrictions rather than simulating
an error in JavaScript.

The tests prove that:

- a locked MP3 source is not changed by a rejected metadata write;
- a locked, manifest-owned sync destination retains its prior bytes;
- the prior manifest is not advanced after the failed replacement; and
- the failure remains local to the affected operation.

This is CI evidence on the runner's native filesystem, not a manual packaged-app
or removable-volume result.

## Controlled exFAT probe

Use a freshly formatted or otherwise disposable exFAT card/folder. Back up any
content first. Confirm the exact mounted path using the operating system's disk
management tools; a mount path alone is not a durable device identity.

From a clean checkout with dependencies installed, run:

```sh
npm run test:exfat -- --target "/exact/absolute/mount/path" --confirm-disposable-exfat-probe
```

The probe refuses to run unless it detects exFAT. On macOS it resolves a
selected disposable subfolder to its actual volume root for read-only
filesystem detection while keeping all writes inside that selected subfolder.
It rejects relative paths, filesystem roots, duplicate flags, and unexpected
arguments, then creates one random `.outgroove-exfat-probe-*` directory under
the selected target. Inside that directory it:

1. copies the generated MP3 fixture, changes its album title through the real
   safe writer, re-reads it, and verifies the audio payload;
2. scans the generated fixture album and applies the real sync workflow;
3. verifies an exact manifest-owned replacement without changing its source;
4. previews the exact opt-in cleanup set, interrupts after a same-volume
   quarantine, reopens the database, confirms rollback recovery, and verifies
   the previous manifest and unknown target file stayed unchanged;
5. reapplies cleanup, verifies only the exact obsolete owned paths disappeared,
   verifies the final manifest and source hashes, and confirms persistent
   target identity stayed stable during the run; and
6. reports observed case, Unicode-normalization, timestamp, hard-link, and free
   space behavior.

The versioned JSON report contains counts, pass states, observed filesystem
behavior, and a SHA-256 digest of the sorted removal set. It contains no source,
target, quarantine, playlist, manifest, database, or fixture paths and no raw
volume identifier. The JSON object printed at the end is the platform evidence;
stderr and a non-zero exit indicate failure.

The normal automated suite runs the complete orchestration against a temporary
directory with only the filesystem-label detector substituted. That protects
the probe logic from regressions but is not exFAT evidence and must not update
the platform matrix.

The probe closes its temporary database and removes only its own random child
directory. If the process is forcibly interrupted, inspect the selected target
for a leftover `.outgroove-exfat-probe-*` directory before rerunning; do not
delete any other file.

Record the OS, architecture, physical media, reported JSON, and whether removal
completed. A failure is useful evidence and must not be converted into a passed
matrix entry. Do not mark another OS or another card/filesystem as verified by
inference. Stable identity during one run does not prove identity across
disconnect/remount; perform that observation separately and record it as manual
evidence.
