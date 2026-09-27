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
    lookupWord: vi.fn(async () => ({ definition: DEFINITION })),
    trackWord: vi.fn(async () => {}),
    pinWord: vi.fn(async () => {}),
    markKnown: vi.fn(async () => {}),
  };
}

describe('instant lookup', () => {
  let client: PopupClient;
  let manager: ChineseHoverPopupManager;

  function hoverAt(offset: number, init: MouseEventInit = {}): void {
    const textNode = document.body.querySelector('p')!.firstChild as Text;
    document.caretRangeFromPoint = vi.fn(() => ({
      startContainer: textNode,
      startOffset: offset,
    })) as unknown as Document['caretRangeFromPoint'];

    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 10 + offset, clientY: 10, bubbles: true, ...init })
    );
  }

  function pressShift(target: EventTarget = document.body): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    const paragraph = document.createElement('p');
    paragraph.textContent = '我寫好字。';
    const field = document.createElement('input');
    document.body.replaceChildren(paragraph, field);
    client = createClient();
    manager = new ChineseHoverPopupManager(document, client);
    manager.init();
  });

  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
  });

  it('looks the word up at once when hovered with Shift held', async () => {
    hoverAt(2, { shiftKey: true });

    expect(client.lookupWord).toHaveBeenCalledTimes(1);
  });

  it('looks up the word under a resting cursor when Shift is pressed', async () => {
    hoverAt(2);
    expect(client.lookupWord).not.toHaveBeenCalled();

    pressShift();

    expect(client.lookupWord).toHaveBeenCalledTimes(1);
    // The pause it skipped does not fire a second lookup afterwards.
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.lookupWord).toHaveBeenCalledTimes(1);
  });

  it('leaves Shift alone while a field has focus', async () => {
    const field = document.querySelector('input')!;
    field.focus();

    hoverAt(2, { shiftKey: true });
    pressShift(field);

    expect(client.lookupWord).not.toHaveBeenCalled();
  });

  it('does not rush a Shift-held move made with a button down', async () => {
    // Shift with a drag is extending a selection.
    hoverAt(2, { shiftKey: true, buttons: 1 });

    expect(client.lookupWord).not.toHaveBeenCalled();
  });

  it('does nothing when no word is waiting', async () => {
    pressShift();

    expect(client.lookupWord).not.toHaveBeenCalled();
  });

  it('closes the popup on Escape, and a pending lookup with it', async () => {
    hoverAt(2, { shiftKey: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(document.getElementById('chinese-hover-popup')).not.toBeNull();

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(document.getElementById('chinese-hover-popup')).toBeNull();
    // The word was dismissed before the dwell, so it was not studied.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.trackWord).not.toHaveBeenCalled();
  });
});
