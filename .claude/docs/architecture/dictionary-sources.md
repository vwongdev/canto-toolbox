# Dictionary Sources

- **CC-CEDICT** — Mandarin–English with Pinyin.
- **CC-Canto** — Cantonese–English with Jyutping (including entries with empty
  pinyin brackets, which the parser preserves).
- **makemeahanzi** — character decomposition / etymology.
- **SUBTLEX-CH** — word frequency from film subtitles (Cai & Brysbaert, 2010),
  read from the `chinese-lexicon` devDependency. Capped at the 20,000
  commonest words: past that, the difference between two ranks is "both rare".
  The package also exposes an HSK helper, but it *estimates* a level from
  character difficulty for words off the official list, so it is not used.

Processed at build time into unified JSON under `public/data/`. Mandarin and
Cantonese entries are stored once and indexed under **both** the simplified
and the traditional form, so a lookup finds a word whichever script the page
is written in.
