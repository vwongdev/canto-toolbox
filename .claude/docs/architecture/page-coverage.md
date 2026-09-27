# Unknown Words on the Page (`src/popup/page-coverage.ts`)

- **Purpose**: show which words on a page the reader does not know yet, and
  what share of the page's words they do, so a learner can pick text at their
  level. Opt-in (`markUnknownWords`, off by default); `content.ts` hands it the
  settings alongside the popup, so switching it applies to open tabs at once.
- **No DOM changes**: unknown words are a CSS Custom Highlight
  (`CSS.highlights`, name `canto-unknown`) over `Range`s, drawn as a dotted
  underline in the OCR hairline's colours. No text node is wrapped or split, so
  the page's scripts and the popup's `caretRangeFromPoint` see the page exactly
  as before, and a decoration takes no layout space. Without the API (not in
  Chrome before 105) the figure is still counted.
- **What is read**: text nodes holding Chinese under `body`, walked by hand so
  skipped subtrees are pruned — scripts, form fields, `contenteditable`, text
  `checkVisibility` says is hidden, and the extension's own UI: the popup, the
  chip and the OCR overlay (text guessed out of a picture is not the page's).
  The content script is not `all_frames`, so only the top frame is read;
  iframes are neither marked nor counted. A run split across elements
  (`<b>中</b>文`) is segmented per text node, as a hover takes it.
- **Scheduling**: nodes nearest the viewport go first, in slices of
  `SLICE_CHARS` sent one at a time behind `requestIdleCallback`, up to
  `MAX_PAGE_CHARS` per page. The offscreen document is single-threaded and
  hovers queue behind whatever it is doing, so a lookup waits for one slice at
  most. Each node's result is kept with the text it was read from, so a later
  pass sends only nodes that are new or changed and drops ranges for ones gone.
- **Re-reading**: a `MutationObserver` on the body (ignoring the extension's
  own UI) schedules a pass `RESCAN_DELAY_MS` after the first change — not
  pushed back by later ones, or a ticking clock would starve it. A URL change
  (seen on the next pass, or by `popstate` / `hashchange`) starts the page's
  figure afresh. A statistics change re-asks every word, but only when
  `changesKnown` says a verdict moved: a dwell's count going up changes none,
  so reading does not trigger re-reads. Old marks stay until replaced.
- **The join happens in the worker**: `segment_text` carries the runs; the
  worker forwards `dict_segment` to the offscreen document and judges each
  word against the record through `KnownWordsCache` (`known-words.ts`), which
  reads the record once and drops it only when `changesKnown` fires. A tab thus
  receives a verdict per word, never the record, and the worker already reads
  the record for the popup's Known state.
- **Known** is `isKnown` (`statistics-utils.ts`) — the rule the stats page's
  band coverage uses — checked against the word and its other script form,
  since a word is recorded in the script it was hovered in.
- **Coverage**: word tokens known over word tokens counted, each occurrence
  weighted, plus the number of distinct unknown words (`summariseCoverage`).
  Characters no entry covers are skipped; single-character words, function
  words included, count like any other. A proper noun — CC-CEDICT capitalises
  its pinyin — is left out of both marks and figure only when SUBTLEX-CH does
  not rank it: 中國 and 中文 are capitalised too and are vocabulary. Rare words
  count; a text full of them is a hard text. The figure is withheld below
  `MIN_WORDS_FOR_FIGURE` words.
- **The chip** sits fixed in the bottom-right corner ("82% known · 14 new
  words"); its × hides it until the URL changes, leaving the marks. It is not
  repeated on the action popup: the figure describes the page in front of the
  reader, where the chip already is, and reaching the tab from the popup would
  add a tab message for no new information.
