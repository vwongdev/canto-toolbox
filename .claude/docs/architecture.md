# Architecture Overview

## Project Structure

The source is organised by feature domain, not by file type.

```
canto-toolbox/
├── manifest.json              # Chrome extension manifest (Manifest V3)
├── vite.config.ts             # Vite build configuration
├── vitest.config.ts           # Unit-test (vitest) configuration
├── playwright.config.ts       # E2E (Playwright) configuration
├── eslint.config.js           # Flat ESLint config (typescript-eslint)
├── tsconfig.json              # TypeScript configuration
├── flake.nix                  # Nix dev shell (Node 24 + pnpm)
├── .envrc                     # `use flake` — direnv loads the dev shell
├── .husky/                    # pre-commit (lint/typecheck/test), commit-msg
├── src/
│   ├── service-worker.ts      # MV3 service-worker entry; registers handlers
│   ├── popup/                 # Hover-popup feature (content script)
│   │   ├── content.ts         # Injected content script; hover/selection detection
│   │   ├── background-handler.ts # lookup_word / track_word message handler
│   │   ├── popup-client.ts    # Typed client wrapper over sendMessage
│   │   ├── popup-storage.ts   # Statistics write path (debounced, bounded)
│   │   └── popup.scss
│   ├── stats/                 # Statistics page
│   │   ├── stats.ts / stats.html / stats.scss
│   │   ├── stats-view.ts      # DOM rendering; element ids live here
│   │   ├── background-handler.ts # get_statistics handler
│   │   ├── stats-client.ts
│   │   ├── overview.ts        # Due/accuracy summary over the whole record
│   │   ├── ordering.ts        # List sorting and frequency-band filtering
│   │   └── stats-storage.ts   # Statistics read path (sync+local merge)
│   ├── flashcards/            # Flashcard review page
│   │   ├── flashcards.ts / flashcards.html / flashcards.scss
│   │   ├── flashcards-view.ts # Screens, card faces, element ids
│   │   ├── session.ts         # Card selection across the review directions
│   │   ├── writing.ts         # Stroke-order quiz and the grade it measures
│   │   ├── background-handler.ts # update_flashcard / set_word_status
│   │   └── flashcard-client.ts
│   ├── ocr/                   # Reading Chinese out of images and video frames
│   │   ├── media-controller.ts # Media hover, the badge, overlay lifecycle
│   │   ├── capture.ts         # Video frame → pixels, canvas or tab screenshot
│   │   ├── overlay.ts         # Recognised box → positioned transparent text
│   │   ├── engine.ts          # PaddleOCR over onnxruntime-web, models on disk
│   │   ├── offscreen.ts       # Engine cache and queue; loaded lazily
│   │   ├── background-handler.ts # ocr_image / capture_tab; forwards to the host
│   │   ├── ocr-client.ts
│   │   └── ocr.scss
│   ├── dictionary/
│   │   ├── dictionary.ts      # Runtime dictionary load + lookup
│   │   └── offscreen-handler.ts # dict_lookup; the maps live in this document
│   ├── offscreen/             # Offscreen composition root (dicts + OCR)
│   │   ├── offscreen.html
│   │   └── offscreen.ts       # register() of dictionary and OCR handlers
│   ├── shared/                # Cross-feature utilities and UI components
│   │   ├── message-manager.ts # sendMessage() typed message helper
│   │   ├── message-router.ts  # registerHandlers() onMessage routing
│   │   ├── offscreen-document.ts # ensureOffscreenDocument(); one host
│   │   ├── storage-manager.ts # Thin chrome.storage wrapper
│   │   ├── redundant-store.ts # sync/local reconciliation policy
│   │   ├── statistics-store.ts# The shared statistics key, cap and store
│   │   ├── statistics-utils.ts# mergeStatistics(), getFlashcardStage()
│   │   ├── scheduler.ts       # FSRS review scheduling
│   │   ├── bounded-map.ts     # Top-N-by-sort-key map
│   │   ├── debounce.ts        # createBatchedDebounce()
│   │   ├── dom-element.ts     # createElement()
│   │   ├── strokes.ts         # Packaged stroke graphics, one file per character
│   │   ├── frequency.ts       # Corpus rank → learner-facing band
│   │   ├── frequency-badge.ts # The band/rank chip on a definition
│   │   ├── decomposition.ts   # Component glyphs of an IDS decomposition
│   │   ├── definition-list.ts # Collapsing sense list
│   │   ├── pronunciation-section.ts # Pronunciation section component
│   │   ├── speech.ts          # Browser TTS, per-reading voice matching
│   │   ├── etymology-section.ts     # Etymology section component
│   │   ├── definition-section.ts    # Shared definition-container component
│   │   ├── context-sentence.ts      # Met-in sentence, plain or cloze-blanked
│   │   ├── gloss.ts           # Short English gloss for a production prompt
│   │   ├── pinyin.ts          # toSyllables() tone-tagged syllable split
│   │   ├── styles/            # Shared SCSS partials (tokens, dark mode, …)
│   │   └── types.ts           # TypeScript type definitions
│   └── vite-env.d.ts
├── public/
│   ├── data/                  # radicals.json (checked in);
│   │                          # mandarin/cantonese/etymology/frequency.json
│   │                          # (generated)
│   ├── strokes/               # One file per character + index.json (generated)
│   └── ocr/                   # PP-OCRv6 tiny + the ONNX runtime (generated)
├── build-tools/               # Build-time dictionary processing
│   ├── build-dictionaries.ts  # Dictionary build entry
│   ├── build-strokes.ts       # Splits graphics.txt into per-character files
│   ├── fetch-ocr-assets.ts    # Vendors the OCR models and ONNX runtime
│   ├── benchmark.ts / generate-screenshots.ts
│   └── processors/            # cedict-parser, mandarin/cantonese/etymology,
│                              # frequency, utils (+ __tests__/)
├── dictionaries/              # Source data (submodules)
│   ├── mandarin/              # CC-CEDICT
│   ├── cantonese/             # CC-Canto
│   └── makemeahanzi/          # Character etymology
├── e2e/                       # Playwright specs
├── icons/
└── .claude/
    ├── agents/                # dict-inspector, doc-reviewer, domain-reviewer
    └── docs/                  # Project documentation (this file lives here)
        ├── architecture.md
        ├── dev-workflow.md
        ├── git-conventions.md
        └── testing.md
```

