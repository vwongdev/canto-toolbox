import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../popup-storage.js', () => ({
  popupStorage: {
    updateStatistics: vi.fn(),
    setStatus: vi.fn(),
    read: vi.fn(),
    statusOf: vi.fn(),
  },
}));

import { register } from '../background-handler.js';
import { popupStorage } from '../popup-storage.js';
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

/** Characters the packaged stroke data covers, for the writing-card gate. */
const STROKE_INDEX = '好';

let createDocument: ReturnType<typeof vi.fn>;
let dictDefinition: DefinitionResult = DEFINITION;
let dictError: string | null = null;

function registerAndGetListener(): Listener {
  register();
  const calls = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls;
  return calls[calls.length - 1]![0] as unknown as Listener;
}

describe('popup background-handler register()', () => {
  beforeEach(() => {
    dictDefinition = DEFINITION;
    dictError = null;
    createDocument = vi.fn(() => Promise.resolve());

    vi.mocked(chrome.runtime.onMessage.addListener).mockClear();
    vi.mocked(popupStorage.updateStatistics).mockReset();
    vi.mocked(popupStorage.setStatus).mockReset();
    vi.mocked(popupStorage.read).mockReset().mockResolvedValue({});
    vi.mocked(popupStorage.statusOf).mockReset().mockReturnValue({});

    Object.assign(chrome.runtime, {
      getContexts: vi.fn(() => Promise.resolve([])),
      ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
      lastError: null,
    });
    Object.assign(chrome, {
      offscreen: { createDocument, Reason: { WORKERS: 'WORKERS' } },
    });

    // The stroke index decides whether a word can carry a writing card. It is
    // memoised for the life of the module, so every case in this file sees
    // this one index.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      json: () => Promise.resolve(STROKE_INDEX),
    })));

    vi.mocked(chrome.runtime.sendMessage).mockImplementation(((
      _message: unknown,
      callback: (r: BackgroundResponse) => void,
    ) => {
      if (dictError) {
        callback({ success: false, error: dictError });
        return;
      }
      callback({ success: true, type: 'dict_lookup', definition: dictDefinition });
    }) as typeof chrome.runtime.sendMessage);
  });

  it('answers a lookup_word message from the offscreen host', async () => {
    const listener = registerAndGetListener();
    const sendResponse = vi.fn();

    const keptOpen = listener({ type: 'lookup_word', word: '好' }, {}, sendResponse);
    expect(keptOpen).toBe(true);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith({
      success: true,
      type: 'lookup_word',
      definition: DEFINITION,
    });
  });

  it('starts the offscreen document that holds the dictionaries', async () => {
    registerAndGetListener();
    await vi.waitFor(() => expect(createDocument).toHaveBeenCalled());
    expect(createDocument.mock.calls[0]![0]).toMatchObject({
      url: 'src/offscreen/offscreen.html',
      reasons: ['WORKERS'],
    });
  });

  it('does not record a lookup as a study', async () => {
    const listener = registerAndGetListener();
    const sendResponse = vi.fn();

    listener({ type: 'lookup_word', word: '好' }, {}, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(popupStorage.updateStatistics).not.toHaveBeenCalled();
  });

  it('forwards the hovered run when one is supplied', async () => {
    const listener = registerAndGetListener();
    const sendResponse = vi.fn();

    listener(
      { type: 'lookup_word', word: '中國人', segment: { run: '中國人', offset: 1 } },
      {},
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'dict_lookup', word: '中國人', segment: { run: '中國人', offset: 1 } },
      expect.any(Function),
    );
  });

  it('reports an error response when lookup fails', async () => {
    dictError = 'boom';
    const listener = registerAndGetListener();
    const sendResponse = vi.fn();

    listener({ type: 'lookup_word', word: '好' }, {}, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'boom',
      errorName: 'Error',
    });
  });

  it('reports a load failure when the offscreen dictionary cannot start', async () => {
    dictError = 'Dictionary failed to load';
    const listener = registerAndGetListener();
    const sendResponse = vi.fn();

    listener({ type: 'lookup_word', word: '好' }, {}, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'Dictionary failed to load',
      errorName: 'Error',
    });
  });

  it('tracks a track_word message', async () => {
    const listener = registerAndGetListener();
    const sendResponse = vi.fn();

    const keptOpen = listener({ type: 'track_word', word: '謝謝' }, {}, sendResponse);

    expect(keptOpen).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(popupStorage.updateStatistics).toHaveBeenCalledWith('謝謝', {});
    expect(sendResponse).toHaveBeenCalledWith({ success: true, type: 'track_word' });
  });

  it('passes the sentence context through to storage', async () => {
    const listener = registerAndGetListener();
    const sendResponse = vi.fn();

    listener({ type: 'track_word', word: '謝謝', context: '真的很謝謝你' }, {}, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(popupStorage.updateStatistics).toHaveBeenCalledWith('謝謝', { context: '真的很謝謝你' });
  });

  it('passes the page the sentence was read on through to storage', async () => {
    const listener = registerAndGetListener();
    const sendResponse = vi.fn();
    const source = { url: 'https://example.com/story', title: '新聞' };

    listener({ type: 'track_word', word: '謝謝', context: '真的很謝謝你', source }, {}, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(popupStorage.updateStatistics).toHaveBeenCalledWith('謝謝', { context: '真的很謝謝你', source });
  });

  it('records the corpus rank alongside the sighting', async () => {
    dictDefinition = { ...DEFINITION, frequency: { rank: 312, band: 'common' } };
    const listener = registerAndGetListener();
    const sendResponse = vi.fn();

    listener({ type: 'track_word', word: '謝謝' }, {}, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'dict_lookup', word: '謝謝', allowMissing: true },
      expect.any(Function),
    );
    expect(popupStorage.updateStatistics).toHaveBeenCalledWith('謝謝', { rank: 312 });
  });

  it('reports the status of the word the lookup matched when asked', async () => {
    dictDefinition = { ...DEFINITION, word: '謝謝' };
    const record = { 謝謝: { count: 3, firstSeen: 1, lastSeen: 2, suppressed: true } };
    vi.mocked(popupStorage.read).mockResolvedValue(record);
    vi.mocked(popupStorage.statusOf).mockReturnValue({ suppressed: true });
    const listener = registerAndGetListener();
    const sendResponse = vi.fn();

    listener(
      { type: 'lookup_word', word: '謝謝你', segment: { run: '謝謝你', offset: 0 }, withStatus: true },
      {},
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(popupStorage.statusOf).toHaveBeenCalledWith('謝謝', record);
    expect(sendResponse.mock.calls[0]![0]).toMatchObject({ success: true, status: { suppressed: true } });
  });

  it('leaves the record unread for a lookup that did not ask for status', async () => {
    const listener = registerAndGetListener();
    const sendResponse = vi.fn();

    listener({ type: 'lookup_word', word: '好' }, {}, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(popupStorage.read).not.toHaveBeenCalled();
  });

  it('still answers a lookup when the record cannot be read', async () => {
    vi.mocked(popupStorage.read).mockRejectedValue(new Error('quota'));
    const listener = registerAndGetListener();
    const sendResponse = vi.fn();

    listener({ type: 'lookup_word', word: '好', withStatus: true }, {}, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls[0]![0]).toMatchObject({ success: true, definition: DEFINITION });
  });

  it('retires a word marked known without recording a sighting', async () => {
    dictDefinition = { ...DEFINITION, frequency: { rank: 312, band: 'common' } };
    const listener = registerAndGetListener();
    const sendResponse = vi.fn();

    listener({ type: 'mark_known', word: '謝謝', known: true, context: '真的很謝謝你' }, {}, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(popupStorage.setStatus).toHaveBeenCalledWith(
      '謝謝',
      { suppressed: true },
      { rank: 312, context: '真的很謝謝你' },
    );
    expect(popupStorage.updateStatistics).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: true, type: 'mark_known' });
  });

  it('puts a word back into review when Known is taken back', async () => {
    const listener = registerAndGetListener();
    const sendResponse = vi.fn();

    listener({ type: 'mark_known', word: '謝謝', known: false }, {}, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(popupStorage.setStatus).toHaveBeenCalledWith('謝謝', { suppressed: false }, {});
  });

  it('marks a word the reader asked for outright as pinned', async () => {
    const listener = registerAndGetListener();
    const sendResponse = vi.fn();

    listener({ type: 'track_word', word: '謝謝', pin: true }, {}, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(popupStorage.updateStatistics).toHaveBeenCalledWith('謝謝', { pinned: true });
  });

  it('marks a single character with named parts as decomposable and writable', async () => {
    dictDefinition = {
      ...DEFINITION,
      word: '好',
      etymology: [
        {
          character: '好',
          decomposition: '⿰女子',
          radical: '女',
          componentDefinitions: { 女: 'woman', 子: 'child' },
        },
      ],
    };
    const listener = registerAndGetListener();
    const sendResponse = vi.fn();

    listener({ type: 'track_word', word: '好' }, {}, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(popupStorage.updateStatistics).toHaveBeenCalledWith('好', {
      decomposable: true,
      writable: true,
    });
  });

  it('leaves a character the stroke data does not cover without a writing card', async () => {
    dictDefinition = { ...DEFINITION, word: '鿆' };
    const listener = registerAndGetListener();
    const sendResponse = vi.fn();

    listener({ type: 'track_word', word: '鿆' }, {}, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(popupStorage.updateStatistics).toHaveBeenCalledWith('鿆', {});
  });

  it('leaves a compound word without a components card', async () => {
    dictDefinition = {
      ...DEFINITION,
      word: '你好',
      etymology: [
        {
          character: '你',
          decomposition: '⿰亻尔',
          radical: '亻',
          componentDefinitions: { 亻: 'person' },
        },
      ],
    };
    const listener = registerAndGetListener();
    const sendResponse = vi.fn();

    listener({ type: 'track_word', word: '你好' }, {}, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(popupStorage.updateStatistics).toHaveBeenCalledWith('你好', {});
  });

  it('still tracks the word when the dictionary cannot rank it', async () => {
    dictError = 'no data';
    const listener = registerAndGetListener();
    const sendResponse = vi.fn();

    listener({ type: 'track_word', word: '謝謝', context: '謝謝你' }, {}, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(popupStorage.updateStatistics).toHaveBeenCalledWith('謝謝', { context: '謝謝你' });
  });

  it('ignores unknown message types', () => {
    const listener = registerAndGetListener();
    const sendResponse = vi.fn();

    const keptOpen = listener({ type: 'bogus' } as unknown as BackgroundMessage, {}, sendResponse);

    expect(keptOpen).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });
});
