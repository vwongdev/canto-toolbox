import { describe, it, expect } from 'vitest';
import {
  MAX_CONTEXTS,
  addContext,
  contextsOf,
  isSameSentence,
  mergeContexts,
  sourceFrom,
} from '../word-contexts.js';
import type { ContextSighting } from '../types.js';

const DIFFERENT_SENTENCES = [
  '我今天去學校上課',
  '他們在學校門口等你',
  '這間學校很有名',
  '學校放假了嗎',
  '你讀哪一間學校',
  '學校旁邊有間茶餐廳',
  '明天學校開運動會',
];

function sightings(texts: string[]): ContextSighting[] {
  return texts.map((text, seen) => ({ text, seen }));
}

describe('contextsOf', () => {
  it('reads a sentence stored in the old single form as met on the first sighting', () => {
    expect(contextsOf({ count: 1, firstSeen: 7, lastSeen: 9, context: '你好嗎' })).toEqual([
      { text: '你好嗎', seen: 7 },
    ]);
  });

  it('is empty for a word met in no sentence', () => {
    expect(contextsOf({ count: 1, firstSeen: 7, lastSeen: 9 })).toEqual([]);
  });
});

describe('isSameSentence', () => {
  it('ignores punctuation and spacing', () => {
    expect(isSameSentence('你好，歡迎光臨！', '你好 歡迎光臨')).toBe(true);
  });

  it('matches a snippet cut from the same sentence', () => {
    expect(isSameSentence('歡迎光臨', '你好，歡迎光臨')).toBe(true);
  });

  // A long sentence is windowed around the hovered character, so hovering
  // another character of it shifts the window.
  it('matches the same long sentence windowed a few characters apart', () => {
    const sentence = '香港的天氣越來越熱，夏天的時候大家都喜歡去海灘游水或者留在商場裡面吹冷氣，晚上再出去食飯';
    expect(isSameSentence(sentence.slice(0, 40), sentence.slice(3, 43))).toBe(true);
  });

  it('tells apart different sentences around the same word', () => {
    expect(isSameSentence('我今天去學校上課', '他們在學校門口等你')).toBe(false);
  });
});

describe('addContext', () => {
  it('leaves the list alone for a sentence it already holds', () => {
    const held = sightings(['你好嗎']);
    expect(addContext(held, { text: '你好嗎？', seen: 5 })).toEqual(held);
  });

  it('gives a held sentence the page it lacked', () => {
    const source = { url: 'https://example.com/' };
    expect(addContext(sightings(['你好嗎']), { text: '你好嗎', source, seen: 5 })).toEqual([
      { text: '你好嗎', source, seen: 0 },
    ]);
  });

  it('keeps the first sentence and the latest of the rest once full', () => {
    const full = sightings(DIFFERENT_SENTENCES.slice(0, MAX_CONTEXTS));
    const next = addContext(full, { text: DIFFERENT_SENTENCES[MAX_CONTEXTS]!, seen: 99 });

    expect(next).toHaveLength(MAX_CONTEXTS);
    expect(next.map(c => c.text)).toEqual([
      DIFFERENT_SENTENCES[0],
      ...DIFFERENT_SENTENCES.slice(2, MAX_CONTEXTS + 1),
    ]);
  });
});

describe('mergeContexts', () => {
  it('keeps what one device meeting every sentence in order would have kept', () => {
    const all = sightings(DIFFERENT_SENTENCES);
    const evens = all.filter((_, i) => i % 2 === 0);
    const odds = all.filter((_, i) => i % 2 === 1);

    expect(mergeContexts(evens, odds)).toEqual(all.reduce<ContextSighting[]>(addContext, []));
  });

  it('keeps the earlier sighting of a sentence both hold', () => {
    expect(mergeContexts([{ text: '你好嗎', seen: 9 }], [{ text: '你好嗎', seen: 3 }])).toEqual([
      { text: '你好嗎', seen: 3 },
    ]);
  });
});

describe('sourceFrom', () => {
  it('keeps the origin and path of a web page', () => {
    expect(sourceFrom('https://news.example.com/2026/09/story-title?utm_source=x#comments', '  A  story ')).toEqual({
      url: 'https://news.example.com/2026/09/story-title',
      title: 'A story',
    });
  });

  it('drops credentials in the address', () => {
    expect(sourceFrom('https://user:pass@example.com/page')?.url).toBe('https://example.com/page');
  });

  it.each([
    'file:///Users/me/notes.html',
    'chrome-extension://abc/src/stats/stats.html',
    'about:blank',
    'not a url',
  ])('keeps nothing of %s, which is not a web page', url => {
    expect(sourceFrom(url, 'Title')).toBeUndefined();
  });

  it.each([
    'http://localhost:5173/',
    'http://127.0.0.1/',
    'http://192.168.1.1/admin',
    'http://10.0.0.8/wiki',
    'http://172.20.1.1/',
    'http://printer.local/',
    'https://wiki.corp.internal/page',
  ])('keeps nothing of %s, on the reader\'s own network', url => {
    expect(sourceFrom(url, 'Title')).toBeUndefined();
  });

  it.each([
    'https://example.com/reset/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    'https://docs.example.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit',
  ])('keeps nothing of %s, whose path looks like a secret', url => {
    expect(sourceFrom(url, 'Title')).toBeUndefined();
  });

  it('keeps a long article slug', () => {
    expect(sourceFrom('https://example.com/a-very-long-article-title-about-2026-events')).toBeDefined();
  });
});
