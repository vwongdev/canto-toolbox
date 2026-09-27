import type { BackgroundMessage, BackgroundResponse, ErrorResponse, ResponseFor } from './types';

function isSuccessFor(r: BackgroundResponse | undefined, type: BackgroundMessage['type']): boolean {
  return r != null && r.success === true && r.type === type;
}

export function sendMessage<M extends BackgroundMessage>(
  message: M,
  callback: (response: ResponseFor<M> | ErrorResponse) => void,
  defaultError = 'Request failed'
): void {
  chrome.runtime.sendMessage(message, (response: unknown) => {
    const r = response as BackgroundResponse | undefined;
    if (chrome.runtime.lastError || !isSuccessFor(r, message.type)) {
      const error = chrome.runtime.lastError?.message
        ?? (r != null && 'error' in r ? r.error : defaultError);
      callback({ success: false, error });
      return;
    }
    callback(r as ResponseFor<M>);
  });
}

/**
 * Send a message and settle with its success response, or reject with the
 * error `sendMessage` would have reported.
 */
export function request<M extends BackgroundMessage>(message: M): Promise<ResponseFor<M>> {
  return new Promise((resolve, reject) => {
    sendMessage(message, (response) => {
      if (response.success) resolve(response as ResponseFor<M>);
      else reject(new Error(response.error));
    });
  });
}
