# Flashcards Page (`src/flashcards/`)

- Spaced review driven by `src/shared/scheduler.ts` (FSRS). Each word carries a
  schedule per **review direction**: `recognition` (word → meaning, stored under
  the original `flashcard` key), `production` (meaning + cloze sentence → word),
  `listening` (the word spoken → meaning), `components` (character → its parts)
  and `writing` (character → its stroke order). Production and listening unlock
  once recognition leaves its learning steps; components additionally needs
  `decomposable` and writing needs `writable`, both recorded at track time
  because this page has no dictionary.
- The **listening card** depends on the browser rather than the word: it is
  offered only when a voice can say it, in Cantonese when a Cantonese voice
  exists and Mandarin otherwise (`listening.ts`), and the answer says which was
  played. The session waits for the voice list (`whenVoicesReady`), since
  Chrome reports it empty until it loads. Without a voice, `selectSession`
  neither introduces a listening card nor lets a due one take the word's slot,
  and `nextReviewAt` leaves it out — its schedule waits for a browser that can
  play it. The front autoplays and replays on its button or `R`; Chrome refuses
  speech before the tab's first click or key, so the first card of a freshly
  opened tab may need the replay.
- `flashcards.ts` runs the session; `flashcards-view.ts` renders the screens and
  card faces and owns the element ids.
- `selectSession` (`session.ts`) takes the cards the scheduler says are due,
  most overdue first, then tops the session up with cards not yet introduced —
  ordered by corpus rank, so the commonest word met is taught first — capped at
  the reader's new-card limit within their session size (`SessionLimits`,
  from settings). A word offers **at most one card per
  session**, and retired words are skipped. With nothing due, the empty screen
  reports when the next review lands.
- A word joins the deck only once `isEnrolled` says so — pressed **+ Study**, or
  met as many times as the reader's threshold (`MIN_COUNT` by default).
  Hovering still records every word; what it no longer
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
  front needs a lookup before the question can be posed. The production and
  listening answers lead with the word, since their fronts withheld it.
- The page reads the settings before it builds a session, since they size it.
  A change made mid-session reaches the next card drawn but never resizes the
  session already chosen. `TESTS_READING` (`flashcards-view.ts`) names the
  directions whose answer *is* the reading; those backs ignore "hide
  romanisation", and a new direction has to say which it is.
- **Which sentence a card shows** (`contextForReview`): the word's sentences
  taken in turn by that card's review count, so the production cloze is cut
  from a different sentence each session rather than cueing the same one
  every time. Answers show the same sentence with a link to its page; the
  production front shows none, since a page title can name the word asked for.
