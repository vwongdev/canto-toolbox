# Data Flow

0. **Image text (optional)** — clicking an image's badge sends `ocr_image`;
   the offscreen document reads it and replies with lines and boxes, which the
   content script lays over the image as transparent text. Every step below
   then applies to it unchanged.
1. **Hover/selection** — content script extracts the Chinese word and calls
   `request({ type: 'lookup_word', word })`.
2. **Lookup** — popup `background-handler` forwards `dict_lookup` to the
   offscreen document, which awaits `initDictionaries()`, calls `lookupWord`
   (or `lookupWordAt` when a hovered segment is supplied), and replies with a
   `DefinitionResult`. The worker maps that back onto `lookup_word`, adding the
   word's retired/chosen `status` when the popup asked `withStatus`.
3. **Display** — content script renders the popup near the cursor.
4. **Statistics** — a `track_word` (sent after the reader dwells on a word, or
   at once when they press Study in the popup) increments its count through
   `StatisticsStore` (transform the reconciled record, write the words that
   changed) and
   adds the sentence it was met in (if the word holds none like it) with its
   page, its corpus rank, and whether it can
   carry a components or a writing card. A `mark_known` (the popup's Known)
   retires the word through the same batch without counting it. The
   stats/flashcards pages read both
   areas and reconcile with `mergeStatistics`, which preserves every field a
   word carries rather than the handful the merge names.
5. **Page coverage (optional)** — with `markUnknownWords` on, the content
   script sends the page's runs in slices as `segment_text`; the worker
   forwards `dict_segment`, joins the words with its cached known set, and
   replies with a verdict per word, which the page draws as a highlight and a
   coverage chip.
