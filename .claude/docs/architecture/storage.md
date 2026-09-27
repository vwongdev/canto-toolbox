# Storage

- **Statistics**: one item per word, `word:<word>`, in `chrome.storage.local`,
  held by a `StatisticsStore` in `src/shared/statistics-store.ts`. The layout,
  the store and the `MAX_TRACKED_WORDS` cap live there so the write path, the
  stats page's warning and the flashcard handler all address the same record.
  Every writer goes through `mutateStatistics`, which transforms the whole
  reconciled record but writes back only the words whose serialised form
  changed and removes the ones the transform dropped — so a hover costs one
  item, not the record. The record used to be a single item that every write
  rewrote whole; one item per word was chosen over shards because a shard would
  still be rewritten for one word, and `chrome.storage` charges nothing per item
  that shards would save. Mutations in one context run one at a time, since each
  reads what the last wrote.
- **Local is the authority.** `unlimitedStorage` lifts its quota, so it is the
  area every write reaches.
- **Decisions are timed.** Retiring or choosing a word, or undoing either,
  stamps it with `statusAt` (`applyWordStatus`), and a merge takes the flags
  of whichever side decided last. Letting local decide regardless meant a
  retirement made on one device never reached another that held the word: that
  device kept its own flags and wrote them back to sync, undoing the decision
  everywhere. A flag recorded before decisions were timed has no stamp and
  loses to one that has; two unstamped sides go to local.
- **Sync carries a share, deliberately.** Its quotas (8 KB an item, 100 KB and
  512 items in all, and a write rate) cannot hold a reader's record: the old
  single item passed 8 KB at a few dozen studied words, after which sync kept a
  fossil and silently dropped every retirement and rating made since. Now
  `syncSelection` picks the words another device could not rebuild by reading —
  those with review progress, pinned or retired — ranked by the same order
  eviction uses (most recent review first) and cut off at
  `SYNC_BUDGET_BYTES` / `SYNC_BUDGET_ITEMS`, with the met-in sentences left
  behind. Every write brings sync to exactly that share, one item per word,
  removing what fell out of it. Past the budget a device receives the most
  recent reviews, never a months-old snapshot. Reads reconcile both areas with
  `reconcileStatistics`, unchanged: counts take the higher, the later review
  wins, the later decision wins; a word another device synced is written into
  local by the next write. A sync write refused by the rate limit is logged and
  dropped — the next write carries the change.
- **Clearing is recorded, not just performed.** `clear` removes every word
  and writes `CLEARED_AT_KEY` to both areas. Removing the words alone was
  undone by the reader's other devices, which still held them locally and
  synced them straight back. Every read now drops words with no sighting,
  review or decision since the latest clear either area records, and the next
  write removes them from storage and brings local's own record of the clear
  up to date. Each device's clock times its own words, so a skewed clock
  shifts the cut-off by the skew.
- **Migration**: the first read or write in each context folds the legacy
  `wordStatistics` item — local's and sync's, reconciled as before — into the
  per-word layout, then removes it. Concurrent first calls share that one
  migration. The legacy record is merged in as the *sync* side, so a run
  interrupted after moving some words simply runs again without undoing
  anything done since; the legacy item is removed only once local holds every
  word. A device still on an older version that writes the legacy item to sync
  again has it folded in at the next service-worker start.
- **Settings**: one `chrome.storage.sync` item, `SETTINGS_KEY` (`settings`),
  written whole by `saveSettings`. It is a few dozen bytes, well inside sync's
  quotas in the headroom the statistics share's budget leaves, and preferences
  are what a reader expects to follow them between machines. The statistics
  store only touches `word:` keys, so clearing statistics keeps the settings.
- **Write batching**: `popup-storage.ts` accumulates counts with
  `createBatchedDebounce` and writes them through a `BoundedMap` capped at
  `MAX_TRACKED_WORDS` (20,000 — not a storage limit, but a bound on what every
  write reads back). Study and Known decisions ride the same batch, so they
  cannot race the sightings written beside them; the latest decision per word
  wins, and a Known is taken back out of the count. `statusOf` overlays a
  decision still waiting for its batch, so re-hovering a word just marked
  Known shows it pressed. Eviction (`evictionRank`) is tiered rather than by
  study count alone —
  reviewed words (tie-broken by last review) outrank pinned, which outrank
  retired, which outrank the merely-seen — so pruning cannot throw away FSRS
  history.
- **Met-in sentences** (`word-contexts.ts`): each word keeps up to
  `MAX_CONTEXTS` (5) in `contexts`, oldest first, each `{ text, source?, seen }`.
  A sighting adds one only if the word holds no near-identical sentence —
  same letters once punctuation and spacing are dropped, one inside the other,
  or ≥ 0.8 Dice similarity over character pairs, which catches a long sentence
  windowed a few characters apart. A full list keeps its first sentence (the
  hook the word was learned on, and the one export uses) and drops the oldest
  of the rest. `sourceFrom` keeps only http(s) pages, as origin + path — query,
  fragment and credentials dropped — and keeps no page at all for a local or
  private-network host or a path segment that looks like a token. Words
  recorded before this hold one `context` string: `contextsOf` reads it as the
  first sentence, and it is folded into `contexts` when the word next gains a
  sentence or is merged. `mergeStatistics` pools both sides' sentences in the
  order they were met, so areas and backups never lose one to the other.
- **Review log**: `REVIEW_LOG_KEY` in `chrome.storage.local` only
  (`src/shared/review-log.ts`) — local calendar day → cards answered, pruned
  to `REVIEW_LOG_DAYS`. Kept apart from the statistics record because the
  record holds only each card's latest review, so past days cannot be
  recovered from it, and a log growing by the day has no place in sync's
  8 KB item. Writes are serialised so ratings in quick succession all count.
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
