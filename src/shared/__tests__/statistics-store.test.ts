import { describe, it, expect, vi } from 'vitest';
import { RedundantStore } from '../redundant-store.js';
import { StorageManager } from '../storage-manager.js';
import { reconcileStatistics } from '../statistics-utils.js';
import type { Statistics, WordStatistics } from '../types.js';

/**
 * The record outgrows `chrome.storage.sync` long before it reaches
 * `MAX_TRACKED_WORDS`, so the two areas hold different words and a write that
 * transformed one of them alone was silently editing a record that did not
 * hold the word it was given.
 */

/** chrome.storage.sync rejects any single item over 8 KB. */
const QUOTA_BYTES_PER_ITEM = 8192;

const KEY = 'wordStatistics';

function fakeArea(quota = Infinity) {
  const held: Record<string, unknown> = {};

  return {
    read: () => (held[KEY] ?? {}) as Statistics,
    area: {
      get: vi.fn(async (keys: string[]) => ({ [keys[0]!]: held[keys[0]!] })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) {
          if (JSON.stringify(value).length > quota) throw new Error('QUOTA_BYTES_PER_ITEM');
          held[key] = value;
        }
      }),
    } as unknown as chrome.storage.StorageArea,
  };
}

/** A word carrying about what one reaches once it is being reviewed. */
function studied(n: number): WordStatistics {
  return {
    count: 3,
    firstSeen: 1,
    lastSeen: 2,
    context: `这是第${n}个词的例句，長度大致是實際記錄下來的樣子`,
    rank: n,
    flashcard: {
      reviews: 3,
      correct: 2,
      consecutiveCorrect: 1,
      lastRating: 'good',
      lastReviewed: 1757700000000,
      srs: {
        due: 1757700000000,
        stability: 12.3456,
        difficulty: 5.4321,
        scheduledDays: 12,
        learningSteps: 0,
        lapses: 0,
        state: 2,
      },
    },
  };
}

/** Track words one at a time, exactly as the popup write path does. */
async function fillPastSyncQuota(store: RedundantStore, words: number) {
  const record: Statistics = {};

  for (let n = 0; n < words; n++) {
    record[`词${n}`] = studied(n);
    await store.mutate<Statistics>(KEY, reconcileStatistics, () => ({ ...record }));
  }
}

describe('writing a record larger than sync can hold', () => {
  it('exhausts the sync item quota well short of the tracked-word cap', () => {
    const record: Statistics = {};
    let words = 0;

    while (JSON.stringify(record).length <= QUOTA_BYTES_PER_ITEM) {
      record[`词${words}`] = studied(words);
      words++;
    }

    expect(words).toBeLessThan(50);
  });

  it('records a retirement for a word only local holds', async () => {
    const sync = fakeArea(QUOTA_BYTES_PER_ITEM);
    const local = fakeArea();
    const store = new RedundantStore(new StorageManager(sync.area, local.area));

    await fillPastSyncQuota(store, 40);

    // The premise: sync stopped keeping up, so the word is local's alone.
    const target = '词39';
    expect(sync.read()[target]).toBeUndefined();
    expect(local.read()[target]).toBeDefined();

    // What set_word_status does.
    await store.mutate<Statistics>(KEY, reconcileStatistics, (existing) => {
      const stat = existing[target];
      if (!stat) return existing;
      return { ...existing, [target]: { ...stat, suppressed: true } };
    });

    const merged = await store.read<Statistics>(KEY, reconcileStatistics);
    expect(merged[target]?.suppressed).toBe(true);
  });

  it('undoes that retirement rather than letting the sync copy restore it', async () => {
    const sync = fakeArea(QUOTA_BYTES_PER_ITEM);
    const local = fakeArea();
    const store = new RedundantStore(new StorageManager(sync.area, local.area));

    // A word retired while the record still fitted sync, so both areas hold it.
    const target = '词0';
    await fillPastSyncQuota(store, 40);
    await store.mutate<Statistics>(KEY, reconcileStatistics, (existing) => ({
      ...existing,
      [target]: { ...existing[target]!, suppressed: true },
    }));

    await store.mutate<Statistics>(KEY, reconcileStatistics, (existing) => {
      const next = { ...existing[target]! };
      delete next.suppressed;
      return { ...existing, [target]: next };
    });

    const merged = await store.read<Statistics>(KEY, reconcileStatistics);
    expect(merged[target]?.suppressed).toBeUndefined();
  });
});
