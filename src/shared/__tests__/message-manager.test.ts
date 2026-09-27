import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { request } from '../message-manager.js';
import type { BackgroundMessage } from '../types.js';

const MESSAGE: BackgroundMessage = { type: 'lookup_word', word: '好' };

function mockResponse(response: unknown): void {
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((_msg: unknown, cb: (r: unknown) => void) => cb(response)) as any
  );
}

describe('request', () => {
  beforeEach(() => {
    chrome.runtime.lastError = undefined;
  });
  afterEach(() => {
    chrome.runtime.lastError = undefined;
    vi.mocked(chrome.runtime.sendMessage).mockReset();
  });

  it('resolves with a response matching the message type', async () => {
    const valid = { success: true, type: 'lookup_word', definition: null };
    mockResponse(valid);

    await expect(request(MESSAGE)).resolves.toEqual(valid);
  });

  it('rejects a success response whose type does not match the request', async () => {
    mockResponse({ success: true, type: 'get_statistics', statistics: {} });

    await expect(request(MESSAGE)).rejects.toThrow('Request failed');
  });

  it('reports chrome.runtime.lastError when present', async () => {
    chrome.runtime.lastError = { message: 'port closed' };
    mockResponse(undefined);

    await expect(request(MESSAGE)).rejects.toThrow('port closed');
  });

  it('rejects with the error an error response carries', async () => {
    mockResponse({ success: false, error: 'word not found' });

    await expect(request(MESSAGE)).rejects.toThrow('word not found');
  });

  it('falls back to a generic error for a malformed response', async () => {
    mockResponse({ unexpected: true });

    await expect(request(MESSAGE)).rejects.toThrow('Request failed');
  });
});
