import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import chromeManifest from './manifest.json';

const browser = process.env.TARGET === 'firefox' ? 'firefox' : 'chrome';

/**
 * Firefox has no offscreen documents and no MV3 service worker: its event
 * page hosts the dictionaries and the OCR model itself. The gecko ID is
 * permanent once the extension is listed on addons.mozilla.org.
 */
const firefoxManifest = {
  ...chromeManifest,
  permissions: chromeManifest.permissions.filter((permission) => permission !== 'offscreen'),
  background: { scripts: ['src/background-firefox.ts'], type: 'module' as const },
  browser_specific_settings: {
    gecko: {
      id: 'canto-toolbox@canto-toolbox',
      strict_min_version: '128.0',
      data_collection_permissions: { required: ['none'] },
    },
  },
};

const chromeInputs = {
  background: 'src/service-worker.ts',
  offscreen: 'src/offscreen/offscreen.html',
};

const firefoxInputs = {
  background: 'src/background-firefox.ts',
};

export default defineConfig({
  plugins: [
    crx({ manifest: browser === 'firefox' ? firefoxManifest : chromeManifest, browser })
  ],
  base: './', // Use relative paths for Chrome extension
  resolve: {
    alias: {
      // ppu-paddle-ocr imports the default onnxruntime-web build, which bundles
      // its WebAssembly glue and makes Rollup emit both the 14 MB plain and the
      // 28 MB jsep binaries into dist/. This alias points every importer at the
      // extern-wasm build instead: it loads the runtime from `wasmPaths` at
      // run time, so nothing is emitted and the copy vendored into public/ocr/
      // is the only one shipped. Aliasing rather than importing it directly in
      // src/ocr/engine.ts also keeps the library and our own configuration on a
      // single ORT instance — two copies would mean `ort.env` settings applied
      // to one that the other never reads.
      'onnxruntime-web': fileURLToPath(
        new URL('./node_modules/onnxruntime-web/dist/ort.wasm.min.mjs', import.meta.url),
      ),
    },
  },
  css: {
    preprocessorOptions: {
      // Vite 5 still drives Sass through the legacy JS API, which Dart Sass
      // deprecated and removes in 2.0. The modern compiler is already bundled;
      // opting in now silences the warning and is what Vite 6 defaults to.
      scss: { api: 'modern-compiler' },
    },
  },
  build: {
    outDir: browser === 'firefox' ? 'dist-firefox' : 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // TypeScript entry points
        ...(browser === 'firefox' ? firefoxInputs : chromeInputs),
        content: 'src/popup/content.ts',
        stats: 'src/stats/stats.html',
        'stats-script': 'src/stats/stats.ts',
        flashcards: 'src/flashcards/flashcards.html',
        'flashcards-script': 'src/flashcards/flashcards.ts',
      },
    },
  },
  publicDir: 'public'
});

