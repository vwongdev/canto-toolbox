import { describe, it, expect } from 'vitest';
import { nextReviewAt, selectSession, type SessionLimits } from '../session.js';
import { MIN_COUNT } from '../../shared/statistics-utils.js';
import type { Statistics, WordStatistics } from '../../shared/types.js';

const NOW = Date.parse('2026-01-01T00:00:00Z');
const HOUR_MS = 3_600_000;

function tracked(count: number): WordStatistics {
  return { count, firstSeen: 1, lastSeen: 2 };
}

function srs(dueOffsetMs: number, state = 2) {
  return {
    reviews: 1,
    consecutiveCorrect: 1,
    lastReviewed: NOW - HOUR_MS,
    srs: {
      due: NOW + dueOffsetMs,
      stability: 5,
      difficulty: 5,
      scheduledDays: 5,
      learningSteps: 0,
      lapses: 0,
      state,
    },
  };
}

function scheduled(dueOffsetMs: number): WordStatistics {
  return { ...tracked(1), flashcard: srs(dueOffsetMs) };
}

/** The words a session offers, in order, ignoring which card each one is. */
function words(stats: Statistics, now = NOW, limits?: SessionLimits): string[] {
  return selectSession(stats, now, {}, limits).map(card => card.word);
}

describe('selectSession', () => {
  it('excludes words whose every card is scheduled ahead', () => {
    const stats: Statistics = {
      你好: { ...tracked(1), flashcard: srs(HOUR_MS), production: srs(HOUR_MS) },
    };
    expect(selectSession(stats, NOW)).toEqual([]);
  });

  it('includes words whose due date has passed', () => {
    const stats: Statistics = { 你好: scheduled(-HOUR_MS) };
    expect(selectSession(stats, NOW)).toEqual([
      { word: '你好', direction: 'recognition' },
    ]);
  });

  it('orders due reviews most overdue first', () => {
    const stats: Statistics = {
      最近: scheduled(-HOUR_MS),
      很久: scheduled(-100 * HOUR_MS),
      中間: scheduled(-10 * HOUR_MS),
    };

    expect(words(stats)).toEqual(['很久', '中間', '最近']);
  });

  it('gates unseen words on the exposure threshold', () => {
    const stats: Statistics = { 幾次: tracked(MIN_COUNT - 1), 很多次: tracked(MIN_COUNT) };
    expect(words(stats)).toEqual(['很多次']);
  });

  it('lets a pinned word skip the exposure threshold', () => {
    const stats: Statistics = { 一次: { ...tracked(1), pinned: true } };
    expect(words(stats)).toEqual(['一次']);
  });

  it('leaves retired words out of the session', () => {
    const stats: Statistics = {
      退休: { ...scheduled(-HOUR_MS), suppressed: true },
      繼續: scheduled(-HOUR_MS),
    };

    expect(words(stats)).toEqual(['繼續']);
  });

  it('keeps a reviewed word eligible however rarely it was hovered', () => {
    const stats: Statistics = { 你好: scheduled(-HOUR_MS) };
    expect(stats['你好']!.count).toBeLessThan(2);
    expect(words(stats)).toEqual(['你好']);
  });

  it('puts due reviews ahead of unseen words', () => {
    const stats: Statistics = { 新字: tracked(5), 舊字: scheduled(-HOUR_MS) };
    expect(words(stats)[0]).toBe('舊字');
  });

  it('introduces the commonest unseen words first', () => {
    const stats: Statistics = {
      罕見: { ...tracked(5), rank: 9000 },
      常見: { ...tracked(5), rank: 50 },
      中等: { ...tracked(5), rank: 1200 },
    };

    expect(words(stats)).toEqual(['常見', '中等', '罕見']);
  });

  it('puts words the corpus never ranked behind ranked ones', () => {
    const stats: Statistics = {
      沒有排名: tracked(50),
      有排名: { ...tracked(5), rank: 8000 },
    };

    expect(words(stats)).toEqual(['有排名', '沒有排名']);
  });

  it('falls back to hover count when neither word is ranked', () => {
    const stats: Statistics = { 很少: tracked(5), 很多: tracked(20) };
    expect(words(stats)).toEqual(['很多', '很少']);
  });

  it('caps how many unseen words enter one session', () => {
    const stats: Statistics = {};
    for (let i = 0; i < 30; i++) stats[`字${i}`] = tracked(5);

    expect(selectSession(stats, NOW)).toHaveLength(10);
  });

  it('is empty when nothing is tracked', () => {
    expect(selectSession({}, NOW)).toEqual([]);
  });

  describe('with the reader\'s limits', () => {
    const limits = { maxCards: 3, maxNewCards: 2, minCount: 2 };

    it('caps unseen words at the reader\'s new-card limit', () => {
      const stats: Statistics = {};
      for (let i = 0; i < 30; i++) stats[`字${i}`] = tracked(5);

      expect(selectSession(stats, NOW, {}, limits)).toHaveLength(2);
    });

    it('fills the session with due reviews up to the reader\'s size before any new word', () => {
      const stats: Statistics = {
        一: scheduled(-HOUR_MS),
        二: scheduled(-2 * HOUR_MS),
        三: scheduled(-3 * HOUR_MS),
        四: scheduled(-4 * HOUR_MS),
        新: tracked(5),
      };

      expect(words(stats, NOW, limits)).toEqual(['四', '三', '二']);
    });

    it('enrols unseen words at the reader\'s threshold', () => {
      const stats: Statistics = { 一次: tracked(1), 兩次: tracked(2) };
      expect(words(stats, NOW, limits)).toEqual(['兩次']);
    });

    it('offers no new cards when the reader has turned them off', () => {
      const stats: Statistics = { 新: tracked(5), 舊: scheduled(-HOUR_MS) };
      expect(words(stats, NOW, { ...limits, maxNewCards: 0 })).toEqual(['舊']);
    });
  });

  it('carries the context sentence on the card', () => {
    const stats: Statistics = { 你好: { ...scheduled(-HOUR_MS), context: '你好嗎' } };
    expect(selectSession(stats, NOW)[0]!.context).toBe('你好嗎');
  });
});

