---
name: release
description: Cut a release of the extension — derive the version bump from everything unreleased on main, then dispatch the release workflow. Use when asked to release, cut a version, ship, or publish the extension.
---

# Release

Releases are cut by dispatching `.github/workflows/release.yml`, never by hand.
The workflow owns the version bump, the tag, the screenshots and the published
zip; doing any of that locally leaves the repository disagreeing with the tag.

## 1. Check the preconditions

```sh
git status --short          # clean tree
git rev-parse --abbrev-ref HEAD   # main
git log --oneline origin/main..main   # empty
```

The workflow checks out `github.ref_name` and builds what is on the remote, so
anything unpushed is silently left out of the release. Push first, or stop and
say what is outstanding.

## 2. Derive the bump

The release ships **everything unreleased**, not the change just made. Work sits
on main between releases, so a session's own diff understates the bump whenever
someone else's feature is already waiting there.

```sh
git log --oneline "$(git describe --tags --abbrev=0)"..main
```

Take the highest-ranking commit type in that list:

| In the list | Bump | Example |
| --- | --- | --- |
| A breaking change | `major` | stored statistics a previous version cannot read |
| Any `feat` | `minor` | a new card direction, a new popup interaction |
| Only `fix` / `refactor` / `chore` / `ci` / `docs` / `ai` | `patch` | |

Confirm the level with the user before dispatching — a tag and a public GitHub
release are not quietly undone.

## 3. Dispatch

```sh
gh workflow run release.yml --ref main -f bump=<major|minor|patch>
gh run watch "$(gh run list --workflow=release.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

The run takes a while: it repeats the CI gates, builds 76 MB, benchmarks the
lookup path, runs the Playwright suite under `xvfb` and generates the store
screenshots before it tags anything. A failure before the tag step means nothing
was published and the dispatch can simply be repeated once the cause is fixed.

Report the run URL, and the version once the tag lands.

## What the workflow does itself

Do **not** do any of this by hand:

- bumps `package.json` and syncs the version into `manifest.json`
- regenerates `screenshots/` and commits them with the bump as
  `chore(global): Bump version to <version>`
- tags `v<version>`, pushes both, and creates the GitHub release with the zip

## Failure notes

- **A 429 from Hugging Face** on the OCR asset fetch is the runner's shared
  address being rate-limited, not a problem with the release. Re-dispatch.
- **A failed gate** (lint, typecheck, test, bench, e2e) is a real regression on
  main: fix it on main and dispatch again. The gates run before the build for
  exactly this reason.
