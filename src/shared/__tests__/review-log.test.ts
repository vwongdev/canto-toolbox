import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  REVIEW_LOG_DAYS,
  REVIEW_LOG_KEY,
  dayKey,
  recordReview,
  shiftDay,
  withReview,
} from '../review-log.js';
import type { ReviewLog } from '../types.js';

// Local noon, so the tests read the same in every time zone they run in.
const NOW = new Date(2026, 8, 27, 12).getTime();

describe('dayKey', () => {
  it('names the local calendar day', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05');
  });
});

describe('shiftDay', () => {
  it('steps across a month boundary', () => {
    expect(dayKey(shiftDay(new Date(2026, 2, 1, 9).getTime(), -1))).toBe('2026-02-28');
  });
});

describe('withReview', () => {
  it('starts a day that has no reviews yet', () => {
    expect(withReview({}, NOW)).toEqual({ '2026-09-27': 1 });
  });

  it('adds to a day already reviewed', () => {
    expect(withReview({ '2026-09-27': 4 }, NOW)['2026-09-27']).toBe(5);
  });

  it('keeps the days inside the window and drops the ones past it', () => {
    const oldest = dayKey(shiftDay(NOW, 1 - REVIEW_LOG_DAYS));
    const expired = dayKey(shiftDay(NOW, -REVIEW_LOG_DAYS));

    const log = withReview({ [oldest]: 2, [expired]: 3 }, NOW);

    expect(log[oldest]).toBe(2);
    expect(log[expired]).toBeUndefined();
  });
});

describe('recordReview', () => {
  let stored: ReviewLog | undefined;

  beforeEach(() => {
    stored = undefined;
    vi.mocked(chrome.storage.local.get).mockImplementation(
      (async () => ({ [REVIEW_LOG_KEY]: stored })) as unknown as typeof chrome.storage.local.get,
    );
    vi.mocked(chrome.storage.local.set).mockImplementation(
      (async (items: Record<string, unknown>) => {
        stored = items[REVIEW_LOG_KEY] as ReviewLog;
      }) as unknown as typeof chrome.storage.local.set,
    );
  });

  it('counts every one of several reviews logged at once', async () => {
    await Promise.all([recordReview(NOW), recordReview(NOW), recordReview(NOW)]);
    expect(stored).toEqual({ '2026-09-27': 3 });
  });

  it('keeps logging after a write fails', async () => {
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('quota'));

    await expect(recordReview(NOW)).rejects.toThrow('quota');
    await recordReview(NOW);

    expect(stored).toEqual({ '2026-09-27': 1 });
  });
});