describe('selectSession card directions', () => {
  it('introduces production once recognition has left its learning steps', () => {
    const stats: Statistics = { 你好: { ...tracked(5), flashcard: srs(HOUR_MS) } };

    expect(selectSession(stats, NOW)).toEqual([
      { word: '你好', direction: 'production' },
    ]);
  });

  it('withholds production while recognition is still being learned', () => {
    const stats: Statistics = { 你好: { ...tracked(5), flashcard: srs(HOUR_MS, 1) } };
    expect(selectSession(stats, NOW)).toEqual([]);
  });

  it('introduces a components card only for a decomposable character', () => {
    const withParts: Statistics = {
      好: { ...tracked(5), decomposable: true, flashcard: srs(HOUR_MS), production: srs(HOUR_MS) },
    };
    const withoutParts: Statistics = {
      好: { ...tracked(5), flashcard: srs(HOUR_MS), production: srs(HOUR_MS) },
    };

    expect(selectSession(withParts, NOW)).toEqual([{ word: '好', direction: 'components' }]);
    expect(selectSession(withoutParts, NOW)).toEqual([]);
  });

  it('introduces a writing card only for a character with stroke data', () => {
    const base = { ...tracked(5), flashcard: srs(HOUR_MS), production: srs(HOUR_MS) };
    const withStrokes: Statistics = { 好: { ...base, writable: true } };
    const withoutStrokes: Statistics = { 好: { ...base } };

    expect(selectSession(withStrokes, NOW)).toEqual([{ word: '好', direction: 'writing' }]);
    expect(selectSession(withoutStrokes, NOW)).toEqual([]);
  });

  it('does not treat a decomposable character as writable', () => {
    // Stroke data and named parts come from different files, and a character
    // can have either without the other.
    const stats: Statistics = {
      好: { ...tracked(5), decomposable: true, flashcard: srs(HOUR_MS), production: srs(HOUR_MS) },
    };

    expect(selectSession(stats, NOW)).toEqual([{ word: '好', direction: 'components' }]);
  });

  it('introduces writing after the other three directions', () => {
    const stats: Statistics = {
      好: {
        ...tracked(5),
        decomposable: true,
        writable: true,
        flashcard: srs(HOUR_MS),
        production: srs(HOUR_MS),
        components: srs(HOUR_MS),
      },
    };

    expect(selectSession(stats, NOW)).toEqual([{ word: '好', direction: 'writing' }]);
  });

  it('withholds writing while recognition is still being learned', () => {
    const stats: Statistics = {
      好: { ...tracked(5), writable: true, flashcard: srs(HOUR_MS, 1) },
    };

    expect(selectSession(stats, NOW)).toEqual([]);
  });

  it('answers a due writing card', () => {
    const stats: Statistics = {
      好: {
        ...tracked(5),
        writable: true,
        flashcard: srs(HOUR_MS),
        production: srs(HOUR_MS),
        components: srs(HOUR_MS),
        writing: srs(-HOUR_MS),
      },
    };

    expect(selectSession(stats, NOW)).toEqual([{ word: '好', direction: 'writing' }]);
  });

  it('offers a word only once per session, taking the most overdue card', () => {
    const stats: Statistics = {
      你好: {
        ...tracked(5),
        flashcard: srs(-HOUR_MS),
        production: srs(-100 * HOUR_MS),
      },
    };

    expect(selectSession(stats, NOW)).toEqual([
      { word: '你好', direction: 'production' },
    ]);
  });

  it('answers a due card before introducing a new direction of the same word', () => {
    const stats: Statistics = { 你好: { ...tracked(5), flashcard: srs(-HOUR_MS) } };

    expect(selectSession(stats, NOW)).toEqual([
      { word: '你好', direction: 'recognition' },
    ]);
  });
});