## Architecture Flow

```mermaid
flowchart TD
    I[Image on the page] -->|badge click: ocr_image| C
    C -->|ocr_run| O[Offscreen document]
    O -->|PaddleOCR over onnxruntime-web| P[Packaged models]
    O -->|lines and boxes| N[Transparent text overlay]
    N -.->|becomes ordinary hoverable text| A
    A[Web Page] -->|mousemove / selection| B[Content Script]
    B -->|sendMessage lookup_word| C[Service Worker]
    C -->|registerHandlers| H1[popup background-handler]
    H1 -->|dict_lookup| O
    O -->|dictionary.ts| D[Parsed maps]
    D -->|fetch chrome.runtime.getURL data/*.json| E[Packaged JSON]
    O -->|DefinitionResult| H1
    H1 -->|response| B
    H1 -->|updateStatistics| F[RedundantStore: local + sync]
    G[Stats / Flashcards Page] -->|get_statistics| C
    G -->|flashcards only: fetch strokes/<char>.json| S[Packaged stroke graphics]
    H1 -->|hasStrokes: strokes/index.json| S
    C -->|stats background-handler| F
    F -->|mergeStatistics| G
    G -->|update_flashcard / set_word_status| C
    C -->|flashcards background-handler| H2[reviewCard per direction]
    H2 --> F
```

## Components

### Content Script (`src/popup/content.ts`)

- **Purpose**: Detect Chinese text under the cursor / in a selection and show a popup.
- **Key class**: `ChineseHoverPopupManager` — popup display and selection logic.
- **Responsibilities**: inject styles; listen for `mousemove`/`mouseout`/`mouseup`
  (throttled on the animation frame alone, cancelled on `destroy()`); skip
  hit-testing replaced elements that cannot hold a caret; ignore lookup
  replies for a word the cursor has already left; detect Chinese with
  `[一-鿿]+`; take the whole run at the caret
  (`document.caretRangeFromPoint`, with a realm-safe `nodeType` check so
  frames work) and send it with the hovered offset, leaving segmentation to
  the dictionary; request a lookup via `popup-client` (`sendMessage`); render
  the popup with the shared section components.
