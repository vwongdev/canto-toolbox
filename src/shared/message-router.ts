import type { BackgroundMessage, BackgroundResponse, ResponseFor } from './types';

type HandlerMap = {
  [K in BackgroundMessage['type']]?: (
    msg: Extract<BackgroundMessage, { type: K }>,
  ) => Promise<ResponseFor<Extract<BackgroundMessage, { type: K }>>>;
};

/**
 * Every handler registered in this context. A context cannot message its own
 * listeners, so a sender that hosts the handler itself calls it from here.
 */
const localHandlers: HandlerMap = {};

/**
 * Registers a chrome.runtime.onMessage listener that routes each message to its
 * typed handler. Centralizes the async response channel (`return true`), the
 * "no handler -> pass through (`return false`)" behavior that lets other
 * feature listeners handle the message, and error -> ErrorResponse conversion.
 */
export function registerHandlers(handlers: HandlerMap): void {
  Object.assign(localHandlers, handlers);

  chrome.runtime.onMessage.addListener((
    message: BackgroundMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: BackgroundResponse) => void,
  ): boolean => {
    const handler = handlers[message.type] as
      | ((msg: BackgroundMessage) => Promise<BackgroundResponse>)
      | undefined;
    if (!handler) return false;

    handler(message)
      .then(sendResponse)
      .catch((error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error));
        console.error('[Background] Handler error:', err);
        sendResponse({ success: false, error: err.message, errorName: err.name });
      });
    return true;
  });
}

/** The handler registered in this context for the message, if there is one. */
export function localHandlerFor<M extends BackgroundMessage>(
  message: M,
): ((msg: M) => Promise<ResponseFor<M>>) | undefined {
  return localHandlers[message.type] as ((msg: M) => Promise<ResponseFor<M>>) | undefined;
}
