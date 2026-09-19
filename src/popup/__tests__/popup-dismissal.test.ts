// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChineseHoverPopupManager } from '../content.js';
import type { PopupClient } from '../popup-client.js';
import type { DefinitionResult } from '../../shared/types.js';

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
    lookupWord: vi.fn((_word, cb) => cb({ success: true, type: 'lookup_word', definition: DEFINITION })),
    trackWord: vi.fn((_word, cb) => cb({ success: true, type: 'track_word' })),
    pinWord: vi.fn((_word, cb) => cb({ success: true, type: 'track_word' })),
  };
}

describe('popup dismissal', () => {
  let client: PopupClient;
  let manager: ChineseHoverPopupManager;

  function popup(): HTMLElement | null {
    return document.getElementById('chinese-hover-popup');
  }

  /** Put the caret on `offset` of the page's only text node and move there. */
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

  function hoverPopup(): void {
    popup()!.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 40, bubbles: true }));
  }

  /**
   * Moves are coalesced onto the animation frame, so a second move only counts
   * once the frame the first scheduled has passed. Real timers throughout: the
   * grace period is measured against the same clock the frame runs on.
   */
  /** Comfortably past `HOVER_INTENT_MS` in the content script. */
  const REST_MS = 300;

  function nextFrame(): Promise<void> {
    return new Promise(resolve => {
      requestAnimationFrame(() => resolve());
    });
  }

  function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** Rest on the first word until it earns a popup. */
  async function openPopup(): Promise<void> {
    hoverAt(0);
    await wait(REST_MS);
  }

  beforeEach(() => {
    document.body.replaceChildren(document.createTextNode('好字上山 abc'));
    client = createClient();
    manager = new ChineseHoverPopupManager(document, client);
    manager.init();
  });

  afterEach(() => {
    manager.destroy();
  });

  it('opens no popup for a word the cursor passes over', async () => {
    hoverAt(0);
    await wait(120);

    expect(popup()).toBeNull();
    expect(client.lookupWord).not.toHaveBeenCalled();
  });

  it('opens the popup once the cursor rests on the word', async () => {
    await openPopup();

    expect(popup()).not.toBeNull();
  });

  it('holds the popup while the cursor crosses the gap to it', async () => {
    await openPopup();
    hoverAt(6);
    await wait(100);

    expect(popup()).not.toBeNull();
  });

  it('keeps the popup once the cursor reaches it', async () => {
    await openPopup();
    hoverAt(6);
    await nextFrame();
    hoverPopup();
    await wait(500);

    expect(popup()).not.toBeNull();
  });

  /**
   * The popup is offset from the cursor, so reaching it crosses whatever the
   * page has between - often more Chinese. None of it is what the reader
   * asked about.
   */
  it('keeps its word while the cursor crosses other words to reach it', async () => {
    await openPopup();
    const lookups = vi.mocked(client.lookupWord).mock.calls.length;

    hoverAt(2);
    await nextFrame();
    hoverPopup();
    await wait(400);

    expect(popup()).not.toBeNull();
    expect(vi.mocked(client.lookupWord).mock.calls.length).toBe(lookups);
  });

  it('hides the popup when the cursor stays away', async () => {
    await openPopup();
    hoverAt(6);
    await wait(500);

    expect(popup()).toBeNull();
  });
});
