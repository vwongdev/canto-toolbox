import { describe, it, expect } from 'vitest';
import { decodeWord, encodeWord } from '../stored-word.js';
import type { FlashcardProgress, WordStatistics } from '../types.js';

const card: FlashcardProgress = {
  reviews: 12,
  correct: 10,
  consecutiveCorrect: 4,
  lastRating: 'easy',
  lastReviewed: 1760000000000,
  srs: {
    due: 1761234567890,
    stability: 23.45,
    difficulty: 5.67,
    scheduledDays: 23,
    learningSteps: 0,
    lapses: 1,
    state: 2,
  },
};

const everyField: WordStatistics = {
  count: 37,
  firstSeen: 1750000000000,
  lastSeen: 1760000000000,
  flashcard: card,
  production: { reviews: 1, consecutiveCorrect: 0 },
  listening: { reviews: 2, consecutiveCorrect: 1, lastRating: 'again' },
  contrast: card,
  components: card,
  writing: card,
  contexts: [
    { text: '我在學習', seen: 1 },
    { text: '學習中文', seen: 2, source: { url: 'https://example.com/a' } },
    { text: '好好學習', seen: 3, source: { url: 'https://example.com/b', title: '例子' } },
  ],
  context: '舊的例句',
  rank: 1234,
  confusedWith: { 學問: 2 },
  decomposable: true,
  writable: false,
  suppressed: true,
  pinned: false,
  statusAt: 1755000000000,
};

const roundTrip = (entry: WordStatistics) =>
  decodeWord(JSON.parse(JSON.stringify(encodeWord(entry))) as Record<string, unknown>);

describe('stored word encoding', () => {
  it('round-trips every field', () => {
    expect(roundTrip(everyField)).toEqual(everyField);
  });

  it('keeps fields it has no short form for, a card\'s included', () => {
    const entry = {
      count: 1,
      firstSeen: 1,
      lastSeen: 2,
      futureField: { a: 1 },
      flashcard: { ...card, futureCardField: 3 },
      contexts: [{ text: '句子', seen: 1, futureSightingField: true }],
    } as unknown as WordStatistics;

    expect(roundTrip(entry)).toEqual(entry);
  });

  it('takes a third of the bytes plain JSON did for a reviewed word', () => {
    const synced = { ...everyField };
    delete synced.contexts;
    delete synced.context;
    const compact = JSON.stringify(encodeWord(synced)).length;
    expect(compact * 3).toBeLessThan(JSON.stringify(synced).length);
  });
});
