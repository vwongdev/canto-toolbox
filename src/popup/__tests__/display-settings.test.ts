// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChineseHoverPopupManager } from '../content.js';
import type { PopupClient } from '../popup-client.js';
import type { DefinitionResult } from '../../shared/types.js';
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings.js';

const WORD: DefinitionResult = {
  word: '学习',
  mandarin: {
    entries: [
      { traditional: '學習', simplified: '学习', romanisation: 'xue2 xi2', definitions: ['to learn'] }
    ]
  },
  cantonese: {
    entries: [
      { traditional: '學習', simplified: '学习', romanisation: 'hok6 zaap6', definitions: ['to learn'] }
    ]
  },
  charactersWithEntries: ['学'],
};

function createClient(): PopupClient {
  return {
    lookupWord: vi.fn((_word, cb) => cb({ success: true, type: 'lookup_word', definition: WORD })),
    trackWord: vi.fn((_word, cb) => cb({ success: true, type: 'track_word' })),
    pinWord: vi.fn((_word, cb) => cb({ success: true, type: 'track_word' })),
    markKnown: vi.fn((_word, _known, cb) => cb({ success: true, type: 'mark_known' })),
  };
}

describe('the popup drawn with the reader\'s settings', () => {
  let manager: ChineseHoverPopupManager;

  function showWith(settings: Partial<Settings>): void {
    manager.applySettings({ ...DEFAULT_SETTINGS, ...settings });

    const textNode = document.body.firstChild as Text;
    document.caretRangeFromPoint = vi.fn(() => ({
      startContainer: textNode,
      startOffset: 0,
    })) as unknown as Document['caretRangeFromPoint'];
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10, bubbles: true }));
    vi.advanceTimersByTime(250);
  }

  const labels = () =>
    Array.from(document.querySelectorAll('.definition-label'), el => el.textContent);

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren(document.createTextNode('学习'));
    manager = new ChineseHoverPopupManager(document, createClient());
    manager.init();
  });

  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
  });

  it('leads with Mandarin by default', () => {
    showWith({});
    expect(labels()).toEqual(['Mandarin', 'Cantonese']);
  });

  it('leads with Cantonese when the reader asks for it', () => {
    showWith({ primaryLanguage: 'cantonese' });
    expect(labels()).toEqual(['Cantonese', 'Mandarin']);
  });

  it('heads the popup in the reader\'s script, naming the page\'s form beside it', () => {
    showWith({ script: 'traditional' });

    expect(document.querySelector('.popup-word')!.textContent).toBe('學習');
    expect(document.querySelector('.definition-variant')!.textContent).toBe('Simplified学习');
  });

  it('keeps the characters that have entries followable in the other script', () => {
    showWith({ script: 'traditional' });

    const characters = Array.from(document.querySelectorAll('.popup-word-char'));
    expect(characters.map(node => node.tagName)).toEqual(['BUTTON', 'SPAN']);
  });

  it('withholds the readings until asked for', () => {
    showWith({ hideRomanisation: true });

    expect(document.querySelector('.definition-pinyin')).toBeNull();
    expect(document.querySelectorAll('.romanisation-reveal')).toHaveLength(2);
  });
});
