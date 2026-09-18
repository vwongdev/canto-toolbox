// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChineseHoverPopupManager } from '../content.js';
import type { PopupClient } from '../popup-client.js';
import type { DefinitionResult } from '../../shared/types.js';

const WORD: DefinitionResult = {
  word: '好字',
  mandarin: {
    entries: [
      { traditional: '好字', simplified: '好字', romanisation: 'hao3 zi4', definitions: ['good handwriting'] }
    ]
  },
  cantonese: { entries: [] },
  etymology: [
    {
      character: '好',
      decomposition: '⿰女子',
      radical: '女',
      etymologyType: 'ideographic',
      linkableComponents: ['女'],
    },
  ],
};

const COMPONENT: DefinitionResult = {
  word: '女',
  mandarin: {
    entries: [
      { traditional: '女', simplified: '女', romanisation: 'nu:3', definitions: ['female', 'woman'] }
    ]
  },
  cantonese: { entries: [] },
};

function createClient(): PopupClient {
  return {
    lookupWord: vi.fn((word, cb) => {
      cb({ success: true, type: 'lookup_word', definition: word === '女' ? COMPONENT : WORD });
    }),
    trackWord: vi.fn((_word, cb) => cb({ success: true, type: 'track_word' })),
    pinWord: vi.fn((_word, cb) => cb({ success: true, type: 'track_word' })),
  };
}

describe('following a component from the popup', () => {
  let client: PopupClient;
  let manager: ChineseHoverPopupManager;

  const popupWord = () => document.querySelector('.popup-word')?.textContent;
  const backButton = () => document.querySelector('.popup-back') as HTMLButtonElement | null;
  const componentChip = () =>
    document.querySelector('.popup-etymology-component--link') as HTMLButtonElement | null;

  /** Put the caret on `offset` of the page's only text node, as a hover would. */
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

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren(document.createTextNode('我寫好字。'));
    client = createClient();
    manager = new ChineseHoverPopupManager(document, client);
    manager.init();
    hoverAt(2);
  });

  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
  });

  it('shows the component in place of the word it was reached from', () => {
    componentChip()!.click();

    expect(client.lookupWord).toHaveBeenLastCalledWith('女', expect.any(Function));
    expect(popupWord()).toBe('女');
  });

  it('records the component as studied once the popup has been held', () => {
    componentChip()!.click();
    vi.advanceTimersByTime(400);

    expect(vi.mocked(client.trackWord).mock.calls.at(-1)![0]).toBe('女');
  });

  it('offers the way back to the word the component came from', () => {
    componentChip()!.click();

    expect(backButton()?.textContent).toContain('好字');
  });

  it('returns to that word without looking it up again', () => {
    componentChip()!.click();
    const lookups = vi.mocked(client.lookupWord).mock.calls.length;

    backButton()!.click();

    expect(popupWord()).toBe('好字');
    expect(vi.mocked(client.lookupWord).mock.calls.length).toBe(lookups);
    expect(backButton()).toBeNull();
  });

  it('offers no way back before a component has been followed', () => {
    expect(backButton()).toBeNull();
  });

  it('starts a fresh trail when the cursor moves to another word', async () => {
    componentChip()!.click();
    // Moves are coalesced onto the animation frame, which no fake timer drives,
    // so the hover that opened the popup has to clear before another is seen.
    vi.useRealTimers();
    await new Promise<void>(resolve => {
      requestAnimationFrame(() => resolve());
    });
    hoverAt(0);

    expect(popupWord()).toBe('好字');
    expect(backButton()).toBeNull();
  });
});
