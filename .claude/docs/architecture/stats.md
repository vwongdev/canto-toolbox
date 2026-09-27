# Statistics Page (`src/stats/`)

- **Key class**: `StatsManager` (`stats.ts`) — data loading and event wiring.
  All DOM construction lives in `stats-view.ts`, which also owns the element
  ids the page's HTML and its tests share.
- Renders the frequency list with lazily-expanded definitions (rendered by the
  shared `definition-section`), every sentence each word was met in — each
  linking to its page in a new tab (`rel="noopener"`) where one was kept —
  study counts, and a clear action.
- Above the list, `overview.ts` summarises the whole record — cards due now,
  due today, review accuracy and retired count — deliberately unaffected by the
  list's own filters. `ordering.ts` supplies the frequency-band filter and the
  sort (most studied, most common, due soonest, recently seen).
- Below the overview, four collapsible **insights** (`insights.ts` for the
  logic, `stats-view.ts` for the DOM), closed by default with a headline in
  each summary line so the popup stays compact. Like the overview they read
  the whole record and leave retired words' schedules out:
  - **Review forecast** — cards due on each of the next `FORECAST_DAYS` local
    days, overdue cards counted on today, as CSS bars.
  - **Activity** — the current streak and a calendar heatmap of the review
    log over `ACTIVITY_WEEKS`. The log starts empty for existing users, so an
    empty log is reported as such rather than drawn as months of rest days.
    A streak survives until the end of a day not yet studied.
  - **Retention by card** — accuracy per review direction, walked over
    `DIRECTION_FIELD` so a new direction appears without edits here.
  - **Known by frequency** — known words per band against `BAND_SIZES`.
    *Known* means the recognition card is familiar or mastered, or the reader
    retired the word; a word buried as a leech is retired but not known.
    The rule is `isKnown` in `statistics-utils.ts`, shared with the page's
    unknown-word marks so a word counts the same way on both.
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
- **Backup and export** (`transfer-controls.ts`, folded under the filters):
  **Back up** downloads the whole record as versioned JSON (`backup.ts`);
  **Restore** validates such a file and merges it through `mutateStatistics`
  with the backup in the sync area's place — counts, dates and schedules
  resolve as they do between the two areas, including a word's retire and
  study decisions, where the later one wins. Nothing is replaced, so an
  old file cannot wipe newer progress. A file picker closes the action popup,
  so Restore in the popup opens the page in a tab (`#restore`) instead.
  **Anki** and **Pleco** export the deck (enrolled or scheduled, not retired)
  or every tracked word as text (`card-export.ts`). Readings and definitions
  are not in the record, so each word is looked up through `lookup_word`, a
  few at a time, with progress shown. A card has one sentence field, which
  takes the first sentence the word was met in.
- Backups validate `contexts` and still accept the single `context` string of
  older ones; a source that is not an http(s) address is refused, since the
  page renders it as a link. The format version is unchanged: an older restore
  carries fields it does not know, so it can still read a newer file.
