import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../dictionary.js', () => ({
  initDictionaries: vi.fn(() => Promise.resolve()),
  lookupWord: vi.fn(),
  lookupWordAt: vi.fn(),
  lookupWordInDictionaries: vi.fn(),
  segmentRun: vi.fn(),
}));

import { register } from '../offscreen-handler.js';
import {
  initDictionaries,
  lookupWord,
  lookupWordAt,
  lookupWordInDictionaries,
  segmentRun,
} from '../dictionary.js';
import type { BackgroundMessage, BackgroundResponse, DefinitionResult } from '../../shared/types.js';

type Listener = (
  message: BackgroundMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (r: BackgroundResponse) => void,
) => boolean;

const DEFINITION: DefinitionResult = {
  word: '好',
  mandarin: { entries: [] },
  cantonese: { entries: [] },
};

function registerAndGetListener(): Listener {
  register();
  const calls = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls;
  return calls[calls.length - 1]![0] as unknown as Listener;
}

describe('dictionary offscreen-handler register()', () => {
  beforeEach(() => {
    vi.mocked(chrome.runtime.onMessage.addListener).mockClear();
    vi.mocked(initDictionaries).mockResolvedValue(undefined);
    vi.mocked(lookupWord).mockReset();
    vi.mocked(lookupWordAt).mockReset();
    vi.mocked(lookupWordInDictionaries).mockReset();
    vi.mocked(lookupWordInDictionaries).mockReturnValue(DEFINITION);
  });

  it('answers a dict_lookup message', async () => {
    vi.mocked(lookupWord).mockReturnValue(DEFINITION);
    const listener = registerAndGetListener();
    const sendResponse = vi.fn();

    const keptOpen = listener({ type: 'dict_lookup', word: '好' }, {}, sendResponse);
    expect(keptOpen).toBe(true);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith({
      success: true,
      type: 'dict_lookup',
      definition: DEFINITION,
    });
  });

  it('segments from the hovered run when one is supplied', async () => {
    vi.mocked(lookupWordAt).mockReturnValue(DEFINITION);
    const listener = registerAndGetListener();
    const sendResponse = vi.fn();

    listener(
      { type: 'dict_lookup', word: '中國人', segment: { run: '中國人', offset: 1 } },
      {},
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(lookupWordAt).toHaveBeenCalledWith('中國人', 1);
    expect(lookupWord).not.toHaveBeenCalled();
  });

  it('returns an empty definition when missing is allowed', async () => {
    vi.mocked(lookupWordInDictionaries).mockReturnValue(DEFINITION);
    const listener = registerAndGetListener();
    const sendResponse = vi.fn();

    listener({ type: 'dict_lookup', word: '好', allowMissing: true }, {}, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(lookupWordInDictionaries).toHaveBeenCalledWith('好');
    expect(lookupWord).not.toHaveBeenCalled();
  });

  it('reports an error response when lookup throws', async () => {
    vi.mocked(lookupWord).mockImplementation(() => {
      throw new Error('boom');
    });
    const listener = registerAndGetListener();
    const sendResponse = vi.fn();

    listener({ type: 'dict_lookup', word: '好' }, {}, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'boom',
      errorName: 'Error',
    });
  });

  it('segments every run of a dict_segment in one reply', async () => {
    vi.mocked(segmentRun).mockImplementation(run => [{ start: 0, end: run.length }]);
    const listener = registerAndGetListener();
    const sendResponse = vi.fn();

    listener({ type: 'dict_segment', runs: ['我', '學習'] }, {}, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith({
      success: true,
      type: 'dict_segment',
      words: [[{ start: 0, end: 1 }], [{ start: 0, end: 2 }]],
    });
  });

  it('reports a load failure when dictionary init rejects', async () => {
    vi.mocked(initDictionaries).mockRejectedValue(new Error('no data'));
    const listener = registerAndGetListener();
    const sendResponse = vi.fn();

    listener({ type: 'dict_lookup', word: '好' }, {}, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'Dictionary failed to load',
      errorName: 'Error',
    });
  });
});
