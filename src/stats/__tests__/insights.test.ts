import { describe, it, expect } from 'vitest';
import {
  activityDays,
  activityLevel,
  bandCoverage,
  currentStreak,
  forecast,
  isKnown,
  retentionByDirection,
  BAND_SIZES,
} from '../insights.js';
import { bandForRank } from '../../shared/frequency.js';
import { LEECH_LAPSES } from '../../shared/scheduler.js';
import { DIRECTION_FIELD } from '../../shared/statistics-utils.js';
import type { FlashcardProgress, FrequencyBand, Statistics } from '../../shared/types.js';

// Local noon on a Sunday, so day boundaries hold in whatever zone this runs in.
const NOW = new Date(2026, 8, 27, 12).getTime();
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function progress(extra: Partial<FlashcardProgress> = {}, srs: Partial<NonNullable<FlashcardProgress['srs']>> = {}): FlashcardProgress {
  return {
    reviews: 4,
    correct: 3,
    consecutiveCorrect: 2,
    srs: {
      due: NOW + DAY_MS,
      stability: 5,
      difficulty: 5,
      scheduledDays: 5,
      learningSteps: 0,
      lapses: 0,
      state: 2,
      ...srs,
    },
    ...extra,
  };
}

function word(extra: Partial<Statistics[string]> = {}): Statistics[string] {
  return { count: 3, firstSeen: 1, lastSeen: 2, ...extra };
}

describe('forecast', () => {
  it('has one entry per day starting today', () => {
    const days = forecast({}, NOW);

    expect(days).toHaveLength(14);
    expect(days[0]!.start).toBe(new Date(2026, 8, 27).getTime());
    expect(days[13]!.start).toBe(new Date(2026, 9, 10).getTime());
  });

  it('puts overdue cards on today', () => {
    const stats: Statistics = { 我: word({ flashcard: progress({}, { due: NOW - 3 * DAY_MS }) }) };
    expect(forecast(stats, NOW)[0]!.count).toBe(1);
  });

  it('places each direction on the day it falls due', () => {
    const stats: Statistics = {
      朋友: word({
        flashcard: progress({}, { due: NOW + DAY_MS }),
        production: progress({}, { due: NOW + 3 * DAY_MS }),
      }),
    };

    const counts = forecast(stats, NOW).map(day => day.count);
    expect(counts[1]).toBe(1);
    expect(counts[3]).toBe(1);
  });

  it('leaves out cards due past the window and cards of retired words', () => {
    const stats: Statistics = {
      说话: word({ flashcard: progress({}, { due: NOW + 20 * DAY_MS }) }),
      你好: word({ suppressed: true, flashcard: progress({}, { due: NOW + HOUR_MS }) }),
    };

    expect(forecast(stats, NOW).every(day => day.count === 0)).toBe(true);
  });
});

describe('currentStreak', () => {
  it('is zero with nothing logged', () => {
    expect(currentStreak({}, NOW)).toBe(0);
  });

  it('counts back through consecutive days', () => {
    const log = { '2026-09-27': 2, '2026-09-26': 1, '2026-09-25': 5, '2026-09-23': 1 };
    expect(currentStreak(log, NOW)).toBe(3);
  });

  it('keeps yesterday\'s streak alive until today is over', () => {
    const log = { '2026-09-26': 1, '2026-09-25': 1 };
    expect(currentStreak(log, NOW)).toBe(2);
  });

  it('is broken by a whole day missed', () => {
    expect(currentStreak({ '2026-09-25': 4 }, NOW)).toBe(0);
  });
});

describe('activityDays', () => {
  it('starts on a Sunday and ends today', () => {
    const days = activityDays({}, new Date(2026, 8, 30, 12).getTime(), 2);

    expect(days[0]!.key).toBe('2026-09-20');
    expect(days.at(-1)!.key).toBe('2026-09-30');
    expect(days).toHaveLength(11);
  });

  it('carries each day\'s logged count', () => {
    const days = activityDays({ '2026-09-27': 6 }, NOW, 1);
    expect(days).toEqual([{ key: '2026-09-27', count: 6 }]);
  });
});