describe('selectSession listening cards', () => {
  const LISTENING = { listening: true };

  it('introduces listening after production when a voice can play it', () => {
    const stats: Statistics = {
      你好: { ...tracked(5), flashcard: srs(HOUR_MS), production: srs(HOUR_MS) },
    };

    expect(selectSession(stats, NOW, LISTENING)).toEqual([
      { word: '你好', direction: 'listening' },
    ]);
  });

  it('introduces listening before components', () => {
    const stats: Statistics = {
      好: { ...tracked(5), decomposable: true, flashcard: srs(HOUR_MS), production: srs(HOUR_MS) },
    };

    expect(selectSession(stats, NOW, LISTENING)).toEqual([{ word: '好', direction: 'listening' }]);
  });

  it('withholds listening while recognition is still being learned', () => {
    const stats: Statistics = { 你好: { ...tracked(5), flashcard: srs(HOUR_MS, 1) } };
    expect(selectSession(stats, NOW, LISTENING)).toEqual([]);
  });

  it('never introduces listening without a voice', () => {
    const stats: Statistics = {
      你好: { ...tracked(5), flashcard: srs(HOUR_MS), production: srs(HOUR_MS) },
    };

    expect(selectSession(stats, NOW)).toEqual([]);
  });

  it('answers a due listening card', () => {
    const stats: Statistics = {
      你好: { ...tracked(5), flashcard: srs(HOUR_MS), production: srs(HOUR_MS), listening: srs(-HOUR_MS) },
    };

    expect(selectSession(stats, NOW, LISTENING)).toEqual([
      { word: '你好', direction: 'listening' },
    ]);
  });

  it('passes over a due listening card it cannot play for the word’s other cards', () => {
    // The overdue listening card would otherwise win the word's one slot and
    // then have nothing to play it with.
    const stats: Statistics = {
      你好: {
        ...tracked(5),
        flashcard: srs(-HOUR_MS),
        production: srs(HOUR_MS),
        listening: srs(-100 * HOUR_MS),
      },
    };

    expect(selectSession(stats, NOW)).toEqual([{ word: '你好', direction: 'recognition' }]);
  });
});

describe('nextReviewAt', () => {
  it('leaves out a listening card this page cannot play', () => {
    // Otherwise the empty screen would promise a review that is already
    // overdue and will never be shown.
    const stats: Statistics = {
      你好: { ...tracked(5), flashcard: srs(HOUR_MS), listening: srs(-HOUR_MS) },
    };

    expect(nextReviewAt(stats)).toBe(NOW + HOUR_MS);
    expect(nextReviewAt(stats, { listening: true })).toBe(NOW - HOUR_MS);
  });
});
