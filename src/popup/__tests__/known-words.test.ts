import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KnownWordsCache, changesKnown, classifyWords, knownWordsIn } from '../known-words.js';
import type { FlashcardProgress, Statistics, WordStatistics } from '../../shared/types.js';

const NOW = new Date('2026-09-27T12:00:00Z');

const graduated: FlashcardProgress = {
  reviews: 4,
  correct: 4,
  consecutiveCorrect: 4,
  srs: {
    due: NOW.getTime() + 5 * 86_400_000,
    stability: 5,
    difficulty: 5,
    scheduledDays: 5,
    learningSteps: 0,
    lapses: 0,
    state: 2,
  },
};

function word(extra: Partial<WordStatistics> = {}): WordStatistics {
  return { count: 3, firstSeen: 1, lastSeen: 2, ...extra };
}

describe('knownWordsIn', () => {
  it('keeps graduated and retired words and leaves the rest', () => {
    const statistics: Statistics = {
      我: word({ flashcard: graduated }),
      學習: word({ suppressed: true }),
      中文: word({ count: 9 }),
    };

    expect([...knownWordsIn(statistics, NOW)].sort()).toEqual(['我', '學習'].sort());
  });
});

describe('classifyWords', () => {
  it('knows a word learnt in the other script', () => {
    const words = classifyWords(['学习'], [[{ start: 0, end: 2, variants: ['學習'] }]], new Set(['學習']));
    expect(words).toEqual([[{ start: 0, end: 2, known: true }]]);
  });

  it('leaves names out altogether', () => {
    const words = classifyWords(['孔子說'], [[{ start: 0, end: 2, name: true }, { start: 2, end: 3 }]], new Set());
    expect(words).toEqual([[{ start: 2, end: 3, known: false }]]);
  });
});

describe('changesKnown', () => {
  it('ignores a sighting that leaves the verdict as it was', () => {
    expect(changesKnown({
      'word:中文': { oldValue: word({ count: 3 }), newValue: word({ count: 4 }) },
    })).toBe(false);
  });

  it('notices a word being retired', () => {
    expect(changesKnown({
      'word:中文': { oldValue: word(), newValue: word({ suppressed: true }) },
    })).toBe(true);
  });

  it('notices a known word being removed', () => {
    expect(changesKnown({ 'word:我': { oldValue: word({ suppressed: true }) } })).toBe(true);
  });

  it('ignores items that are not words', () => {
    expect(changesKnown({ settings: { oldValue: {}, newValue: { maxCards: 5 } } })).toBe(false);
  });
});

describe('KnownWordsCache', () => {
  type Listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;

  beforeEach(() => {
    vi.mocked(chrome.storage.onChanged.addListener).mockClear();
  });

  function latestListener(): Listener {
    const calls = vi.mocked(chrome.storage.onChanged.addListener).mock.calls;
    return calls[calls.length - 1]![0] as unknown as Listener;
  }

  it('reads the record once for many requests', async () => {
    const read = vi.fn().mockResolvedValue({ 我: word({ suppressed: true }) });
    const cache = new KnownWordsCache(read);

    await cache.get();
    await cache.get();

    expect(read).toHaveBeenCalledTimes(1);
  });

  it('reads again only after a change that moves a verdict', async () => {
    const read = vi.fn().mockResolvedValue({});
    const cache = new KnownWordsCache(read);
    await cache.get();

    latestListener()({ 'word:我': { oldValue: word(), newValue: word({ count: 4 }) } }, 'local');
    await cache.get();
    expect(read).toHaveBeenCalledTimes(1);

    latestListener()({ 'word:我': { oldValue: word(), newValue: word({ suppressed: true }) } }, 'local');
    await cache.get();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('does not keep a failed read', async () => {
    const read = vi.fn()
      .mockRejectedValueOnce(new Error('storage down'))
      .mockResolvedValue({});
    const cache = new KnownWordsCache(read);

    await expect(cache.get()).rejects.toThrow('storage down');
    await expect(cache.get()).resolves.toEqual(new Set());
  });
});
