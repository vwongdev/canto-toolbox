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
- **Firefox** (manifest built in `vite.config.ts`): drops `offscreen`, which it
  does not implement, and adds `browser_specific_settings.gecko` — the ID
  (permanent once listed on addons.mozilla.org), `strict_min_version` 128 (the
  oldest non-ESR release that can still receive updates; from 127 the install
  prompt grants MV3 host permissions), and
  `data_collection_permissions: none`, required for new listings. The reader
  can withdraw host access there at any time, which stops the content script on
  every page; the options page then shows a notice whose button calls
  `permissions.request`. Chrome always reports the access as held, so the
  notice never shows.
- `content_security_policy.extension_pages` allows `'wasm-unsafe-eval'`, which
  an extension page needs to instantiate the OCR runtime's WebAssembly.