- **Asking, not passing**: a word is looked up only once the cursor has rested
  on it for `HOVER_INTENT_MS`. Hovering is how a reader crosses a page as well
  as how they ask about a word, and without the pause every word passed over
  opened a popup. Leaving the word then starts a short grace period rather than
  hiding at once — the popup is offset from the cursor, so reaching its audio or
  **+ Study** button means crossing text that is not the word. Hovering the
  popup cancels both the pending hide *and* any pending lookup, so words crossed
  on the way to it neither dismiss the popup nor replace the word it shows.
- **Study signal**: showing a popup is not studying. After `DWELL_MS` with the
  popup still on the same word, the script sends `track_word` — once per word,
  along with `extractContext`'s snippet of the sentence it was met in. The
  popup's **+ Study** button sends the same message at once, with `pin` set.
- **Following a component**: a chip in the character breakdown whose glyph the
  dictionaries hold an entry for is a button, and pressing it puts that entry
  in the popup with a back control to the word it came from. The trail is the
  popup's alone — a fresh hover starts a new one — and the definitions on it
  are the ones already fetched, so stepping back costs no lookup. Only the
  popup passes `onFollowComponent`; the stats and flashcard surfaces render the
  same breakdown with its chips as labels.

### Service Worker (`src/service-worker.ts`)

- **Purpose**: MV3 background entry point. It does not contain handler logic
  itself — it imports each feature's `background-handler.ts` and calls their
  `register()` to attach `chrome.runtime.onMessage` listeners.

### Background Handlers (`*/background-handler.ts`)

- Each handler registers through `registerHandlers()`
  (`src/shared/message-router.ts`), which owns the parts every listener would
  otherwise repeat: the async response channel (`return true`), passing an
  unrecognised message through (`return false`) so another feature's listener
  can answer it, and turning a thrown error into an `ErrorResponse`.
- **popup**: handles `lookup_word` and `track_word` (the only path that writes
  new statistics). Lookups are forwarded as `dict_lookup` to the offscreen
  document that holds the parsed maps. A tracked word also records what the
  dictionary knows about it — its corpus rank, whether it is a single character
  with named parts, and whether the stroke data covers it — since the pages
  that build sessions cannot look any of them up. Stroke coverage and
  decomposability are asked separately: a character can have strokes without
  its etymology naming any parts.
- **stats**: handles `get_statistics` (reads merged sync+local statistics).
- **flashcards**: handles `update_flashcard` (advances one direction's FSRS
  state, and buries a word once its lapses reach `LEECH_LAPSES`) and
  `set_word_status` (retire or pin a word, keeping its progress).
- Message passing is plain functions, not a class. The typed send helper is
  `sendMessage()` in `src/shared/message-manager.ts`; each feature has a thin
  `*-client.ts` wrapper around it.

### Dictionary (`src/dictionary/dictionary.ts`)

- **Purpose**: Load and search the dictionaries.
- **Where it runs**: the offscreen document (`src/offscreen/`), via
  `offscreen-handler.ts`. The service worker is torn down on idle, which would
  discard the parsed maps between one hover and the next; Chrome allows only
  one offscreen document, so dictionaries share the host already used for OCR.
  The worker's `lookup_word` handler starts that document (if needed) and
  forwards. The OCR engine is imported only when an image is read, so a hover
  does not pay for the model.
- **Loading**: `initDictionaries()` lazily `fetch`es
  `chrome.runtime.getURL('data/{mandarin,cantonese,etymology,frequency}.json')`
  (the JSON is a packaged `web_accessible_resource`, **not** statically
  imported/bundled) and parses it **once**. Mandarin and Cantonese arrive as a
  compact `rows`+`index` form so each unique entry is stored once; both script
  forms share a row. Etymology and frequency stay keyed maps.
- **Lookup**: after the one-time async load, `lookupWord` is synchronous —
  longest-match over up to `MAX_WORD_LENGTH`, Cantonese-marker filtering, and
  `lookupEtymology` for character breakdown.
