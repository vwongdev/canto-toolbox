# Settings (`src/settings/`, `src/shared/settings.ts`)

- **What they are**: the reader's preferences — session size, new cards per
  session, the enrolment threshold, which reading leads, which script the
  headword is drawn in, whether romanisation waits for a press, and whether
  unknown words are marked on the page. Every default reproduces what the
  extension did before it had settings.
- **One declaration each**: `SETTING_SPECS` states a setting's kind (integer,
  choice, boolean), default and range; the `Settings` type, `DEFAULT_SETTINGS`
  and `normaliseSettings` all follow from it. Sync storage is written by every
  machine the reader uses, so a stored value is clamped or replaced by its
  default rather than trusted. The options page builds its controls from the
  same specs and takes only its labels from `SECTIONS` in `settings-view.ts` —
  a new boolean is one spec line and one label entry.
- **Reaching consumers**: pure code never reads storage. The content script,
  stats page and flashcards page each call `watchSettings()` at start-up, which
  delivers the stored value and then every change (`chrome.storage.onChanged`),
  and hand the values on: `selectSession` takes `SessionLimits`,
  `isEnrolled` / `getFlashcardStage` take the threshold (the stats page carries
  it on its `ListView`, and hands it to the deck export), and the shared definition components take
  `DisplaySettings`. A change applies from the next popup, card or opened row;
  the stats list redraws at once, since the threshold moves words in and out of
  Candidates.
- **Display**: `primaryLanguage` orders the two columns; `script` picks the
  headword form through `headwordFor`, with `findScriptVariant` then naming the
  page's own form beside it (the stats row and flashcard fronts still show the
  word as it was tracked); `hideRomanisation` puts each reading behind a
  "Show Pinyin" / "Show Jyutping" button in the shared pronunciation section.
- **Entry point**: the gear in the stats page's header calls
  `chrome.runtime.openOptionsPage()`; the manifest registers the page as
  `options_ui` with `open_in_tab`.
