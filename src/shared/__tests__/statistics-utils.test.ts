import { describe, it, expect } from 'vitest';
import {
  MIN_COUNT,
  applyWordStatus,
  confusionsOf,
  getFlashcardStage,
  isKnown,
  lastReviewedAt,
  mergeStatistics,
  nextDueAt,
  withConfusion,
} from '../statistics-utils.js';
import { LEECH_LAPSES, reviewCard } from '../scheduler.js';
import type { FlashcardProgress, WordStatistics } from '../types.js';

describe('mergeStatistics', () => {
  it('returns empty object when both args are empty', () => {
    expect(mergeStatistics({}, {})).toEqual({});
  });

  it('returns sync-only stats when local is empty', () => {
    const result = mergeStatistics({ 好: { count: 3, firstSeen: 100, lastSeen: 200 } }, {});
    expect(result['好']!.count).toBe(3);
  });

  it('returns local-only stats when sync is empty', () => {
    const result = mergeStatistics({}, { 字: { count: 1, firstSeen: 50, lastSeen: 150 } });
    expect(result['字']!.count).toBe(1);
  });

  // Each area holds a snapshot of the whole record, so the larger count is the
  // later one. Summing counted a sighting that reached both areas twice.
  it('takes the higher count for a word present in both', () => {
    const result = mergeStatistics(
      { 好: { count: 3, firstSeen: 100, lastSeen: 200 } },
      { 好: { count: 2, firstSeen: 50, lastSeen: 150 } }
    );
    expect(result['好']!.count).toBe(3);
  });

  // Sync keeps a fossil of the record from before it outgrew its 8 KB item
  // quota. ORing the two areas' flags made that fossil authoritative, so a
  // retirement could never be undone.
  it('lets local drop a flag the sync copy still carries', () => {
    const result = mergeStatistics(
      { 好: { count: 1, firstSeen: 50, lastSeen: 150, suppressed: true, pinned: true } },
      { 好: { count: 2, firstSeen: 50, lastSeen: 150 } }
    );
    expect(result['好']!.suppressed).toBeUndefined();
    expect(result['好']!.pinned).toBeUndefined();
  });

  it('takes local as the authority on a retirement', () => {
    const result = mergeStatistics(
      { 好: { count: 1, firstSeen: 50, lastSeen: 150 } },
      { 好: { count: 2, firstSeen: 50, lastSeen: 150, suppressed: true } }
    );
    expect(result['好']!.suppressed).toBe(true);
  });

  // Another device retired the word after this one last decided anything
  // about it; letting local decide regardless undid that retirement on sync.
  it('takes the later decision whichever area holds it', () => {
    const retiredElsewhere = mergeStatistics(
      { 好: { count: 1, firstSeen: 50, lastSeen: 150, suppressed: true, statusAt: 300 } },
      { 好: { count: 2, firstSeen: 50, lastSeen: 150, pinned: true, statusAt: 200 } }
    );
    expect(retiredElsewhere['好']).toMatchObject({ suppressed: true, statusAt: 300 });
    expect(retiredElsewhere['好']!.pinned).toBeUndefined();

    const undoneHere = mergeStatistics(
      { 好: { count: 1, firstSeen: 50, lastSeen: 150, suppressed: true, statusAt: 300 } },
      { 好: { count: 2, firstSeen: 50, lastSeen: 150, statusAt: 400 } }
    );
    expect(undoneHere['好']!.suppressed).toBeUndefined();
    expect(undoneHere['好']!.statusAt).toBe(400);
  });

  it('prefers a timed decision over a flag recorded before decisions were timed', () => {
    const result = mergeStatistics(
      { 好: { count: 1, firstSeen: 50, lastSeen: 150, pinned: true, statusAt: 300 } },
      { 好: { count: 2, firstSeen: 50, lastSeen: 150, suppressed: true } }
    );
    expect(result['好']!.pinned).toBe(true);
    expect(result['好']!.suppressed).toBeUndefined();
  });

  // Records written before the two flags were made exclusive can carry both.
  it('drops a pin from a record that was also retired', () => {
    const result = mergeStatistics(
      { 好: { count: 1, firstSeen: 50, lastSeen: 150 } },
      { 好: { count: 2, firstSeen: 50, lastSeen: 150, suppressed: true, pinned: true } }
    );
    expect(result['好']!.suppressed).toBe(true);
    expect(result['好']!.pinned).toBeUndefined();
  });

  it('takes the earliest firstSeen when merging', () => {
    const result = mergeStatistics(
      { 好: { count: 1, firstSeen: 200, lastSeen: 200 } },
      { 好: { count: 1, firstSeen: 50, lastSeen: 100 } }
    );
    expect(result['好']!.firstSeen).toBe(50);
  });

  it('takes the latest lastSeen when merging', () => {
    const result = mergeStatistics(
      { 好: { count: 1, firstSeen: 100, lastSeen: 300 } },
      { 好: { count: 1, firstSeen: 100, lastSeen: 100 } }
    );
    expect(result['好']!.lastSeen).toBe(300);
  });

  it('keeps the context sentence for a word present in both', () => {
    const result = mergeStatistics(
      { 好: { count: 1, firstSeen: 100, lastSeen: 300, context: '你好嗎' } },
      { 好: { count: 1, firstSeen: 100, lastSeen: 100 } }
    );
    expect(result['好']!.contexts).toEqual([{ text: '你好嗎', seen: 100 }]);
    expect(result['好']!.context).toBeUndefined();
  });

  it('pools the sentences of both areas in the order they were met', () => {
    const result = mergeStatistics(
      { 好: { count: 1, firstSeen: 200, lastSeen: 300, context: '較晚才看到的句子' } },
      {
        好: {
          count: 1, firstSeen: 50, lastSeen: 400,
          contexts: [{ text: '最早看到的句子', seen: 50 }, { text: '最近看到的例子', seen: 400 }],
        },
      }
    );
    expect(result['好']!.contexts!.map(c => c.text)).toEqual([
      '最早看到的句子',
      '較晚才看到的句子',
      '最近看到的例子',
    ]);
  });

  it('keeps one copy of a sentence both areas hold', () => {
    const sighting = { text: '你好嗎', seen: 100 };
    const result = mergeStatistics(
      { 好: { count: 1, firstSeen: 100, lastSeen: 300, contexts: [sighting] } },
      { 好: { count: 1, firstSeen: 100, lastSeen: 300, contexts: [sighting] } }
    );
    expect(result['好']!.contexts).toEqual([sighting]);
  });

  it('keeps the corpus rank for a word present in both', () => {
    const result = mergeStatistics(
      { 好: { count: 1, firstSeen: 100, lastSeen: 300, rank: 42 } },
      { 好: { count: 1, firstSeen: 100, lastSeen: 100 } }
    );
    expect(result['好']!.rank).toBe(42);
  });

  it('keeps a word retired in either area retired', () => {
    const result = mergeStatistics(
      { 好: { count: 1, firstSeen: 100, lastSeen: 300 } },
      { 好: { count: 1, firstSeen: 100, lastSeen: 100, suppressed: true } }
    );
    expect(result['好']!.suppressed).toBe(true);
  });

  it('keeps the most recent progress of each direction independently', () => {
    const early = { reviews: 1, consecutiveCorrect: 1, lastReviewed: 100 };
    const late = { reviews: 4, consecutiveCorrect: 4, lastReviewed: 900 };

    const result = mergeStatistics(
      { 好: { count: 1, firstSeen: 1, lastSeen: 2, flashcard: late, production: early } },
      { 好: { count: 1, firstSeen: 1, lastSeen: 2, flashcard: early, production: late } }
    );

    expect(result['好']!.flashcard).toEqual(late);
    expect(result['好']!.production).toEqual(late);
  });

  it('keeps the most recent listening progress', () => {
    const early = { reviews: 1, consecutiveCorrect: 1, lastReviewed: 100 };
    const late = { reviews: 4, consecutiveCorrect: 4, lastReviewed: 900 };

    const result = mergeStatistics(
      { 好: { count: 1, firstSeen: 1, lastSeen: 2, listening: late } },
      { 好: { count: 1, firstSeen: 1, lastSeen: 2, listening: early } }
    );

    expect(result['好']!.listening).toEqual(late);
  });

  it('keeps the higher tally of each mix-up from either side', () => {
    const result = mergeStatistics(
      { 清: { count: 1, firstSeen: 1, lastSeen: 2, confusedWith: { 晴: 3, 情: 1 } } },
      { 清: { count: 1, firstSeen: 1, lastSeen: 2, confusedWith: { 晴: 2, 请: 1 } } },
    );

    expect(result['清']!.confusedWith).toEqual({ 晴: 3, 情: 1, 请: 1 });
  });
});

