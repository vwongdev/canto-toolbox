import { request } from './message-manager.js';
import { localHandlerFor } from './message-router.js';
import type { BackgroundMessage, ResponseFor } from './types';

/**
 * Chrome allows one offscreen document per extension and rejects a second
 * `createDocument`, so every feature that needs the host goes through here.
 * The document outlives the service worker: that is why the dictionaries and
 * the OCR model both live in it rather than in the worker's heap.
 */
const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';

let creating: Promise<void> | null = null;

async function hasOffscreenDocument(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}

export async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;

  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification:
        'Holds the parsed dictionaries and the WebAssembly OCR model across service worker restarts.',
    })
    .finally(() => {
      creating = null;
    });

  await creating;
}

/**
 * Sends a message to whichever context hosts the dictionaries and the OCR
 * model. Where that is this context, the handler is called in place, since a
 * context cannot message its own listeners.
 */
export async function offscreenRequest<M extends BackgroundMessage>(message: M): Promise<ResponseFor<M>> {
  const local = localHandlerFor(message);
  if (local) return local(message);

  await ensureOffscreenDocument();
  return request(message);
}
