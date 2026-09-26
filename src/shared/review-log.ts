import type { ReviewLog } from './types.js';

/**
 * How many cards were answered on each local calendar day. The statistics
 * record keeps only each card's latest review, so a streak or a calendar of
 * past study cannot be recovered from it — this log is the one place the days
 * themselves are kept.
 *
 * It is its own key in `chrome.storage.local` rather than a field of the
 * statistics record: it grows by the day rather than by the word, it has no
 * business in sync's 8 KB item quota, and nothing about it needs reconciling
 * between devices.
 */
export const REVIEW_LOG_KEY = 'reviewLog';

/** A year of days, so the calendar has history to draw and the key stays small. */
export const REVIEW_LOG_DAYS = 366;

/**
 * The reader's own calendar day, as `YYYY-MM-DD`. A UTC day would split one
 * evening's study across two squares for anyone east or west of Greenwich.
 */
export function dayKey(time: number): string {
  const date = new Date(time);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The local day `offset` days from the one `time` falls in. Stepped through the
 * calendar rather than by 24 hours, which would land on the wrong day either
 * side of a daylight-saving change.
 */
export function shiftDay(time: number, offset: number): number {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset).getTime();
}

/** The log with one more review today, and days past the window dropped. */
export function withReview(log: ReviewLog, now: number): ReviewLog {
  // Keys sort as dates, so the cutoff is a plain string comparison.
  const cutoff = dayKey(shiftDay(now, 1 - REVIEW_LOG_DAYS));
  const next: ReviewLog = {};

  for (const [day, count] of Object.entries(log)) {
    if (day >= cutoff) next[day] = count;
  }

  const today = dayKey(now);
  next[today] = (next[today] ?? 0) + 1;
  return next;
}

export async function readReviewLog(): Promise<ReviewLog> {
  const stored = (await chrome.storage.local.get([REVIEW_LOG_KEY]))[REVIEW_LOG_KEY];
  return stored && typeof stored === 'object' ? (stored as ReviewLog) : {};
}

/**
 * Each write waits for the one before it. Ratings arrive faster than a
 * read-modify-write completes, and two overlapping ones would both read the
 * same count and one review would be lost.
 */
let pending: Promise<void> = Promise.resolve();

export function recordReview(now: number = Date.now()): Promise<void> {
  const write = pending.then(async () => {
    const log = await readReviewLog();
    await chrome.storage.local.set({ [REVIEW_LOG_KEY]: withReview(log, now) });
  });

  // A failed write must not wedge every write queued behind it.
  pending = write.catch(() => {});
  return write;
}
