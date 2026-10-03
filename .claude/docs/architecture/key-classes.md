# Key Classes and Utilities

- **`ChineseHoverPopupManager`** (`src/popup/content.ts`) — popup/selection logic.
- **`StatsManager`** (`src/stats/stats.ts`) — stats page data loading and wiring.
- **`request`** (`src/shared/message-manager.ts`) — typed promise
  message-passing helper; rejects on `chrome.runtime.lastError`, an error
  response, or a reply of the wrong type.
- **`registerHandlers`** (`src/shared/message-router.ts`) — typed `onMessage`
  routing; owns the async response channel, the pass-through for messages a
  feature does not handle, and error→`ErrorResponse` conversion.
- **`offscreenRequest` / `ensureOffscreenDocument`**
  (`src/shared/offscreen-document.ts`) — the one offscreen host; popup,
  flashcard and OCR handlers forward through `offscreenRequest`, which calls
  the handler in place where this context hosts it (Firefox's background page).
- **`StatisticsStore` / `statisticsStore` / `mutateStatistics` /
  `MAX_TRACKED_WORDS`** (`src/shared/statistics-store.ts`) — the single record
  every feature addresses, one local item per word. `read` reconciles both
  areas, `mutate` writes local's changed words and then sync's share
  best-effort, `clear` empties both and records when, so other devices drop
  their copies too; the first call migrates the legacy item.
- **`syncSelection` / `evictionRank`** (`src/shared/statistics-store.ts`) — which
  words sync carries, and the order both it and eviction rank words in.
- **`mergeStatistics` / `reconcileStatistics`**
  (`src/shared/statistics-utils.ts`) — the record as both storage areas hold it.
  Each area's copy of a word is a snapshot of it rather than a share of its
  count, so counts take the higher of the two, and a word's retired and chosen
  flags come from whichever side decided last (`statusAt`); reads and writes
  reconcile through the same function.
- **`MIN_COUNT` / `isEnrolled`** (`src/shared/statistics-utils.ts`) — whether a
  word is in the deck at all. Tracking a word and drilling it are separate:
  hovering records everything, enrolment needs Study or the reader's threshold
  of sightings, of which `MIN_COUNT` is the default.
- **`SETTING_SPECS` / `normaliseSettings` / `watchSettings`**
  (`src/shared/settings.ts`) — the reader's preferences, how a stored record is
  made safe, and the load-then-subscribe every surface starts with.
- **`headwordFor`** (`src/shared/definition-section.ts`) — a looked-up word in
  the script the reader leads with.
- **`getFlashcardStage`** (`src/shared/statistics-utils.ts`) — candidate / new /
  learning / familiar / mastered, derived from the scheduler so `mastered`
  decays. `candidate` is seen-but-not-enrolled, which the stats page filters to.
- **`isKnown`** (`src/shared/statistics-utils.ts`) — familiar, mastered or
  retired, but not buried as a leech; the stats page's band coverage and the
  page's unknown-word marks both use it.
- **`PageCoverageManager` / `summariseCoverage`** (`src/popup/page-coverage.ts`)
  — the unknown-word highlight, the incremental pass over the page, and the
  coverage figure; `KnownWordsCache` / `changesKnown` (`src/popup/known-words.ts`)
  — the worker's known set and the test for a change that moves it.
- **`reviewCard` / `isDue` / `isLeech`** (`src/shared/scheduler.ts`) — FSRS
  scheduling, persisted as the compact `SrsState` on each direction's progress.
- **`progressFor` / `DIRECTION_FIELD` / `schedulesOf`**
  (`src/shared/statistics-utils.ts`) — where each review direction's schedule
  lives on a word, and the shared walk over all of them.
- **`selectSession`** (`src/flashcards/session.ts`) — which card each word
  offers a session, and in what order.
- **`contextsOf` / `addContext` / `mergeContexts` / `sourceFrom` /
  `contextForReview`** (`src/shared/word-contexts.ts`) — a word's sentences in
  either stored shape, adding and pooling them, what of a page is kept, and
  which sentence a card shows.
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
- **`dictionary.ts`** — `initDictionaries`, `lookupWordAt`,
  `lookupEtymology`, `lookupFrequency`, `segmentRun`, `findConfusables`.
- **`buildLookalikeIndex`** (`src/dictionary/lookalikes.ts`) — common
  characters laid out the same way that differ in one part, smallest family
  first.
- **`partnersOf`** (`src/flashcards/session.ts`) — the deck words a word could
  be taken for: recorded mix-ups first, then lookalikes. **`withConfusion` /
  `confusionsOf`** (`src/shared/statistics-utils.ts`) tally and read them.
- **`bandForRank` / `BAND_LABELS`** (`src/shared/frequency.ts`) — a corpus rank
  banded into something a learner can act on (Core 1000 → Rare);
  `frequency-badge.ts` draws it on the definition.
- **`languageAvailability` / `createAvailabilityBadge`**
  (`src/shared/availability-badge.ts`) — "Mandarin only" when only CC-CEDICT
  has the word, "Cantonese only" when only CC-Canto has it with at least one
  sense and it has no corpus rank (a bare reading says how characters are
  said, not that the word is Cantonese). It sits beside the frequency chip in the shared
  `definition-section` rather than in the popup alone: which language a word
  belongs to is a property of the word, and it matters most on the flashcard
  and stats surfaces, where a learner decides what to drill. CC-CEDICT omits
  compounds that mean no more than their characters (很多, 還要), so a word
  with a SUBTLEX-CH rank is never called Cantonese only — the corpus is
  Mandarin.
- **`parseComponents`** (`src/shared/decomposition.ts`) — the component glyphs
  of a makemeahanzi decomposition, Ideographic Description Characters dropped.
- **`pronunciation-section.ts` / `etymology-section.ts` /
  `definition-section.ts` / `definition-list.ts`** — shared UI components;
  `definition-section` composes the others and is reused by popup, stats and
  flashcards. Because they are shared, the audio button, tone colours, script
  variant, availability chip and the collapsing sense list appear on all three
  surfaces from one implementation.
- **`toSyllables`** (`src/shared/pinyin.ts`) — splits a romanisation into
  tone-tagged syllables so each can be coloured; Pinyin gets tone marks,
  Jyutping keeps its digits.
- **`speech.ts`** — `canSpeak` / `speak` over the browser's speech synthesis.
  Voice matching is strict per reading: Cantonese never falls back to a
  Mandarin voice, since the wrong pronunciation is worse than none.
  `whenVoicesReady` hands over the voice list once it has loaded, or after a
  bounded wait for a browser that has none.
