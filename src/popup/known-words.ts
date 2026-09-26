import { WORD_KEY_PREFIX } from '../shared/statistics-store.js';
import { isKnown } from '../shared/statistics-utils.js';
import type { PageWord, SegmentedWord, Statistics, WordStatistics } from '../shared/types.js';

/** The words the reader knows, by the rule the stats page's coverage uses. */
export function knownWordsIn(statistics: Statistics, now: Date = new Date()): Set<string> {
  const known = new Set<string>();
  for (const [word, stat] of Object.entries(statistics)) {
    if (isKnown(stat, now)) known.add(word);
  }
  return known;
}

/**
 * The dictionary's words joined with the reader's record. A word is known in
 * whichever script it was learnt in. Names are dropped: whether a reader has
 * met a character's name says nothing about the level of the text.
 */
export function classifyWords(
  runs: readonly string[],
  segmented: readonly SegmentedWord[][],
  known: ReadonlySet<string>,
): PageWord[][] {
  return runs.map((run, i) =>
    (segmented[i] ?? [])
      .filter(word => !word.name)
      .map(({ start, end, variants }) => ({
        start,
        end,
        known: known.has(run.slice(start, end)) || (variants ?? []).some(form => known.has(form)),
      })),
  );
}

/**
 * Whether a storage change moved any word into or out of being known. Nearly
 * every write is a sighting — a count going up — which leaves every verdict
 * as it was, so both the worker's cache and the page's marks ignore those and
 * wait for a review, a retirement or a word being put back.
 */
export function changesKnown(changes: Record<string, chrome.storage.StorageChange>): boolean {
  const now = new Date();

  for (const [key, change] of Object.entries(changes)) {
    if (!key.startsWith(WORD_KEY_PREFIX)) continue;

    const before = change.oldValue ? isKnown(change.oldValue as WordStatistics, now) : false;
    const after = change.newValue ? isKnown(change.newValue as WordStatistics, now) : false;
    if (before !== after) return true;
  }

  return false;
}

/**
 * The known set, built from the record on first use and kept until a change
 * could alter it. A page is segmented in slices, and reading and reconciling
 * the whole record once per slice would cost more than the segmentation.
 */
export class KnownWordsCache {
  private cached: Promise<Set<string>> | null = null;

  constructor(private readonly read: () => Promise<Statistics>) {
    chrome.storage.onChanged.addListener((changes) => {
      if (changesKnown(changes)) this.cached = null;
    });
  }

  get(): Promise<Set<string>> {
    if (!this.cached) {
      const pending = this.read().then(statistics => knownWordsIn(statistics));
      // A failed read is not remembered, so the next slice tries again.
      pending.catch(() => {
        if (this.cached === pending) this.cached = null;
      });
      this.cached = pending;
    }
    return this.cached;
  }
}
