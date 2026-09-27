# Extension Permissions

- `storage` — statistics tracking and settings.
- `unlimitedStorage` — lifts local's 10 MB quota, so the statistics record is
  bounded by `MAX_TRACKED_WORDS` alone. It carries no install warning.
- `offscreen` — the document that holds the parsed dictionaries and the OCR engine.
- `host_permissions: ["<all_urls>"]` — lets the offscreen document fetch an
  image's bytes, and lets the worker screenshot the visible tab for a video
  frame a canvas may not read. Reading image bytes in the content script
  instead is not an option: a cross-origin image taints a canvas. This adds no
  install warning the extension did not already carry, since the content script
  is declared statically with `<all_urls>` and asks for the same access.
- The content script is declared statically in `manifest.json`; there is no
  `scripting` or `activeTab` permission.
- `content_security_policy.extension_pages` allows `'wasm-unsafe-eval'`, which
  an extension page needs to instantiate the OCR runtime's WebAssembly.