describe('withConfusion and confusionsOf', () => {
  it('counts each mix-up and lists the most frequent first', () => {
    let stat: WordStatistics = { count: 1, firstSeen: 1, lastSeen: 2 };
    stat = withConfusion(stat, '情');
    stat = withConfusion(stat, '晴');
    stat = withConfusion(stat, '晴');

    expect(stat.confusedWith).toEqual({ 情: 1, 晴: 2 });
    expect(confusionsOf(stat)).toEqual(['晴', '情']);
  });
});

describe('lastReviewedAt and nextDueAt', () => {
  function withSrs(due: number, lastReviewed: number): FlashcardProgress {
    return {
      reviews: 1,
      consecutiveCorrect: 1,
      lastReviewed,
      srs: {
        due,
        stability: 1,
        difficulty: 5,
        scheduledDays: 1,
        learningSteps: 0,
        lapses: 0,
        state: 2,
      },
    };
  }

  const base: WordStatistics = { count: 1, firstSeen: 1, lastSeen: 2 };

  it('has neither for a word with no schedules', () => {
    expect(lastReviewedAt(base)).toBeUndefined();
    expect(nextDueAt(base)).toBeUndefined();
  });

  it('takes the latest review across directions', () => {
    const stat = { ...base, flashcard: withSrs(50, 100), production: withSrs(900, 700) };
    expect(lastReviewedAt(stat)).toBe(700);
  });

  it('takes the soonest due date across directions', () => {
    const stat = { ...base, flashcard: withSrs(900, 100), production: withSrs(50, 700) };
    expect(nextDueAt(stat)).toBe(50);
  });

  it('walks the writing schedule alongside the others', () => {
    // DIRECTION_KEYS is a hand-written list, so a direction missing from it
    // would be silently skipped by every aggregate rather than fail to build.
    const stat = { ...base, flashcard: withSrs(900, 100), writing: withSrs(50, 700) };

    expect(nextDueAt(stat)).toBe(50);
    expect(lastReviewedAt(stat)).toBe(700);
  });

  it('walks the listening schedule alongside the others', () => {
    const stat = { ...base, flashcard: withSrs(900, 100), listening: withSrs(50, 700) };

    expect(nextDueAt(stat)).toBe(50);
    expect(lastReviewedAt(stat)).toBe(700);
  });

  it('counts a schedule that has never been reviewed as reviewed at zero', () => {
    expect(lastReviewedAt({ ...base, flashcard: { reviews: 0, consecutiveCorrect: 0 } })).toBe(0);
  });

  it('ignores a direction with progress but no schedule when taking the due date', () => {
    const stat = { ...base, flashcard: { reviews: 1, consecutiveCorrect: 1 }, production: withSrs(50, 700) };
    expect(nextDueAt(stat)).toBe(50);
  });
});

