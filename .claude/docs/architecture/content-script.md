# Content Script (`src/popup/content.ts`)

- **Purpose**: Detect Chinese text under the cursor / in a selection and show a popup.
- **Key class**: `ChineseHoverPopupManager` — popup display and selection logic.
- **Responsibilities**: inject styles; listen for `mousemove`/`mouseout`/`mouseup`
  (throttled on the animation frame alone, cancelled on `destroy()`); skip
  hit-testing replaced elements that cannot hold a caret; ignore lookup
  replies for a word the cursor has already left; detect Chinese with
  `[一-鿿]+`; take the whole run at the caret
  (`document.caretRangeFromPoint`, with a realm-safe `nodeType` check so
  frames work) and send it with the hovered offset, leaving segmentation to
  the dictionary; request a lookup via `popup-client` (`request`); render
  the popup with the shared section components.
- **Instant show and hide**: a word is looked up the moment the cursor lands
  on it, and the popup goes the moment the cursor leaves the word's text
  block — the nearest ancestor whose `display` is not `inline`, never the
  body. Gaps inside the block (between lines, over punctuation or other
  script) keep the popup, so reading down a paragraph does not flicker it.
  The popup is positioned against the viewport, so its place on the *page* is
  kept and a document scroll moves it by hand — otherwise it would hang over
  whatever scrolled into the word's place.
- **Shift holds the popup**: while Shift is held, moves neither replace nor
  hide a popup on screen, so the cursor can cross other words to reach its
  audio or **+ Study** button. Once inside, the popup stays until the cursor
  leaves it. Shift is read from each move's `shiftKey`, so a keyup lost to a
  window switch cannot leave the popup stuck. It is ignored while a mouse
  button is down (Shift-drag extends a selection) and while a text field or
  `contenteditable` has focus, where Shift is typing.
- **Escape closes it**, cancelling any pending lookup and the dwell with it —
  a word dismissed was not studied. The key is not consumed, since the page
  may use Escape too.
- **Study signal**: showing a popup is not studying. After `DWELL_MS` with the
  popup still on the same word, the script sends `track_word` — once per word,
  along with `extractContext`'s snippet of the sentence it was met in and the
  page's `location.href` and `document.title` (added by `popup-client.ts`, and
  sent whole — the write path decides what of them is kept). The popup's
  **+ Study** button sends the same message at once, with `pin` set.
- **Known**: beside **+ Study**, a toggle that sends `mark_known` — the same
  retirement `set_word_status` makes (`suppressed`, progress kept, the pin
  cleared), but it records a word not yet tracked so the retirement has an
  entry to stick to, and it is not a sighting: the count is untouched and the
  pending dwell is cancelled. The lookup is sent with `withStatus`, so the reply
  carries the word's `status` and the button shows as pressed on a word
  already retired; pressing it again puts the word back. The two buttons
  redraw each other, since each decision clears the other.
- **What un-retires a word**: only a decision — Known pressed again, **+
  Study**, or the stats and flashcard pages' own controls. A dwell is a
  sighting, so it never undoes a Known pressed a moment earlier.
- **Following a component**: a chip in the character breakdown whose glyph the
  dictionaries hold an entry for is a button, and pressing it puts that entry
  in the popup with a back control to the word it came from. The trail is the
  popup's alone — a fresh hover starts a new one — and the definitions on it
  are the ones already fetched, so stepping back costs no lookup. Only the
  popup passes `onFollowComponent`; the stats and flashcard surfaces render the
  same breakdown with its chips as labels.
- **Following a character**: the headword itself splits the same way. Each
  character of a compound the dictionaries hold an entry for
  (`charactersWithEntries`, added by the lookup) is a button in the popup's
  heading and joins the same trail — a compound is read through its parts as
  much as a character is read through its components. A single-character word
  stays a plain heading, since it leads nowhere.
