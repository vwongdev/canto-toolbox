import { registerHandlers } from '../shared/message-router.js';
import { offscreenRequest } from '../shared/offscreen-document.js';

export function register(): void {
  registerHandlers({
    /**
     * The service worker cannot run the model itself — it has no DOM and is
     * torn down on idle, which would discard several megabytes of loaded
     * weights between one image and the next. It starts the offscreen document
     * that can, and forwards.
     */
    ocr_image: async (msg) => {
      const { result } = await offscreenRequest({ type: 'ocr_run', src: msg.src });
      return { success: true, type: 'ocr_image', result };
    },

    /**
     * Only the worker can screenshot a tab, and only for a frame the content
     * script was not allowed to draw itself. The visible tab is the right one
     * by construction: this is answering a badge the reader just clicked.
     */
    capture_tab: async () => {
      const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
      return { success: true, type: 'capture_tab', dataUrl };
    },
  });
}
