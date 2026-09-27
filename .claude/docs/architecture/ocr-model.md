# OCR Model

- **PP-OCRv6 tiny** — one unified detection/recognition pair covering
  Simplified and Traditional Chinese, ~6.4 MB, vendored by
  `build-tools/fetch-ocr-assets.ts` with pinned SHA-256 digests. Its 6,174
  character dictionary reads every one of the 5,000 commonest SUBTLEX-CH words
  and 99.86% of the 20,000 the frequency data is capped at; the next tier up
  costs 25 MB to gain only words the extension already bands as rare.
- Tesseract is the obvious alternative and was rejected: it is tuned for
  scanned documents, and this feature targets screenshots, panels and signage.