- **Enrichment**: the longest-match scan tries a candidate per length and start
  offset and throws away all but one, so the parts not needed to judge a
  candidate — the character breakdown and the corpus rank — are added by
  `enrich` to the winner alone. `lookupEtymology` memoises into a capped cache,
  since the same characters recur as the cursor moves. The breakdown also
  carries `componentsWithEntries` — the parts that are words in their own right —
  because only the document holding the maps can say which components are
  worth following.

### Media OCR (`src/ocr/`)

- **Purpose**: make Chinese baked into a picture — an image, or the frame a
  video is paused on — readable by everything that already reads Chinese on
  the page. It is a text *source*, not a second lookup path: `overlay.ts` turns
  recognised boxes into transparent, positioned text nodes, and from there the
  content script's own `caretRangeFromPoint` handling finds them exactly as it
  finds text the page wrote itself. `ChineseHoverPopupManager`, `dictionary/`,
  `stats/` and `flashcards/` do not know pictures exist; the one wire between
  the two is `content.ts` starting `mediaOcrManager` alongside `popupManager`,
  since both run in the content script and one entry point has to bootstrap
  the other.
- **Trigger**: `media-controller.ts` shows a badge on hovering an image or
  video at least `MIN_MEDIA_SIDE_PX` on both sides; clicking it reads it. The
  model loads on the first click, never on page load. A video is only offered
  **while paused** — a frame the reader is still watching is one they have
  already left, and the badge would fight the player's own controls for the
  same corner. What is on offer is reconsidered on `play` and `pause` as well
  as on hover, since every way a reader pauses (space, `k`, a click on the
  picture) leaves the cursor where it was and fires no pointer event.
- **Following playback**: once a frame is read, `play` clears the overlay (text
  read off one frame is wrong for every frame after it) while `pause` and
  `seeked` read the new frame, so stepping between subtitles needs no further
  clicks. A pause on the frame already read is ignored.
- **Capturing a frame** (`capture.ts`): drawing the element is tried first —
  free, no permission, and it yields the video's own resolution. On a 1080p
  stream in an 822px-wide player that is over twice the linear resolution a
  screenshot of the tab would give, which is most of the difference between
  reading subtitles and guessing at them. Media-Source video (what every
  streaming player uses, YouTube included) is fed by the page itself and so is
  *not* tainted, which is why this works where re-fetching a URL cannot. Only a
  `SecurityError` falls back to `chrome.tabs.captureVisibleTab`, which sees
  composited pixels and is blind to nothing but DRM; the crop back to the
  video's rect derives its scale from the screenshot rather than trusting
  `devicePixelRatio`, which lies on a zoomed page.
- Note that **captions a site renders as DOM text need none of this** — the
  popup already reads them. YouTube's own captions are `<span>` text nodes, so
  OCR is only for subtitles burned into the picture.
- **Where it runs**: the shared offscreen document (`src/offscreen/offscreen.html`).
  The service worker has no DOM and is torn down on idle, which would discard
  the loaded weights between one image and the next; `ensureOffscreenDocument()`
  (`src/shared/offscreen-document.ts`) starts the document and the worker
  forwards. `src/ocr/offscreen.ts` serialises requests behind one queue — a
  single inference session cannot usefully be contended for — and caches
  results by image URL in a `BoundedMap`. A `data:` source is never cached: the
  key would be the whole picture, megabytes of string per entry, and a hit
  would need byte-identical pixels twice, which a video frame never produces.
  The engine module is dynamically
  imported on the first `ocr_run`, so hosting dictionaries in the same
  document does not load the model on hover.
- **Engine**: `engine.ts` runs PP-OCRv6 tiny through `ppu-paddle-ocr/web` over
  `onnxruntime-web`. Models and the runtime are fetched from
  `chrome.runtime.getURL('ocr/…')`, so no network access is involved. It must
  *overwrite* `ort.env.wasm.wasmPaths` rather than fill it in, since the
  library points it at a CDN from its own module body.
