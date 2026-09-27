// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChineseHoverPopupManager } from '../content.js';
import type { PopupClient } from '../popup-client.js';
import type { DefinitionResult } from '../../shared/types.js';

/** Matches `HOVER_INTENT_MS` in the content script. */
const HOVER_INTENT_MS = 250;

const DEFINITION: DefinitionResult = {
  word: '好字',
  mandarin: {
    entries: [
      { traditional: '好字', simplified: '好字', romanisation: 'hao3 zi4', definitions: ['good handwriting'] }
    ]
  },
  cantonese: { entries: [] }
};

function createClient(): PopupClient {
  return {
    lookupWord: vi.fn(async () => ({ definition: DEFINITION })),
    trackWord: vi.fn(async () => {}),
    pinWord: vi.fn(async () => {}),
    markKnown: vi.fn(async () => {}),
  };
}

describe('dwell tracking', () => {
  let client: PopupClient;
  let manager: ChineseHoverPopupManager;

  /**
   * Put the caret on `offset` of the page's only text node. The cursor helpers
   * read the global `document`, so the fixture has to live there too.
   */
  function hoverAt(offset: number): void {
    const textNode = document.body.firstChild as Text;
    document.caretRangeFromPoint = vi.fn(() => ({
      startContainer: textNode,
      startOffset: offset,
    })) as unknown as Document['caretRangeFromPoint'];

    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 10 + offset, clientY: 10, bubbles: true })
    );
  }

  /** Hover `offset` and rest there long enough for the lookup to fire. */
  async function dwellAt(offset: number): Promise<void> {
    hoverAt(offset);
    await vi.advanceTimersByTimeAsync(HOVER_INTENT_MS);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren(document.createTextNode('我寫好字。'));
    client = createClient();
    manager = new ChineseHoverPopupManager(document, client);
    manager.init();
  });

  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
  });

  it('shows the popup without recording a study', async () => {
    await dwellAt(2);

    expect(client.lookupWord).toHaveBeenCalled();
    expect(client.trackWord).not.toHaveBeenCalled();
  });

  it('records the study once the popup has been held', async () => {
    await dwellAt(2);
    await vi.advanceTimersByTimeAsync(400);

    expect(client.trackWord).toHaveBeenCalledWith('好字', expect.any(String));
  });

  it('does not look up a word the cursor passed straight over', async () => {
    hoverAt(2);
    await vi.advanceTimersByTimeAsync(HOVER_INTENT_MS - 50);
    manager.destroy();
    await vi.advanceTimersByTimeAsync(1000);

    expect(client.lookupWord).not.toHaveBeenCalled();
    expect(client.trackWord).not.toHaveBeenCalled();
  });

  /**
   * Switching tab or window leaves the page with no pointer at all, which
   * reaches the popup as a bare mouseleave. The cursor never left the word, so
   * the dwell still stands - and the popup's grace period is shorter than it,
   * so treating this as leaving would cancel the study before it is recorded.
   */
  it('records the study when the page loses the pointer', async () => {
    await dwellAt(2);
    document.getElementById('chinese-hover-popup')!
      .dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: null }));
    await vi.advanceTimersByTimeAsync(400);

    expect(client.trackWord).toHaveBeenCalledWith('好字', expect.any(String));
  });

  it('counts moving across one word as a single study', async () => {
    await dwellAt(2);
    await vi.advanceTimersByTimeAsync(400);
    await dwellAt(3);
    await vi.advanceTimersByTimeAsync(400);

    expect(client.trackWord).toHaveBeenCalledTimes(1);
  });

  it('sends the sentence the word was met in', async () => {
    await dwellAt(2);
    await vi.advanceTimersByTimeAsync(400);

    const context = vi.mocked(client.trackWord).mock.calls[0]![1];
    expect(context).toBe('我寫好字');
  });

  it('sends the hovered run and offset so the lookup can segment', async () => {
    await dwellAt(3);

    expect(vi.mocked(client.lookupWord).mock.calls[0]![1]).toEqual({ run: '我寫好字', offset: 3 });
  });

  it('does not show a lookup that the cursor has already left', async () => {
    vi.useRealTimers();
    const pending: Array<(r: { definition: DefinitionResult }) => void> = [];
    vi.mocked(client.lookupWord).mockImplementation(() => new Promise(resolve => {
      pending.push(resolve);
    }));

    const first: DefinitionResult = { ...DEFINITION, word: '我寫' };
    const second: DefinitionResult = { ...DEFINITION, word: '好字' };

    const rest = () => new Promise<void>(resolve => setTimeout(resolve, HOVER_INTENT_MS + 50));

    hoverAt(0);
    await rest();
    hoverAt(2);
    await rest();

    expect(pending).toHaveLength(2);
    pending[1]!({ definition: second });
    await Promise.resolve();
    pending[0]!({ definition: first });
    await Promise.resolve();

    expect(document.getElementById('chinese-hover-popup')?.dataset.word).toBe('好字');
  });

  it('does not hit-test images', async () => {
    const caret = vi.fn();
    document.caretRangeFromPoint = caret as unknown as Document['caretRangeFromPoint'];

    const img = document.createElement('img');
    document.body.appendChild(img);
    img.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10, bubbles: true }));

    expect(caret).not.toHaveBeenCalled();
    expect(client.lookupWord).not.toHaveBeenCalled();
  });
});