describe('getFlashcardStage', () => {
  const NOW = new Date('2026-01-01T00:00:00Z');
  const DAY_MS = 86_400_000;

  function drilled(reviews: number): WordStatistics {
    let progress: FlashcardProgress | undefined;
    let at = NOW;
    for (let i = 0; i < reviews; i++) {
      progress = reviewCard(progress, 'easy', at);
      at = new Date(progress.srs!.due);
    }
    return { count: 5, firstSeen: 1, lastSeen: 2, flashcard: progress! };
  }

  it('is new for an enrolled word that has never been reviewed', () => {
    expect(getFlashcardStage({ count: MIN_COUNT, firstSeen: 1, lastSeen: 2 }, NOW)).toBe('new');
  });

  it('is a candidate while the word has been seen too rarely to enrol', () => {
    const stat: WordStatistics = { count: MIN_COUNT - 1, firstSeen: 1, lastSeen: 2 };
    expect(getFlashcardStage(stat, NOW)).toBe('candidate');
  });

  it('counts enrolment against the threshold it is given', () => {
    const stat: WordStatistics = { count: 2, firstSeen: 1, lastSeen: 2 };
    expect(getFlashcardStage(stat, NOW, 2)).toBe('new');
    expect(getFlashcardStage(stat, NOW, 3)).toBe('candidate');
  });

  it('is new for a rarely seen word the reader chose outright', () => {
    const stat: WordStatistics = { count: 1, firstSeen: 1, lastSeen: 2, pinned: true };
    expect(getFlashcardStage(stat, NOW)).toBe('new');
  });

  it('is learning while the word is still in its learning steps', () => {
    const flashcard = reviewCard(undefined, 'good', NOW);
    const stat: WordStatistics = { count: 5, firstSeen: 1, lastSeen: 2, flashcard };
    expect(getFlashcardStage(stat, NOW)).toBe('learning');
  });

  it('is mastered for a durable word reviewed on schedule', () => {
    const stat = drilled(6);
    expect(getFlashcardStage(stat, new Date(stat.flashcard!.lastReviewed!))).toBe('mastered');
  });

  it('decays out of mastered when the review never happens', () => {
    const stat = drilled(6);
    const stability = stat.flashcard!.srs!.stability;
    const neglected = new Date(stat.flashcard!.lastReviewed! + stability * DAY_MS * 10);

    expect(getFlashcardStage(stat, neglected)).toBe('familiar');
  });
});