- **Placement**: `overlay.ts` puts the *i*th character in the *i*th slot of its
  box rather than reproducing the image's typography — that is what the caret
  needs. For Chinese it is exact, since every glyph is full width. Overlays
  live in the body and are positioned in page coordinates, so an ancestor's
  `overflow` or stacking context cannot clip them, and they are re-laid from
  the held result when a responsive page redraws the image at a new size.
- The badge carries no text. A label legible enough to mean "read this" would
  have to be Chinese, and Chinese on the page is something the popup looks up.

### Statistics Page (`src/stats/`)

- **Key class**: `StatsManager` (`stats.ts`) — data loading and event wiring.
  All DOM construction lives in `stats-view.ts`, which also owns the element
  ids the page's HTML and its tests share.
- Renders the frequency list with lazily-expanded definitions (rendered by the
  shared `definition-section`), the sentence each word was met in, study
  counts, and a clear action.
- Above the list, `overview.ts` summarises the whole record — cards due now,
  due today, review accuracy and retired count — deliberately unaffected by the
  list's own filters. `ordering.ts` supplies the frequency-band filter and the
  sort (most studied, most common, due soonest, recently seen).
- Each row can retire a word or pin it for study, through `set_word_status`.
- **Retired words are left out of the list** unless the **Show retired** pill is
  pressed — the one filter that is on by default, since a retired word was taken
  out of the deck deliberately. The stage and band counts follow it, so a pill
  never promises rows the list will not show; the retired pill's own count
  always reports the whole retired set, because it says what pressing it would
  reveal. With the pill pressed, each retired row carries its own **Retired**
  badge beside the stage badge — retirement is not a stage, and the only other
  sign of it was a button inside the row's own panel.
- The **Candidates** stage pill is where words enter the deck by hand: it holds
  every word seen too rarely to have enrolled itself, ranked by the default
  "most studied" sort, so the ones nearest the threshold are the ones offered
  first and each row's **Study this** is one click.

### Flashcards Page (`src/flashcards/`)

- Spaced review driven by `src/shared/scheduler.ts` (FSRS). Each word carries a
  schedule per **review direction**: `recognition` (word → meaning, stored under
  the original `flashcard` key), `production` (meaning + cloze sentence → word),
  `components` (character → its parts) and `writing` (character → its stroke
  order). Production unlocks once recognition leaves its learning steps;
  components additionally needs `decomposable` and writing needs `writable`,
  both recorded at track time because this page has no dictionary.
- `flashcards.ts` runs the session; `flashcards-view.ts` renders the screens and
  card faces and owns the element ids.
- `selectSession` (`session.ts`) takes the cards the scheduler says are due,
  most overdue first, then tops the session up with cards not yet introduced —
  ordered by corpus rank, so the commonest word met is taught first — capped at
  `MAX_NEW_CARDS` within `MAX_CARDS`. A word offers **at most one card per
  session**, and retired words are skipped. With nothing due, the empty screen
  reports when the next review lands.
- A word joins the deck only once `isEnrolled` says so — pressed **+ Study**, or
  met `MIN_COUNT` times. Hovering still records every word; what it no longer
  does is spend a session slot on one. The threshold gates the *first* card a
  word is offered, so raising it never evicts a word already being reviewed.
- The **writing card grades itself** (`writing.ts`): hanzi-writer draws the
  character's outline and counts how many strokes went in the wrong place, and
  that count picks the grade — none is Good, one or two is Hard, three or more
  is Again. It is the one card with no rating buttons, so the quiz has to be
  able to end on its own: a stroke missed five times is marked correct and the
  quiz moves on, or the reader would have nothing to press past. "Easy" is never
  awarded, since the reader has no way to disagree with a measured grade. The
  outline is deliberately shown — this card tests the *order* of the strokes,
  and withholding the character would make it a recall card the deck has two of
  already.
- "Again" re-queues a card within the session, but the scheduler hears each card
  **once per session**: a requeued answer or a "Review Again" round is a drill,
  and rating it again would have FSRS recompute stability over an interval of
  roughly zero. "I know this" (or `K`) retires the word outright.
- Definitions render via the shared `definition-section`; only the production
  front needs a lookup before the question can be posed.

## Data Flow

