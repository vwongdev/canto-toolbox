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
      componentsWithEntries: ['女'],
    },
  ],
  charactersWithEntries: ['好'],
};

const CHARACTER: DefinitionResult = {
  word: '好',
  mandarin: {
    entries: [
      { traditional: '好', simplified: '好', romanisation: 'hao3', definitions: ['good', 'well'] }
    ]
  },
  cantonese: { entries: [] },
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

const DEFINITIONS: Record<string, DefinitionResult> = {
  '女': COMPONENT,
  '好': CHARACTER,
};

function createClient(): PopupClient {
  return {
    lookupWord: vi.fn((word, cb) => {
      cb({ success: true, type: 'lookup_word', definition: DEFINITIONS[word] ?? WORD });
    }),
    trackWord: vi.fn((_word, cb) => cb({ success: true, type: 'track_word' })),
    pinWord: vi.fn((_word, cb) => cb({ success: true, type: 'track_word' })),
  };
}

const popupWord = () => document.querySelector('.popup-word')?.textContent;
const backButton = () => document.querySelector('.popup-back') as HTMLButtonElement | null;

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

describe('following a component from the popup', () => {
  let client: PopupClient;
  let manager: ChineseHoverPopupManager;

  const componentChip = () =>
    document.querySelector('.popup-etymology-component--link') as HTMLButtonElement | null;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren(document.createTextNode('我寫好字。'));
    client = createClient();
    manager = new ChineseHoverPopupManager(document, client);
    manager.init();
    hoverAt(2);
    // The lookup waits for the cursor to rest on the word.
    vi.advanceTimersByTime(250);
  });

  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
  });

  it('shows the component in place of the word it was reached from', () => {
    componentChip()!.click();

    expect(vi.mocked(client.lookupWord).mock.calls.at(-1)![0]).toBe('女');
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
    await new Promise<void>(resolve => setTimeout(resolve, 300));

    expect(popupWord()).toBe('好字');
    expect(backButton()).toBeNull();
  });
});

describe('following a character of the headword', () => {
  let client: PopupClient;
  let manager: ChineseHoverPopupManager;

  const headwordLink = () =>
    document.querySelector('.popup-word-char--link') as HTMLButtonElement | null;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren(document.createTextNode('我寫好字。'));
    client = createClient();
    manager = new ChineseHoverPopupManager(document, client);
    manager.init();
    hoverAt(2);
    vi.advanceTimersByTime(250);
  });

  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
  });

  it('offers only the characters the dictionaries hold an entry for', () => {
    const characters = Array.from(document.querySelectorAll('.popup-word-char'));

    expect(characters.map(node => node.textContent)).toEqual(['好', '字']);
    expect(characters.map(node => node.tagName)).toEqual(['BUTTON', 'SPAN']);
  });

  it('shows the character in place of the compound it was part of', () => {
    headwordLink()!.click();

    expect(vi.mocked(client.lookupWord).mock.calls.at(-1)![0]).toBe('好');
    expect(popupWord()).toBe('好');
  });

  it('offers the way back to the compound it was reached from', () => {
    headwordLink()!.click();

    expect(backButton()?.textContent).toContain('好字');
    backButton()!.click();
    expect(popupWord()).toBe('好字');
  });

  it('records the character as studied once the popup has been held', () => {
    headwordLink()!.click();
    vi.advanceTimersByTime(400);

    expect(vi.mocked(client.trackWord).mock.calls.at(-1)![0]).toBe('好');
  });

  it('leaves a single-character word a plain heading', () => {
    headwordLink()!.click();

    expect(document.querySelector('.popup-word-char')).toBeNull();
    expect(popupWord()).toBe('好');
  });
});
