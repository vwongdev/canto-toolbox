# Dictionary (`src/dictionary/dictionary.ts`)

- **Purpose**: Load and search the dictionaries.
- **Where it runs**: the offscreen document (`src/offscreen/`), via
  `offscreen-handler.ts`. The service worker is torn down on idle, which would
  discard the parsed maps between one hover and the next; Chrome allows only
  one offscreen document, so dictionaries share the host already used for OCR.
  The worker's `lookup_word` handler starts that document (if needed) and
  forwards. The OCR engine is imported only when an image is read, so a hover
  does not pay for the model.
- **Loading**: `initDictionaries()` lazily `fetch`es
  `chrome.runtime.getURL('data/{mandarin,cantonese,etymology,frequency}.json')`
  (the JSON is a packaged `web_accessible_resource`, **not** statically
  imported/bundled) and parses it **once**. Mandarin and Cantonese arrive as a
  compact `rows`+`index` form so each unique entry is stored once; both script
  forms share a row. Etymology and frequency stay keyed maps.
- **Lookup**: after the one-time async load, `lookupWordAt` is synchronous —
  the longest word covering the given offset (0 by default), over up to
  `MAX_WORD_LENGTH`, Cantonese-marker filtering, and
  `lookupEtymology` for character breakdown.
- **Enrichment**: the longest-match scan tries a candidate per length and start
  offset and throws away all but one, so the parts not needed to judge a
  candidate — the character breakdown and the corpus rank — are added by
  `enrich` to the winner alone. `lookupEtymology` memoises into a capped cache,
  since the same characters recur as the cursor moves. The breakdown also
  carries `componentsWithEntries` — the parts that are words in their own right —
  because only the document holding the maps can say which components are
  worth following. `charactersWithEntries` says the same of a compound's own
  characters, for the same reason.
- **Segmentation**: `segmentRun` walks a run left to right taking the longest
  word from each point — `lookupWordAt`'s scan from offset 0, repeated — and steps over a
  character no entry starts with. It checks the index before decoding a row and
  enriches nothing, so it leaves the hover path untouched. Each word carries
  its other script forms and whether it is an unranked proper noun.
  `dict_segment` answers many runs per message.