0. **Image text (optional)** — clicking an image's badge sends `ocr_image`;
   the offscreen document reads it and replies with lines and boxes, which the
   content script lays over the image as transparent text. Every step below
   then applies to it unchanged.
1. **Hover/selection** — content script extracts the Chinese word and calls
   `sendMessage({ type: 'lookup_word', word })`.
2. **Lookup** — popup `background-handler` forwards `dict_lookup` to the
   offscreen document, which awaits `initDictionaries()`, calls `lookupWord`
   (or `lookupWordAt` when a hovered segment is supplied), and replies with a
   `DefinitionResult`. The worker maps that back onto `lookup_word`.
3. **Display** — content script renders the popup near the cursor.
4. **Statistics** — a `track_word` (sent after the reader dwells on a word, or
   at once when they press Study in the popup) increments its count through
   `RedundantStore` (transform the reconciled record, write both areas) and
   records the sentence it was first met in, its corpus rank, and whether it can
   carry a components or a writing card. The stats/flashcards pages read both
   areas and reconcile with `mergeStatistics`, which preserves every field a
   word carries rather than the handful the merge names.

## Storage

- **Statistics**: one storage item, `STATISTICS_KEY`, held in a `RedundantStore`
  over `StorageManager(chrome.storage.sync, chrome.storage.local)`. The key, the
  store and the `MAX_TRACKED_WORDS` cap live in `src/shared/statistics-store.ts`
  so the write path, the stats page's warning and the flashcard handler all
  address the same record. Reads reconcile both areas via `mergeStatistics`,
  and so do writes: a `mutate` transforms what a read would have seen and writes
  the result to both. **`chrome.storage.sync` rejects any item over 8 KB**,
  which this record passes at a few dozen studied words, so past that point sync
  keeps a fossil and local holds the truth — which is why local is written first
  and why a merge lets it decide a word's retired and chosen flags. Transforming
  sync alone silently dropped every retirement and every rating for a word sync
  no longer held.
- **Write batching**: `popup-storage.ts` accumulates counts with
  `createBatchedDebounce` and writes them through a `BoundedMap` capped at
  `MAX_TRACKED_WORDS`. Eviction is tiered rather than by study count alone —
  reviewed words (tie-broken by last review) outrank pinned, which outrank
  retired, which outrank the merely-seen — so pruning cannot throw away FSRS
  history.
- **Dictionaries**: generated JSON under `public/data/` (bundled as
  `web_accessible_resources`), fetched at runtime — never written.
- **Stroke graphics**: generated JSON under `public/strokes/`, one file per
  character plus an `index.json` of the characters covered. Split rather than
  kept in one map because a review session reads one character: the card in
  front of the reader costs ~3 KB, where a single 30 MB map would have to be
  parsed and held the way the dictionaries are. Not
  `web_accessible_resources` — only the worker and the flashcards page read
  them, and an extension page reaches its own files without them.
- **OCR assets**: the models and ONNX runtime under `public/ocr/`, fetched at
  runtime by the offscreen document. Not `web_accessible_resources`: an
  extension page reaches its own `chrome-extension://` files without them.

## Dependencies

- **TypeScript / Vite** — typed source, bundling (`vite build`, needs
  `--max-old-space-size`). `@crxjs/vite-plugin` drives the build from
  `manifest.json`.
- **Vitest / Playwright** — unit and e2e tests.
- **ESLint / husky** — `eslint.config.js` (flat config, typescript-eslint); the
  `pre-commit` hook runs lint, typecheck and tests, and `commit-msg` enforces
  the commit format.
- **ts-fsrs** — the FSRS review scheduler; the four ratings the review UI
  offers are its grade scale exactly.
- **hanzi-writer** — the stroke-order quiz on the flashcard page. It is given a
  `charDataLoader` that reads `public/strokes/`, so its own CDN loader is never
  reached for; its character JSON is makemeahanzi's shape already, which is why
  the packaged data passes through untouched.
- **ppu-paddle-ocr / onnxruntime-web** — the image OCR engine. `vite.config.ts`
  aliases `onnxruntime-web` to its extern-wasm entry, which both keeps Rollup
  from emitting the 14 MB and 28 MB binaries alongside the copy already
  vendored, and collapses the library and `engine.ts` onto one ORT instance so
  `ort.env` settings apply to the instance that reads them.