describe('isKnown', () => {
  const now = new Date('2026-09-27T12:00:00Z');
  const DAY_MS = 86_400_000;

  function progress(srs: Partial<NonNullable<FlashcardProgress['srs']>> = {}): FlashcardProgress {
    return {
      reviews: 4,
      correct: 3,
      consecutiveCorrect: 2,
      srs: {
        due: now.getTime() + DAY_MS,
        stability: 5,
        difficulty: 5,
        scheduledDays: 5,
        learningSteps: 0,
        lapses: 0,
        state: 2,
        ...srs,
      },
    };
  }

  function word(extra: Partial<WordStatistics> = {}): WordStatistics {
    return { count: 3, firstSeen: 1, lastSeen: 2, ...extra };
  }

  it('counts a recognition card that has left its learning steps', () => {
    expect(isKnown(word({ flashcard: progress() }), now)).toBe(true);
  });

  it('does not count a card still being learnt', () => {
    expect(isKnown(word({ flashcard: progress({ state: 1 }) }), now)).toBe(false);
  });

  it('does not count a word never reviewed', () => {
    expect(isKnown(word({ pinned: true }), now)).toBe(false);
  });

  it('counts a word the reader retired', () => {
    expect(isKnown(word({ suppressed: true }), now)).toBe(true);
  });

  it('does not count a word buried as a leech', () => {
    const leech = word({ suppressed: true, production: progress({ lapses: LEECH_LAPSES }) });
    expect(isKnown(leech, now)).toBe(false);
  });
});

describe('applyWordStatus', () => {
  const SEEN: WordStatistics = { count: 3, firstSeen: 1, lastSeen: 2 };

  it('drops the pin when the word is retired', () => {
    const result = applyWordStatus({ ...SEEN, pinned: true }, { suppressed: true });

    expect(result.suppressed).toBe(true);
    expect(result.pinned).toBeUndefined();
  });

  it('drops the retirement when the word is chosen', () => {
    const result = applyWordStatus({ ...SEEN, suppressed: true }, { pinned: true });

    expect(result.pinned).toBe(true);
    expect(result.suppressed).toBeUndefined();
  });

  it('leaves the other flag alone when a decision is withdrawn', () => {
    const result = applyWordStatus({ ...SEEN, pinned: true }, { suppressed: false });
    expect(result.pinned).toBe(true);
  });

  it('times every decision so a merge can order them', () => {
    expect(applyWordStatus(SEEN, { suppressed: false }, 500).statusAt).toBe(500);
    expect(applyWordStatus(SEEN, {}, 500).statusAt).toBeUndefined();
  });
});
