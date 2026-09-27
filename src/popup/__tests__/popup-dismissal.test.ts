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

/** The space in the paragraph: text, but no word. */
const GAP_OFFSET = 4;
/** Where the paragraph sits; anything below it is outside. */
const PARAGRAPH_RECT = { left: 0, top: 0, right: 300, bottom: 100 };

function createClient(): PopupClient {
  return {
    lookupWord: vi.fn(async () => ({ definition: DEFINITION })),
    trackWord: vi.fn(async () => {}),
    pinWord: vi.fn(async () => {}),
    markKnown: vi.fn(async () => {}),
  };
}

describe('popup dismissal', () => {
  let client: PopupClient;
  let manager: ChineseHoverPopupManager;

  function popup(): HTMLElement | null {
    return document.getElementById('chinese-hover-popup');
  }

  /** Put the caret on `offset` of the paragraph and move to (x, y). */
  function moveTo(offset: number, x: number, y: number, init: MouseEventInit = {}): void {
    const textNode = document.querySelector('p')!.firstChild as Text;
    document.caretRangeFromPoint = vi.fn(() => ({
      startContainer: textNode,
      startOffset: offset,
    })) as unknown as Document['caretRangeFromPoint'];

    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true, ...init })
    );
  }

  function hoverAt(offset: number, init: MouseEventInit = {}): void {
    moveTo(offset, 10 + offset, 10, init);
  }

  function leaveParagraph(init: MouseEventInit = {}): void {
    moveTo(GAP_OFFSET, 10, 200, init);
  }

  function hoverPopup(): void {
    popup()!.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 40, bubbles: true }));
  }

  /** Moves are coalesced onto the animation frame, so each test move waits one. */
  function nextFrame(): Promise<void> {
    return new Promise(resolve => {
      requestAnimationFrame(() => resolve());
    });
  }

  async function openPopup(): Promise<void> {
    hoverAt(0);
    await nextFrame();
  }

  beforeEach(() => {
    const paragraph = document.createElement('p');
    paragraph.textContent = '好字上山 abc';
    paragraph.getBoundingClientRect = () => ({ ...PARAGRAPH_RECT }) as DOMRect;
    document.body.replaceChildren(paragraph, document.createElement('input'));
    client = createClient();
    manager = new ChineseHoverPopupManager(document, client);
    manager.init();
  });

  afterEach(() => {
    manager.destroy();
    window.scrollY = 0;
  });

  it('opens the popup as soon as the cursor lands on a word', async () => {
    hoverAt(0);
    await Promise.resolve();

    expect(popup()).not.toBeNull();
  });

  /** Between lines and around punctuation the cursor is off any word. */
  it('keeps the popup while the cursor crosses a gap in its paragraph', async () => {
    await openPopup();
    moveTo(GAP_OFFSET, 12, 30);

    expect(popup()).not.toBeNull();
  });

  it('hides the popup the moment the cursor leaves the paragraph', async () => {
    await openPopup();
    leaveParagraph();

    expect(popup()).toBeNull();
  });

  /**
   * The popup is offset from the cursor, so reaching it crosses whatever the
   * page has between - often more Chinese. None of it is what the reader
   * asked about.
   */
  it('keeps the popup and its word while Shift is held on the way to it', async () => {
    await openPopup();
    const lookups = vi.mocked(client.lookupWord).mock.calls.length;

    hoverAt(2, { shiftKey: true });
    await nextFrame();
    leaveParagraph({ shiftKey: true });
    await nextFrame();
    hoverPopup();

    expect(popup()).not.toBeNull();
    expect(vi.mocked(client.lookupWord).mock.calls.length).toBe(lookups);
  });

  it('leaves Shift alone while a field has focus', async () => {
    document.querySelector('input')!.focus();
    await openPopup();
    leaveParagraph({ shiftKey: true });

    expect(popup()).toBeNull();
  });

  it('does not hold the popup for a Shift-held move made with a button down', async () => {
    // Shift with a drag is extending a selection.
    await openPopup();
    leaveParagraph({ shiftKey: true, buttons: 1 });

    expect(popup()).toBeNull();
  });

  /**
   * The popup is positioned against the viewport, so scrolling has to move it
   * by hand or it hangs over whatever scrolled into the word's place.
   */
  it('travels with the page when it scrolls', async () => {
    await openPopup();
    const before = popup()!.style.top;

    window.scrollY = 120;
    document.dispatchEvent(new Event('scroll'));

    expect(parseFloat(popup()!.style.top)).toBe(parseFloat(before) - 120);
  });

  it('closes the popup on Escape, and the dwell with it', async () => {
    await openPopup();

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(popup()).toBeNull();
    // The word was dismissed before the dwell, so it was not studied.
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(client.trackWord).not.toHaveBeenCalled();
  });
});
