# Dev Workflow

## Prerequisites

The repo includes a `flake.nix` and a checked-in `.envrc` (`use flake`). With
Nix and [direnv](https://direnv.net/) installed, approve the environment once:

```sh
direnv allow
```

Every shell entering the repo then has the correct Node.js and pnpm versions on
`PATH` automatically — commands are run as `pnpm build`, not
`nix develop --command pnpm build`. No manual version management needed.

Without direnv, `nix develop` drops you into the same shell by hand, and
`nix develop --command <cmd>` runs a single command in it.

Without Nix, install manually:
- Node.js >= 22 (`engines` floor); the dev shell pins `nodejs_24` and CI uses 24
- pnpm >= 8 (use `pnpm@8.15.0` as specified in `packageManager`)

Either way, initialize submodules before building:

```sh
git submodule update --init --recursive
```

## Build

The build is a four-phase pipeline:

```
build:scripts → build:dict → build:strokes → build:ocr → vite build
```

### Full build

```sh
pnpm build
```

This runs:
1. `tsc -p build-tools/tsconfig.json` — compiles build-tool scripts to `build-tools/dist/`
2. `node build-tools/dist/build-tools/build-dictionaries.js` — processes raw dictionary submodule data into `public/data/{mandarin,cantonese,etymology,frequency}.json`
3. `node build-tools/dist/build-tools/build-strokes.js` — splits `makemeahanzi/graphics.txt` into one file per character under `public/strokes/`
4. `node build-tools/dist/build-tools/fetch-ocr-assets.js` — downloads the pinned PP-OCRv6 tiny model and copies the ONNX runtime into `public/ocr/`
5. `vite build` — bundles the extension into `dist/` (requires `--max-old-space-size=8192` due to large dictionary imports)

Output goes to `dist/`. This directory is the unpacked Chrome extension, about
76 MB — 30 MB of stroke graphics, 27 MB of dictionaries and 20 MB of OCR
assets. It takes noticeably more than that on disk, because the stroke data is
9,574 files of roughly 3 KB each and every one rounds up to a block.

### Incremental builds

If you only changed extension source (`src/`), skip dictionary, stroke and OCR
asset processing:

```sh
NODE_OPTIONS=--max-old-space-size=8192 vite build
```

The OCR assets only need re-fetching when `fetch-ocr-assets.ts` changes or
`public/ocr/` has been cleaned — `pnpm build:ocr` re-verifies the digests of
what is already there and downloads nothing otherwise. `pnpm build:strokes`
behaves the same way: it compares the character count in
`public/strokes/index.json` against `graphics.txt` and does nothing when they
agree, so only a moved submodule or a `pnpm clean` pays for the split.

If you changed `build-tools/` but not dictionaries:

```sh
pnpm build:scripts && NODE_OPTIONS=--max-old-space-size=8192 vite build
```

### Clean

```sh
pnpm clean
```

Removes `dist/`, the generated JSON in `public/data/`, `public/ocr/`,
`public/strokes/`, and `build-tools/dist/`.

## Loading the Extension in Chrome

1. Run `pnpm build`
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** → select the `dist/` directory
5. The extension is now active — hover over Chinese text on any webpage to test

After code changes, rebuild and click the **reload** button on the extension card in `chrome://extensions`.

## Linting

```sh
pnpm lint
```

Runs ESLint (flat config in `eslint.config.js`, `typescript-eslint`) across
`src/` and `build-tools/`. Use `_`-prefixed parameter names to suppress
unused-arg warnings (e.g. `_event`).

## Type Checking

Run type checking without a full build:

```sh
pnpm typecheck
```

This runs `tsc --noEmit` against all source files in `src/` and `build-tools/`. Use this to verify changes quickly before committing — it's much faster than `pnpm build`.

## Testing

The extension has automated coverage. See `.claude/docs/testing.md` for the full
guide.

```sh
pnpm test       # Vitest unit/integration suite
pnpm test:e2e   # Playwright end-to-end (build the extension first)
```

Unit tests live in `__tests__/` directories beside their source. E2E specs are
in `e2e/`. CI runs both. Manual verification in Chrome is an optional sanity
check for UI-heavy changes (load the unpacked `dist/`, hover Chinese text, open
the Stats page).

## Commit Hooks

Husky installs two hooks (via the `prepare` script):

- **`pre-commit`** — runs `pnpm lint && pnpm typecheck && pnpm test`. It first
  checks that `pnpm` is on `PATH`, so committing from a shell that has not
  loaded the dev environment fails with a pointer to `nix develop` rather than a
  confusing error.
- **`commit-msg`** — validates the message against `type(domain): Description`.
  See `.claude/docs/git-conventions.md`.

## Dependency Updates

[Renovate](https://docs.renovatebot.com/) raises the update PRs, configured by
`renovate.json` in the repo root. It covers four sources:

- **npm** (`package.json` + `pnpm-lock.yaml`) — minor and patch devDependency
  bumps arrive grouped, majors and runtime dependencies one PR each. A weekly
  lock-file refresh picks up transitive updates nothing declares.
- **GitHub Actions** — the pinned action versions in `.github/workflows/`, as
  one grouped `ci(build)` PR.
- **Nix** (`flake.lock`) — the `nixpkgs` and `flake-utils` inputs, so the dev
  shell's Node does not drift from CI's.
- **Git submodules** — the three dictionary sources, monthly. This is a *data*
  update, not a dependency bump: the PR changes nothing in `src/`, and what it
  actually alters is the generated JSON, so the CI e2e job building the
  dictionaries is the only thing that checks it.

Renovate commits are shaped to pass `commit-msg`, since a squash merge keeps
the message: `chore(build):` for npm and Nix, `ci(build):` for Actions,
`chore(dict):` for the submodules. Renovate's own commits never run the husky
hooks — they are made server-side — so the format is a convention it is
configured to follow rather than one enforced on it.

## Benchmarking

```sh
pnpm bench
```

Compiles the build tools and runs `build-tools/benchmark.ts` against the
generated `public/data/*.json`, failing if p99 lookup time exceeds its
threshold. CI runs this as a separate `perf` job, so an algorithmic regression
in the lookup path is caught on every push.

### Screenshot generation

Used for release assets, not for testing:

```sh
pnpm screenshots
```

Requires a full build first and uses Puppeteer to capture the extension UI. The
release workflow runs it under `xvfb` when cutting a version.

## Key Build Gotchas

- **Dictionary submodules must be initialized** before `pnpm build:dict` will work. If `public/data/` holds only `radicals.json`, run `git submodule update --init --recursive`.
- **A raised memory limit may be needed** for the Vite build step, because the dictionary JSON files are large. `pnpm build` does *not* set it — CI passes `NODE_OPTIONS=--max-old-space-size=8192` explicitly, and so should a local build that runs out of heap.
- **`public/data/` is generated** — do not manually edit `mandarin.json`, `cantonese.json`, `etymology.json` or `frequency.json`. Changes belong in `build-tools/processors/`.
- **`public/ocr/` is generated too** — the models come from Hugging Face with pinned SHA-256 digests, so `pnpm build:ocr` needs network access the first time and fails loudly if a file has changed upstream. To move to a different model, update the URLs *and* the digests in `build-tools/fetch-ocr-assets.ts`.
- **`public/strokes/` is generated as well**, from the makemeahanzi submodule rather than the network. `build-strokes.ts` clears the directory before writing, so an interrupted run cannot leave characters the index promises but no file backs. Unlike `public/data/`, it is *not* a `web_accessible_resource`: only the service worker and the flashcards page read it, and both reach their own `chrome-extension://` files directly.
- **`graphics.txt` is Arphic Public Licensed**, not LGPL like the rest of the makemeahanzi submodule. The licence text is copied to `public/strokes/ARPHICPL.TXT` by the build because the licence requires it to travel with the data — do not drop it from the package.
- **Hugging Face rate-limits shared addresses**, which is why the fetch is sequential and retries 429/5xx with backoff, and why CI and the release workflow both restore `public/ocr/models` from an `actions/cache` keyed on the digests. A cache hit is byte-identical by construction, so changing a model changes the key. A 429 there says nothing about the build — it is the runner's neighbours.
- **`onnxruntime-web` is aliased in `vite.config.ts`** to its extern-wasm entry. Removing the alias makes Rollup emit two ORT binaries (14 MB and 28 MB) into `dist/assets/` alongside the copy in `public/ocr/`, and splits the runtime into two instances so `ort.env` settings stop reaching the one doing the work.
- **`build-tools/dist/` is also generated** — if build tool scripts behave unexpectedly, run `pnpm clean` and rebuild from scratch.
