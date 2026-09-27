# Architecture Overview

Each file in this directory covers one area and says why it works the way it
does, which is what a change is most likely to break. Read only the files for
the area you are changing.

| Working on | Read |
| --- | --- |
| Hover popup, Shift/Escape, Study/Known | [content-script.md](content-script.md) |
| Unknown-word marks, coverage chip | [page-coverage.md](page-coverage.md) |
| A message type or handler | [background.md](background.md), [data-flow.md](data-flow.md) |
| Lookup, segmentation, enrichment | [dictionary.md](dictionary.md) |
| Image or video OCR | [ocr.md](ocr.md), [ocr-model.md](ocr-model.md) |
| Stats list, insights, backup, export | [stats.md](stats.md) |
| Card directions, sessions, grading | [flashcards.md](flashcards.md) |
| A new setting | [settings.md](settings.md) |
| Anything written to `chrome.storage` | [storage.md](storage.md) |
| A permission or the manifest | [permissions.md](permissions.md) |
| A dependency | [dependencies.md](dependencies.md) |
| Dictionary source data | [dictionary-sources.md](dictionary-sources.md) |
| Finding where a function lives | [key-classes.md](key-classes.md) |
| Where a file belongs in the tree | [structure.md](structure.md) |

## Architecture Flow

```mermaid
flowchart TD
    I[Image on the page] -->|badge click: ocr_image| C
    C -->|ocr_run| O[Offscreen document]
    O -->|PaddleOCR over onnxruntime-web| P[Packaged models]
    O -->|lines and boxes| N[Transparent text overlay]
    N -.->|becomes ordinary hoverable text| A
    A[Web Page] -->|mousemove / selection| B[Content Script]
    B -->|request lookup_word| C[Service Worker]
    C -->|registerHandlers| H1[popup background-handler]
    H1 -->|dict_lookup| O
    O -->|dictionary.ts| D[Parsed maps]
    D -->|fetch chrome.runtime.getURL data/*.json| E[Packaged JSON]
    O -->|DefinitionResult| H1
    H1 -->|response| B
    H1 -->|updateStatistics| F[StatisticsStore: local per word + sync share]
    G[Stats / Flashcards Page] -->|get_statistics| C
    G -->|flashcards only: fetch strokes/<char>.json| S[Packaged stroke graphics]
    H1 -->|hasStrokes: strokes/index.json| S
    C -->|stats background-handler| F
    F -->|mergeStatistics| G
    G -->|update_flashcard / set_word_status| C
    C -->|flashcards background-handler| H2[reviewCard per direction]
    H2 --> F
```