- **Chrome Extension APIs** — `chrome.storage.sync|local` (statistics),
  `chrome.runtime` (message passing, `getURL`, `getContexts`),
  `chrome.offscreen` (the offscreen document that holds dictionaries and OCR).
- **Dictionary submodules** — `dictionaries/mandarin` (CC-CEDICT),
  `dictionaries/cantonese` (CC-Canto), `dictionaries/makemeahanzi` (etymology).
- **build-tools/processors** — convert the raw submodule data into the unified
  JSON written to `public/data/` (deterministic, key-sorted output).
- **chinese-lexicon** (dev only) — carries the SUBTLEX-CH word-frequency data
  the frequency processor reads. Unlike the dictionaries it is an npm
  devDependency rather than a submodule, since only the build reads it and
  nothing of the package ships; the emitted `frequency.json` is ~290 KB.

## Extension Permissions

- `storage` — statistics tracking.
- `offscreen` — the document that holds the parsed dictionaries and the OCR engine.
- `host_permissions: ["<all_urls>"]` — lets the offscreen document fetch an
  image's bytes, and lets the worker screenshot the visible tab for a video
  frame a canvas may not read. Reading image bytes in the content script
  instead is not an option: a cross-origin image taints a canvas. This adds no
  install warning the extension did not already carry, since the content script
  is declared statically with `<all_urls>` and asks for the same access.
- The content script is declared statically in `manifest.json`; there is no
  `scripting` or `activeTab` permission.
- `content_security_policy.extension_pages` allows `'wasm-unsafe-eval'`, which
  an extension page needs to instantiate the OCR runtime's WebAssembly.

## Dictionary Sources

- **CC-CEDICT** — Mandarin–English with Pinyin.
- **CC-Canto** — Cantonese–English with Jyutping (including entries with empty
  pinyin brackets, which the parser preserves).
- **makemeahanzi** — character decomposition / etymology.
- **SUBTLEX-CH** — word frequency from film subtitles (Cai & Brysbaert, 2010),
  read from the `chinese-lexicon` devDependency. Capped at the 20,000
  commonest words: past that, the difference between two ranks is "both rare".
  The package also exposes an HSK helper, but it *estimates* a level from
  character difficulty for words off the official list, so it is not used.

Processed at build time into unified JSON under `public/data/`. Mandarin and
Cantonese entries are stored once and indexed under **both** the simplified
and the traditional form, so a lookup finds a word whichever script the page
is written in.

## OCR Model

- **PP-OCRv6 tiny** — one unified detection/recognition pair covering
  Simplified and Traditional Chinese, ~6.4 MB, vendored by
  `build-tools/fetch-ocr-assets.ts` with pinned SHA-256 digests. Its 6,174
  character dictionary reads every one of the 5,000 commonest SUBTLEX-CH words
  and 99.86% of the 20,000 the frequency data is capped at; the next tier up
  costs 25 MB to gain only words the extension already bands as rare.
- Tesseract is the obvious alternative and was rejected: it is tuned for
  scanned documents, and this feature targets screenshots, panels and signage.

## Key Classes and Utilities

- **`ChineseHoverPopupManager`** (`src/popup/content.ts`) — popup/selection logic.
- **`StatsManager`** (`src/stats/stats.ts`) — stats page data loading and wiring.
- **`sendMessage`** (`src/shared/message-manager.ts`) — typed message-passing
  helper with `chrome.runtime.lastError` / validation handling.
- **`registerHandlers`** (`src/shared/message-router.ts`) — typed `onMessage`
  routing; owns the async response channel, the pass-through for messages a
  feature does not handle, and error→`ErrorResponse` conversion.
- **`ensureOffscreenDocument`** (`src/shared/offscreen-document.ts`) — the one
  offscreen host; popup and OCR both start it and forward.
- **`RedundantStore`** (`src/shared/redundant-store.ts`) — sync/local
  reconciliation policy over `StorageManager`. Reads and writes both go through
  the caller's reconcile; `mutate` writes local first, then sync best-effort.
