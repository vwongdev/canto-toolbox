# Project Structure

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
│   │   ├── background-handler.ts # lookup_word / track_word / mark_known / segment_text
│   │   ├── popup-client.ts    # Typed promise client over request()
│   │   ├── page-coverage.ts   # Unknown-word marks and the page coverage chip
│   │   ├── known-words.ts     # Page words joined with the record; known-set cache
│   │   ├── popup-storage.ts   # Statistics write path (debounced, bounded)
│   │   └── popup.scss
│   ├── stats/                 # Statistics page
│   │   ├── stats.ts / stats.html / stats.scss
│   │   ├── stats-view.ts      # DOM rendering; element ids live here
│   │   ├── background-handler.ts # get_statistics / get_review_log handler
│   │   ├── stats-client.ts
│   │   ├── overview.ts        # Due/accuracy summary over the whole record
│   │   ├── insights.ts        # Forecast, streak, retention, band coverage
│   │   ├── ordering.ts        # List sorting and frequency-band filtering
│   │   ├── backup.ts          # Backup file format, validation, merging restore
│   │   ├── card-export.ts     # Anki / Pleco text export of the deck
│   │   ├── transfer-controls.ts # Backup, restore and export buttons
│   │   └── stats-storage.ts   # Statistics read path (sync+local merge)
│   ├── flashcards/            # Flashcard review page
│   │   ├── flashcards.ts / flashcards.html / flashcards.scss
│   │   ├── flashcards-view.ts # Screens, card faces, element ids
│   │   ├── session.ts         # Card selection across the review directions
│   │   ├── writing.ts         # Stroke-order quiz and the grade it measures
│   │   ├── listening.ts       # Which reading the listening card plays in
│   │   ├── background-handler.ts # update_flashcard / record_confusion / find_confusables / set_word_status
│   │   └── flashcard-client.ts
│   ├── settings/              # Options page (manifest `options_ui`)
│   │   ├── settings.ts / settings.html / settings.scss
│   │   └── settings-view.ts   # Form built from the setting specs; its copy
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
│   │   ├── lookalikes.ts      # Characters that differ from one another by one part
│   │   └── offscreen-handler.ts # dict_lookup; the maps live in this document
│   ├── offscreen/             # Offscreen composition root (dicts + OCR)
│   │   ├── offscreen.html
│   │   └── offscreen.ts       # register() of dictionary and OCR handlers
│   ├── shared/                # Cross-feature utilities and UI components
│   │   ├── message-manager.ts # request() typed promise message helper
│   │   ├── message-router.ts  # registerHandlers() onMessage routing
│   │   ├── offscreen-document.ts # ensureOffscreenDocument(); one host
│   │   ├── statistics-store.ts# Per-word layout, cap, sync share, migration
│   │   ├── review-log.ts      # Cards answered per local day (local only)
│   │   ├── statistics-utils.ts# mergeStatistics(), getFlashcardStage()
│   │   ├── settings.ts        # Reader preferences: specs, defaults, watchSettings()
│   │   ├── scheduler.ts       # FSRS review scheduling
│   │   ├── bounded-map.ts     # Top-N-by-sort-key map
│   │   ├── debounce.ts        # createBatchedDebounce()
│   │   ├── dom-element.ts     # createElement()
│   │   ├── strokes.ts         # Packaged stroke graphics, one file per character
│   │   ├── frequency.ts       # Corpus rank → learner-facing band
│   │   ├── frequency-badge.ts # The band/rank chip on a definition
│   │   ├── availability-badge.ts # "Mandarin only" / "Cantonese only" chip
│   │   ├── decomposition.ts   # Component glyphs of an IDS decomposition
│   │   ├── definition-list.ts # Collapsing sense list
│   │   ├── pronunciation-section.ts # Pronunciation section component
│   │   ├── speech.ts          # Browser TTS, per-reading voice matching
│   │   ├── etymology-section.ts     # Etymology section component
│   │   ├── definition-section.ts    # Shared definition-container component
│   │   ├── context-sentence.ts      # Met-in sentences, plain or cloze-blanked
│   │   ├── word-contexts.ts   # Which sentences a word keeps, and what of their page
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
│   ├── prepare-worktree.sh    # Readies a git worktree from the main checkout
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
    └── docs/                  # Project documentation
        ├── architecture/      # One file per area; start at README.md
        ├── dev-workflow.md
        ├── git-conventions.md
        └── testing.md
```
