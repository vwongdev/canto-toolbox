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
    lookupWord: vi.fn(async () => ({ definition: DEFINITION, ...(status && { status }) })),
    trackWord: vi.fn(async () => {}),
    pinWord: vi.fn(async () => {}),
    markKnown: vi.fn(async () => {}),
  };
}

describe('the Known button', () => {
  let client: PopupClient;
  let manager: ChineseHoverPopupManager;

  async function open(status?: WordStatus): Promise<void> {
    client = createClient(status);
    manager = new ChineseHoverPopupManager(document, client);
    manager.init();

    const textNode = document.body.firstChild as Text;
    document.caretRangeFromPoint = vi.fn(() => ({
      startContainer: textNode,
      startOffset: 2,
    })) as unknown as Document['caretRangeFromPoint'];
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 12, clientY: 10, bubbles: true }));
    await vi.advanceTimersByTimeAsync(HOVER_INTENT_MS);
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

  it('shows a word already retired as pressed', async () => {
    await open({ suppressed: true });

    expect(known().getAttribute('aria-pressed')).toBe('true');
  });

  it('retires the word without counting it as studied', async () => {
    await open();
    expect(known().getAttribute('aria-pressed')).toBe('false');

    known().click();
    await vi.advanceTimersByTimeAsync(DWELL_MS);

    expect(client.markKnown).toHaveBeenCalledWith('好字', true, expect.any(String));
    expect(known().getAttribute('aria-pressed')).toBe('true');
    expect(client.trackWord).not.toHaveBeenCalled();
  });

  it('puts a retired word back when pressed again', async () => {
    await open({ suppressed: true });

    known().click();

    expect(client.markKnown).toHaveBeenCalledWith('好字', false, expect.any(String));
    expect(known().getAttribute('aria-pressed')).toBe('false');
  });

  it('gives up the Study it overrides, and the reverse', async () => {
    await open({ pinned: true });
    expect(study().disabled).toBe(true);

    known().click();
    expect(study().disabled).toBe(false);
    expect(study().textContent).toBe('+ Study');

    study().click();
    expect(known().getAttribute('aria-pressed')).toBe('false');
    expect(study().textContent).toBe('Added');
  });
});