- **`statisticsStore` / `STATISTICS_KEY` / `MAX_TRACKED_WORDS`**
  (`src/shared/statistics-store.ts`) — the single record every feature addresses.
- **`mergeStatistics` / `reconcileStatistics`**
  (`src/shared/statistics-utils.ts`) — the record as both storage areas hold it.
  Each area is a snapshot of the whole record rather than a share of it, so
  counts take the higher of the two and local decides a word's retired and
  chosen flags; reads and writes reconcile through the same function.
- **`MIN_COUNT` / `isEnrolled`** (`src/shared/statistics-utils.ts`) — whether a
  word is in the deck at all. Tracking a word and drilling it are separate:
  hovering records everything, enrolment needs Study or `MIN_COUNT` sightings.
- **`getFlashcardStage`** (`src/shared/statistics-utils.ts`) — candidate / new /
  learning / familiar / mastered, derived from the scheduler so `mastered`
  decays. `candidate` is seen-but-not-enrolled, which the stats page filters to.
- **`reviewCard` / `isDue` / `isLeech`** (`src/shared/scheduler.ts`) — FSRS
  scheduling, persisted as the compact `SrsState` on each direction's progress.
- **`progressFor` / `DIRECTION_FIELD` / `schedulesOf`**
  (`src/shared/statistics-utils.ts`) — where each review direction's schedule
  lives on a word, and the shared walk over all three.
- **`selectSession`** (`src/flashcards/session.ts`) — which card each word
  offers a session, and in what order.
- **`ratingForMistakes` / `startQuiz`** (`src/flashcards/writing.ts`) — the
  stroke-order quiz, and the grade its mistake count measures.
- **`hasStrokes` / `loadStrokes`** (`src/shared/strokes.ts`) — whether a
  character has packaged stroke graphics, and fetching the one file that holds
  them.
- **`BoundedMap`** (`src/shared/bounded-map.ts`) — top-N-by-sort-key map;
  `setAll` inserts a batch and prunes once, so a batch of new words is ranked
  against the record one time rather than after each word in it.
- **`createBatchedDebounce`** (`src/shared/debounce.ts`) — accumulates keyed
  counts and flushes a batch.
- **`createElement`** (`src/shared/dom-element.ts`) — DOM creation helper.
- **`placeItem` / `placeResult` / `createOverlay`** (`src/ocr/overlay.ts`) — a
  recognised box in the image's own pixels turned into a transparent text node
  the caret can land in, at whatever size the page draws the image.
- **`captureFrame` / `captureSize`** (`src/ocr/capture.ts`) — the current video
  frame as a `data:` URL, drawn from the element where that is allowed and cut
  out of a tab screenshot where it is not.
- **`recognise`** (`src/ocr/engine.ts`) — image URL → text with boxes, over the
  packaged PP-OCRv6 model.
- **`dictionary.ts`** — `initDictionaries`, `lookupWord`, `lookupWordAt`,
  `lookupEtymology`, `lookupFrequency`.
- **`bandForRank` / `BAND_LABELS`** (`src/shared/frequency.ts`) — a corpus rank
  banded into something a learner can act on (Core 1000 → Rare);
  `frequency-badge.ts` draws it on the definition.
- **`parseComponents`** (`src/shared/decomposition.ts`) — the component glyphs
  of a makemeahanzi decomposition, Ideographic Description Characters dropped.
- **`pronunciation-section.ts` / `etymology-section.ts` /
  `definition-section.ts` / `definition-list.ts`** — shared UI components;
  `definition-section` composes the others and is reused by popup, stats and
  flashcards. Because they are shared, the audio button, tone colours, script
  variant and the collapsing sense list appear on all three surfaces from one
  implementation.
- **`toSyllables`** (`src/shared/pinyin.ts`) — splits a romanisation into
  tone-tagged syllables so each can be coloured; Pinyin gets tone marks,
  Jyutping keeps its digits.
- **`speech.ts`** — `canSpeak` / `speak` over the browser's speech synthesis.
  Voice matching is strict per reading: Cantonese never falls back to a
  Mandarin voice, since the wrong pronunciation is worse than none.