describe('activityLevel', () => {
  it('draws a day with no reviews as empty', () => {
    expect(activityLevel(0, 10)).toBe(0);
  });

  it('draws even a single review as at least the lightest shade', () => {
    expect(activityLevel(1, 100)).toBe(1);
  });

  it('draws the busiest day as the darkest shade', () => {
    expect(activityLevel(10, 10)).toBe(4);
  });
});

describe('retentionByDirection', () => {
  it('reports every direction the statistics can hold', () => {
    const directions = retentionByDirection({}).map(entry => entry.direction);
    expect(directions).toEqual(Object.keys(DIRECTION_FIELD));
  });

  it('computes accuracy per direction', () => {
    const stats: Statistics = {
      我: word({
        flashcard: progress({ reviews: 4, correct: 3 }),
        production: progress({ reviews: 2, correct: 1 }),
      }),
      朋友: word({ flashcard: progress({ reviews: 4, correct: 1 }) }),
    };

    const [recognition, production, components] = retentionByDirection(stats);
    expect(recognition!.accuracy).toBe(0.5);
    expect(production!.accuracy).toBe(0.5);
    expect(components!.accuracy).toBeUndefined();
  });

  it('ignores reviews recorded before answers were counted', () => {
    const uncounted = progress({ reviews: 10 });
    delete uncounted.correct;
    const stats: Statistics = { 我: word({ flashcard: uncounted }) };

    expect(retentionByDirection(stats)[0]).toMatchObject({ reviews: 0, accuracy: undefined });
  });

  it('leaves retired words out, as the overview does', () => {
    const stats: Statistics = {
      我: word({ suppressed: true, flashcard: progress({ reviews: 4, correct: 0 }) }),
    };

    expect(retentionByDirection(stats)[0]!.reviews).toBe(0);
  });
});

describe('isKnown', () => {
  const now = new Date(NOW);

  it('counts a recognition card that has left its learning steps', () => {
    expect(isKnown(word({ flashcard: progress() }), now)).toBe(true);
  });

  it('does not count a card still being learnt', () => {
    expect(isKnown(word({ flashcard: progress({}, { state: 1 }) }), now)).toBe(false);
  });

  it('does not count a word never reviewed', () => {
    expect(isKnown(word({ pinned: true }), now)).toBe(false);
  });

  it('counts a word the reader retired', () => {
    expect(isKnown(word({ suppressed: true }), now)).toBe(true);
  });

  it('does not count a word buried as a leech', () => {
    const leech = word({
      suppressed: true,
      production: progress({}, { lapses: LEECH_LAPSES }),
    });
    expect(isKnown(leech, now)).toBe(false);
  });
});

describe('BAND_SIZES', () => {
  it('matches the boundaries bands are drawn at', () => {
    let upper = 0;
    for (const band of ['core', 'common', 'frequent', 'uncommon'] as FrequencyBand[]) {
      const lower = upper + 1;
      upper += BAND_SIZES[band]!;
      expect(bandForRank(lower)).toBe(band);
      expect(bandForRank(upper)).toBe(band);
    }
  });
});

describe('bandCoverage', () => {
  it('counts known and tracked words per band', () => {
    const stats: Statistics = {
      我: word({ rank: 2, flashcard: progress() }),
      朋友: word({ rank: 166 }),
      你好: word({ rank: 2021, suppressed: true }),
      蜻蜓: word({ rank: 15065, flashcard: progress() }),
    };

    const coverage = Object.fromEntries(
      bandCoverage(stats, new Date(NOW)).map(entry => [entry.band, entry]),
    );

    expect(coverage.core).toEqual({ band: 'core', known: 1, tracked: 2, size: 1000 });
    expect(coverage.common).toMatchObject({ known: 1, tracked: 1 });
    expect(coverage.uncommon).toMatchObject({ known: 1, tracked: 1, size: 10000 });
    expect(coverage.rare).toMatchObject({ known: 0, tracked: 0, size: undefined });
  });
});
