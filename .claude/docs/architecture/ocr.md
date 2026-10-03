# Media OCR (`src/ocr/`)

- **Purpose**: make Chinese baked into a picture — an image, or the frame a
  video is paused on — readable by everything that already reads Chinese on
  the page. It is a text *source*, not a second lookup path: `overlay.ts` turns
  recognised boxes into transparent, positioned text nodes, and from there the
  content script's own `caretRangeFromPoint` handling finds them exactly as it
  finds text the page wrote itself. `ChineseHoverPopupManager`, `dictionary/`,
  `stats/` and `flashcards/` do not know pictures exist; the one wire between
  the two is `content.ts` starting `mediaOcrManager` alongside `popupManager`,
  since both run in the content script and one entry point has to bootstrap
  the other.
- **Trigger**: `media-controller.ts` shows a badge on hovering an image or
  video at least `MIN_MEDIA_SIDE_PX` on both sides; clicking it reads it. The
  model loads on the first click, never on page load. A video is only offered
  **while paused** — a frame the reader is still watching is one they have
  already left, and the badge would fight the player's own controls for the
  same corner. What is on offer is reconsidered on `play` and `pause` as well
  as on hover, since every way a reader pauses (space, `k`, a click on the
  picture) leaves the cursor where it was and fires no pointer event.
- **Following playback**: once a frame is read, `play` clears the overlay (text
  read off one frame is wrong for every frame after it) while `pause` and
  `seeked` read the new frame, so stepping between subtitles needs no further
  clicks. A pause on the frame already read is ignored.
- **Capturing a frame** (`capture.ts`): drawing the element is tried first —
  free, no permission, and it yields the video's own resolution. On a 1080p
  stream in an 822px-wide player that is over twice the linear resolution a
  screenshot of the tab would give, which is most of the difference between
  reading subtitles and guessing at them. Media-Source video (what every
  streaming player uses, YouTube included) is fed by the page itself and so is
  *not* tainted, which is why this works where re-fetching a URL cannot. Only a
  `SecurityError` falls back to `chrome.tabs.captureVisibleTab`, which sees
  composited pixels and is blind to nothing but DRM; the crop back to the
  video's rect derives its scale from the screenshot rather than trusting
  `devicePixelRatio`, which lies on a zoomed page.
- Note that **captions a site renders as DOM text need none of this** — the
  popup already reads them. YouTube's own captions are `<span>` text nodes, so
  OCR is only for subtitles burned into the picture.
- **Where it runs**: the shared offscreen document (`src/offscreen/offscreen.html`).
  The service worker has no DOM and is torn down on idle, which would discard
  the loaded weights between one image and the next; `offscreenRequest()`
  (`src/shared/offscreen-document.ts`) starts the document and the worker
  forwards. On Firefox the background page hosts the engine itself. `src/ocr/offscreen.ts` serialises requests behind one queue — a
  single inference session cannot usefully be contended for — and caches
  results by image URL in a `BoundedMap`. A `data:` source is never cached: the
  key would be the whole picture, megabytes of string per entry, and a hit
  would need byte-identical pixels twice, which a video frame never produces.
  The engine module is dynamically
  imported on the first `ocr_run`, so hosting dictionaries in the same
  document does not load the model on hover.
- **Engine**: `engine.ts` runs PP-OCRv6 tiny through `ppu-paddle-ocr/web` over
  `onnxruntime-web`. Models and the runtime are fetched from
  `chrome.runtime.getURL('ocr/…')`, so no network access is involved. It must
  *overwrite* `ort.env.wasm.wasmPaths` rather than fill it in, since the
  library points it at a CDN from its own module body.
- **Placement**: `overlay.ts` puts the *i*th character in the *i*th slot of its
  box rather than reproducing the image's typography — that is what the caret
  needs. For Chinese it is exact, since every glyph is full width. Overlays
  live in the body and are positioned in page coordinates, so an ancestor's
  `overflow` or stacking context cannot clip them, and they are re-laid from
  the held result when a responsive page redraws the image at a new size.
- The badge carries no text. A label legible enough to mean "read this" would
  have to be Chinese, and Chinese on the page is something the popup looks up.
