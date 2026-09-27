# Background

## Service Worker (`src/service-worker.ts`)

- **Purpose**: MV3 background entry point. It does not contain handler logic
  itself — it imports each feature's `background-handler.ts` and calls their
  `register()` to attach `chrome.runtime.onMessage` listeners.

## Background Handlers (`*/background-handler.ts`)

- Each handler registers through `registerHandlers()`
  (`src/shared/message-router.ts`), which owns the parts every listener would
  otherwise repeat: the async response channel (`return true`), passing an
  unrecognised message through (`return false`) so another feature's listener
  can answer it, and turning a thrown error into an `ErrorResponse`.
- **popup**: handles `lookup_word`, `track_word` and `mark_known` (the paths
  that write new statistics). Lookups are forwarded as `dict_lookup` to the
  offscreen document that holds the parsed maps. A lookup sent `withStatus` —
  only the popup's — also reads the record, in parallel with the dictionary
  hop, and replies with the matched word's `status`; the stats and flashcard
  pages already hold the record, so theirs skip the read. A failed read costs
  the reply its status, not its definition. A tracked word also records what the
  dictionary knows about it — its corpus rank, whether it is a single character
  with named parts, and whether the stroke data covers it — since the pages
  that build sessions cannot look any of them up. Stroke coverage and
  decomposability are asked separately: a character can have strokes without
  its etymology naming any parts. `segment_text` splits page text into words
  through `dict_segment` and returns whether the reader knows each one (see
  [page-coverage.md](page-coverage.md)).
- **stats**: handles `get_statistics` (reads merged sync+local statistics)
  and `get_review_log` (reads the per-day review log).
- **flashcards**: handles `update_flashcard` (advances one direction's FSRS
  state, buries a word once its lapses reach `LEECH_LAPSES`, and adds one to
  today's count in the review log) and
  `set_word_status` (retire or pin a word, keeping its progress).
- Message passing is plain functions, not a class. The typed send helper is
  `sendMessage()` in `src/shared/message-manager.ts`; each feature has a thin
  `*-client.ts` wrapper around it.
