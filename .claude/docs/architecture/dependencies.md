# Dependencies

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
- **Chrome Extension APIs** — `chrome.storage.sync|local` (statistics, and
  sync alone for settings),
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
