# Canto Toolbox

Read Chinese on the web without leaving the page. Hover any word for Mandarin and Cantonese definitions, then review what you looked up with spaced repetition — so reading doubles as study.

> **Note**: This project is an experiment in using [Claude Code](https://docs.anthropic.com/en/docs/claude-code) as an AI-assisted development environment.

## Features

- **Hover to look up**: rest the cursor on any Chinese text; hold Shift to skip the pause
- **Mandarin and Cantonese side by side**: tone-coloured readings, audio, definitions and word frequency
- **Break words down**: click a character or component to open its own entry
- **Spot unknown words**: optionally underline what you haven't learned, with a page score like "82% known"
- **Review what you read**: words you keep meeting become flashcards, with the sentences you met them in
- **Read images and video**: turn the Chinese in a picture or paused frame into hoverable text
- **Offline and private**: no accounts or API calls; progress syncs across Chrome and exports to Anki or Pleco

## Screenshots

### Hover Popup
![Hover popup showing word definition](screenshots/hover-popup.png)

*Hover over Chinese text to see Mandarin and Cantonese definitions*

### Word Statistics
![Statistics page](screenshots/statistics.png)

*Every word you've met, with what's due, your review forecast, streak and progress by frequency band*

### Flashcard Review
![Flashcard review page](screenshots/flashcard-review.png)

*Review your looked-up words with spaced repetition*

### Dark Mode
![Dark mode support](screenshots/dark-mode.png)

*Automatically adapts to your system theme*

## Installation

1. Download the latest `canto-toolbox-<version>.zip` from [Releases](https://github.com/VWongDev/canto-toolbox/releases) and unzip it
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the unzipped `dist/` folder

## Usage

1. **Read**
   - Hover Chinese text for a popup with both readings, definitions, frequency and a per-character breakdown. Drag-select for a phrase.
   - For Chinese inside an image or a paused video, click the badge in its corner. Seeking to the next subtitle re-reads the frame.
   - Captions a site renders as real text (YouTube's own, for one) need no badge — hover them.
2. **Track**: rest on a word and it's recorded with its sentence. Press **+ Study** to add it to your deck now, or **Known** to never drill it. Words you meet often enough join the deck on their own. The extension icon opens your word list.
3. **Review**: open the flashcard page and rate each card Again, Hard, Good or Easy. The stroke-order card grades itself on how many strokes went astray. The [FSRS](https://github.com/open-spaced-repetition/ts-fsrs) scheduler decides when a card comes back.
4. **Adjust**: the gear on the word list opens settings — which reading leads, simplified or traditional headwords, hidden romanisation, session size, when a word joins the deck, and unknown-word marks.

## Building from Source

### Prerequisites

- **Node.js** >= 22 and **pnpm** >= 8 — or, with [Nix](https://nixos.org/) and [direnv](https://direnv.net/), run `direnv allow` in the repo for the pinned versions
- **Git**, for the dictionary submodules

### Build Steps

```bash
git clone --recurse-submodules https://github.com/VWongDev/canto-toolbox.git
cd canto-toolbox
pnpm install
pnpm build
```

If you cloned without submodules, run `git submodule update --init --recursive` first.

`pnpm build` processes the dictionaries, downloads the OCR model (network access needed the first time) and writes the unpacked extension (~80 MB) to `dist/`. Load it as in [Installation](#installation). `pnpm clean` removes the build output.

## Data and Licences

| Data | Source | Licence |
|------|--------|---------|
| Mandarin dictionary | [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cc-cedict), via [edvardsr/cc-cedict](https://github.com/edvardsr/cc-cedict) | MIT |
| Cantonese dictionary | [CC-Canto](https://cc-canto.org/), via [amadeusine/cc-canto-data](https://github.com/amadeusine/cc-canto-data) — CC-Canto and CC-CEDICT Cantonese readings are copyright (c) 2015-16 Pleco Software Incorporated | CC BY-SA 3.0 |
| Character etymology | [Make Me a Hanzi](https://github.com/skishore/makemeahanzi) | LGPL-3.0 ([COPYING](https://github.com/skishore/makemeahanzi/blob/master/COPYING)) |
| Stroke order | Make Me a Hanzi `graphics.txt`, derived from the Arphic PL KaitiM GB and UKai fonts; drawn by [hanzi-writer](https://github.com/chanind/hanzi-writer) (MIT) | [Arphic Public License](https://github.com/skishore/makemeahanzi/blob/master/APL/english/ARPHICPL.TXT), packaged at `strokes/ARPHICPL.TXT` |
| Word frequency | SUBTLEX-CH — Cai, Q., & Brysbaert, M. (2010). [*PLoS ONE*, 5(6), e10729](https://doi.org/10.1371/journal.pone.0010729), via [chinese-lexicon](https://github.com/peterolson/chinese-lexicon) | ISC |
| Image text recognition | [PaddleOCR](https://www.paddleocr.ai/) PP-OCRv6 tiny, via [snowfluke/ppu-paddle-ocr-models](https://huggingface.co/snowfluke/ppu-paddle-ocr-models); run by [ppu-paddle-ocr](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr) and [onnxruntime-web](https://github.com/microsoft/onnxruntime) (both MIT) | Apache 2.0 |

## Inspiration

The hover detection is inspired by [Zhongwen](https://github.com/cschiller/zhongwen), a Chinese-English popup dictionary extension, extended here to Mandarin and Cantonese.

## License

This project is licensed under the MIT License.

## Contributing

Contributions are welcome — please open an issue or pull request.
