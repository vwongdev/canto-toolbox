import { describe, it, expect } from 'vitest';
import { offscreenRequest } from '../offscreen-document.js';
import { registerHandlers } from '../message-router.js';

describe('offscreenRequest', () => {
  /**
   * Firefox's background page hosts the dictionary itself, and a context
   * cannot message its own listeners: a sent message would get no reply.
   */
  it('calls a handler registered in this context without messaging', async () => {
    const definition = { word: '好' } as never;
    registerHandlers({
      dict_lookup: async () => ({ success: true, type: 'dict_lookup', definition }),
    });

    const response = await offscreenRequest({ type: 'dict_lookup', word: '好' });

    expect(response.definition).toBe(definition);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
});
