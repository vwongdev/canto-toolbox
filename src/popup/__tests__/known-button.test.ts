// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChineseHoverPopupManager } from '../content.js';
import type { PopupClient } from '../popup-client.js';
import type { DefinitionResult, WordStatus } from '../../shared/types.js';

/** Matches `HOVER_INTENT_MS` and `DWELL_MS` in the content script. */
const HOVER_INTENT_MS = 250;
const DWELL_MS = 400;

const DEFINITION: DefinitionResult = {
  word: '好字',
  mandarin: {
    entries: [
      { traditional: '好字', simplified: '好字', romanisation: 'hao3 zi4', definitions: ['good handwriting'] }
    ]
  },
  cantonese: { entries: [] }
};

function createClient(status?: WordStatus): PopupClient {
  return {
    lookupWord: vi.fn((_word, cb) => cb({
      success: true,
      type: 'lookup_word',
      definition: DEFINITION,
      ...(status && { status }),
    })),
    trackWord: vi.fn((_word, cb) => cb({ success: true, type: 'track_word' })),
    pinWord: vi.fn((_word, cb) => cb({ success: true, type: 'track_word' })),
    markKnown: vi.fn((_word, _known, cb) => cb({ success: true, type: 'mark_known' })),
  };
}

describe('the Known button', () => {
  let client: PopupClient;
  let manager: ChineseHoverPopupManager;

  function open(status?: WordStatus): void {
    client = createClient(status);
    manager = new ChineseHoverPopupManager(document, client);
    manager.init();

    const textNode = document.body.firstChild as Text;
    document.caretRangeFromPoint = vi.fn(() => ({
      startContainer: textNode,
      startOffset: 2,
    })) as unknown as Document['caretRangeFromPoint'];
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 12, clientY: 10, bubbles: true }));
    vi.advanceTimersByTime(HOVER_INTENT_MS);
  }

  const known = () => document.querySelector<HTMLButtonElement>('.popup-known')!;
  const study = () => document.querySelector<HTMLButtonElement>('.popup-study')!;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren(document.createTextNode('我寫好字。'));
  });

  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
  });

  it('shows a word already retired as pressed', () => {
    open({ suppressed: true });

    expect(known().getAttribute('aria-pressed')).toBe('true');
  });

  it('retires the word without counting it as studied', () => {
    open();
    expect(known().getAttribute('aria-pressed')).toBe('false');

    known().click();
    vi.advanceTimersByTime(DWELL_MS);

    expect(client.markKnown).toHaveBeenCalledWith('好字', true, expect.any(Function), expect.any(String));
    expect(known().getAttribute('aria-pressed')).toBe('true');
    expect(client.trackWord).not.toHaveBeenCalled();
  });

  it('puts a retired word back when pressed again', () => {
    open({ suppressed: true });

    known().click();

    expect(client.markKnown).toHaveBeenCalledWith('好字', false, expect.any(Function), expect.any(String));
    expect(known().getAttribute('aria-pressed')).toBe('false');
  });

  it('gives up the Study it overrides, and the reverse', () => {
    open({ pinned: true });
    expect(study().disabled).toBe(true);

    known().click();
    expect(study().disabled).toBe(false);
    expect(study().textContent).toBe('+ Study');

    study().click();
    expect(known().getAttribute('aria-pressed')).toBe('false');
    expect(study().textContent).toBe('Added');
  });
});
