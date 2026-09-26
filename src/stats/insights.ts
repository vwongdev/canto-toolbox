import { dayKey, shiftDay } from '../shared/review-log.js';
import {
  DIRECTION_FIELD,
  isKnown,
  progressFor,
  schedulesOf,
} from '../shared/statistics-utils.js';
import type {
  FrequencyBand,
  ReviewDirection,
  ReviewLog,
  Statistics,
} from '../shared/types.js';
import { bandOf } from './ordering.js';

/**
 * What the overview's figures cannot say on their own: when the work lands,
 * whether study has been steady, which kind of card is being lost, and how
 * far into the common vocabulary the reader has actually got.
 */

export const FORECAST_DAYS = 14;

/** About five months — long enough to show a habit, short enough for the popup. */
export const ACTIVITY_WEEKS = 22;

export interface ForecastDay {
  /** Local midnight at the start of the day. */
  start: number;
  count: number;
}

/**
 * Cards falling due on each of the next `days` local days. Today's column
 * carries everything already owed as well: an overdue card is work for today,
 * not for a day that has passed.
 */
export function forecast(
  statistics: Statistics,
  now: number = Date.now(),
  days: number = FORECAST_DAYS,
): ForecastDay[] {
  const starts = Array.from({ length: days + 1 }, (_, i) => shiftDay(now, i));
  const counts = new Array<number>(days).fill(0);

  for (const stat of Object.values(statistics)) {
    // A retired word's cards are never offered, so they are not owed either.
    if (stat.suppressed) continue;

    for (const progress of schedulesOf(stat)) {
      const due = progress.srs?.due;
      if (due === undefined || due >= starts[days]!) continue;

      const index = starts.findIndex(start => due < start) - 1;
      counts[Math.max(index, 0)]!++;
    }
  }

  return counts.map((count, i) => ({ start: starts[i]!, count }));
}

/**
 * Consecutive days with a review, counted back from today. A day not yet
 * studied does not break the streak until it is over, so the count carries on
 * from yesterday until midnight.
 */
export function currentStreak(log: ReviewLog, now: number = Date.now()): number {
  let day = (log[dayKey(now)] ?? 0) > 0 ? now : shiftDay(now, -1);
  let streak = 0;

  while ((log[dayKey(day)] ?? 0) > 0) {
    streak++;
    day = shiftDay(day, -1);
  }

  return streak;
}

export interface ActivityDay {
  key: string;
  count: number;
}

/**
 * Every day from the first of `weeks` Sunday-started weeks through today, so
 * the calendar lays out in whole columns with today in the last one.
 */
export function activityDays(
  log: ReviewLog,
  now: number = Date.now(),
  weeks: number = ACTIVITY_WEEKS,
): ActivityDay[] {
  const weekday = new Date(now).getDay();
  const first = shiftDay(now, -weekday - (weeks - 1) * 7);
  const total = weekday + (weeks - 1) * 7 + 1;

  return Array.from({ length: total }, (_, i) => {
    const key = dayKey(shiftDay(first, i));
    return { key, count: log[key] ?? 0 };
  });
}

export const ACTIVITY_LEVELS = 4;

/**
 * A day's shade, scaled to the busiest day on show. Any review at all is at
 * least the lightest shade, so a single card is never drawn as a rest day.
 */
export function activityLevel(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(ACTIVITY_LEVELS, Math.ceil((count / max) * ACTIVITY_LEVELS));
}

export interface DirectionRetention {
  direction: ReviewDirection;
  /** Reviews whose answer was counted. */
  reviews: number;
  correct: number;
  accuracy: number | undefined;
}

/**
 * Accuracy per kind of card. One figure across the deck hides the usual
 * pattern — a word recognised easily and not produced at all. Directions are
 * read off `DIRECTION_FIELD`, so a new kind of card appears here unasked.
 */
export function retentionByDirection(statistics: Statistics): DirectionRetention[] {
  const directions = Object.keys(DIRECTION_FIELD) as ReviewDirection[];

  return directions.map(direction => {
    let reviews = 0;
    let correct = 0;

    for (const stat of Object.values(statistics)) {
      // Left out for the same reason the overview leaves them out, so the
      // figures here add up to the accuracy shown above them.
      if (stat.suppressed) continue;

      const progress = progressFor(stat, direction);
      // Reviews from before answers were counted say nothing about accuracy.
      if (!progress || progress.correct === undefined) continue;

      reviews += progress.reviews;
      correct += progress.correct;
    }

    return {
      direction,
      reviews,
      correct,
      accuracy: reviews > 0 ? correct / reviews : undefined,
    };
  });
}

/**
 * Words in each band, as `bandForRank` draws its boundaries. The frequency
 * data stops at rank 20,000, so `uncommon` is the 10,000 after `frequent`;
 * `rare` is everything the corpus does not rank and has no size.
 */
export const BAND_SIZES: Readonly<Record<FrequencyBand, number | undefined>> = {
  core: 1000,
  common: 2000,
  frequent: 7000,
  uncommon: 10000,
  rare: undefined,
};

export interface BandCoverage {
  band: FrequencyBand;
  known: number;
  tracked: number;
  size: number | undefined;
}

export function bandCoverage(statistics: Statistics, now: Date = new Date()): BandCoverage[] {
  const coverage = (Object.keys(BAND_SIZES) as FrequencyBand[]).map(band => ({
    band,
    known: 0,
    tracked: 0,
    size: BAND_SIZES[band],
  }));
  const byBand = new Map(coverage.map(entry => [entry.band, entry]));

  for (const stat of Object.values(statistics)) {
    const entry = byBand.get(bandOf(stat))!;
    entry.tracked++;
    if (isKnown(stat, now)) entry.known++;
  }

  return coverage;
}
