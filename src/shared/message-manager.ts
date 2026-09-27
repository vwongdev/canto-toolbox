import type { BackgroundMessage, BackgroundResponse, ResponseFor } from './types';

function isSuccessFor(r: BackgroundResponse | undefined, type: BackgroundMessage['type']): boolean {
  return r != null && r.success === true && r.type === type;
}

/**
 * Send a message and settle with its success response. Anything else — a
 * closed channel, an error response, or a reply for another message type —
 * rejects with the most specific error available.
 */
export function request<M extends BackgroundMessage>(message: M): Promise<ResponseFor<M>> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: unknown) => {
      const r = response as BackgroundResponse | undefined;
      if (chrome.runtime.lastError || !isSuccessFor(r, message.type)) {
        const error = chrome.runtime.lastError?.message
          ?? (r != null && 'error' in r ? r.error : 'Request failed');
        reject(new Error(error));
        return;
      }
      resolve(r as ResponseFor<M>);
    });
  });
}
