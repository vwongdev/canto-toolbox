import { describe, it, expect, vi } from 'vitest';
import {
  LEGACY_STATISTICS_KEY,
  SYNC_BUDGET_BYTES,
  StatisticsStore,
  syncSelection,
} from '../statistics-store.js';
import { SYNC_QUOTAS, asItems, fakeArea } from '../../__tests__/fake-storage.js';
import type { Statistics, WordStatistics } from '../types.js';

/** A word carrying about what one reaches once it is being reviewed. */
function studied(n: number, lastReviewed = 1757700000000 + n): WordStatistics {
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
      lastReviewed,
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

const seen = (count = 1): WordStatistics => ({ count, firstSeen: 1, lastSeen: 2 });

function setup(local: Record<string, unknown> = {}, sync: Record<string, unknown> = {}) {
  const syncArea = fakeArea(sync, SYNC_QUOTAS);
  const localArea = fakeArea(local);
  return { sync: syncArea, local: localArea, store: new StatisticsStore(syncArea.area, localArea.area) };
}

describe('StatisticsStore.read', () => {
  it('reconciles the words both areas hold', async () => {
    const { store } = setup(
      asItems({ 你好: { count: 2, firstSeen: 1, lastSeen: 9 }, 本地: seen() }),
      asItems({ 你好: { count: 5, firstSeen: 3, lastSeen: 4, suppressed: true }, 遠方: seen() }),
    );

    const stats = await store.read();

    // Counts take the higher, and local decides the flags.
    expect(stats['你好']).toEqual({ count: 5, firstSeen: 1, lastSeen: 9 });
    expect(Object.keys(stats).sort()).toEqual(['你好', '本地', '遠方'].sort());
  });

  it('ignores items that are not words', async () => {
    const { store } = setup({ ...asItems({ 好: seen() }), someOtherSetting: { count: 1 } });
    expect(Object.keys(await store.read())).toEqual(['好']);
  });
});

describe('StatisticsStore.mutate', () => {
  it('writes only the words the transform changed', async () => {
    const { store, local } = setup(asItems({ 一: seen(), 二: seen(), 三: seen() }));

    await store.mutate(existing => ({ ...existing, 二: { ...existing['二']!, count: 7 } }));

    expect(local.mocks.set).toHaveBeenCalledTimes(1);
    expect(local.mocks.set).toHaveBeenCalledWith({ 'word:二': { ...seen(), count: 7 } });
  });

  it('sees an entry the transform edited in place', async () => {
    const { store, local } = setup(asItems({ 一: seen() }));

    await store.mutate(existing => {
      existing['一']!.count += 1;
      return existing;
    });

    expect(local.words()['一']).toMatchObject({ count: 2 });
  });

  it('removes a word the transform dropped', async () => {
    const { store, local } = setup(asItems({ 一: seen(), 二: seen() }));

    await store.mutate(({ 一: keep }) => ({ 一: keep! }));

    expect(Object.keys(local.words())).toEqual(['一']);
  });

  it('runs overlapping mutations one after the other', async () => {
    const { store, local } = setup();

    await Promise.all([
      store.mutate(existing => ({ ...existing, 一: seen() })),
      store.mutate(existing => ({ ...existing, 二: seen() })),
    ]);

    expect(Object.keys(local.words()).sort()).toEqual(['一', '二']);
  });

  it('still writes local when sync refuses', async () => {
    const { store, local, sync } = setup();
    sync.mocks.set.mockRejectedValue(new Error('MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(store.mutate(() => ({ 詞: studied(0) }))).resolves.toBeUndefined();

    expect(local.words()['詞']).toEqual(studied(0));
  });

  it('writes a review another device synced into local', async () => {
    const older = studied(0, 1000);
    const newer = studied(0, 2000);
    const { store, local } = setup(asItems({ 詞: older, 別的: seen() }), asItems({ 詞: newer }));

    await store.mutate(existing => ({ ...existing, 別的: seen(2) }));

    expect(local.words()['詞']).toMatchObject({ flashcard: { lastReviewed: 2000 } });
  });

  it('records a retirement and its undoing without sync putting it back', async () => {
    const { store } = setup();
    const retire = (suppressed: boolean) =>
      store.mutate(existing => {
        const next = { ...existing['詞']! };
        if (suppressed) next.suppressed = true;
        else delete next.suppressed;
        return { ...existing, 詞: next };
      });

    await store.mutate(() => ({ 詞: studied(0) }));
    await retire(true);
    expect((await store.read())['詞']?.suppressed).toBe(true);

    await retire(false);
    expect((await store.read())['詞']?.suppressed).toBeUndefined();
  });
});

describe('what sync carries', () => {
  it('carries reviewed pinned and retired words and nothing merely seen', async () => {
    const { store, sync } = setup();

    await store.mutate(() => ({
      複習: studied(0),
      選擇: { ...seen(), pinned: true },
      退休: { ...seen(), suppressed: true },
      路過: seen(40),
    }));

    expect(Object.keys(sync.words()).sort()).toEqual(['複習', '選擇', '退休'].sort());
  });

  it('leaves the sentence a word was met in behind', async () => {
    const { store, sync, local } = setup();

    await store.mutate(() => ({ 詞: studied(0) }));

    expect(sync.words()['詞']).not.toHaveProperty('context');
    expect(local.words()['詞']).toHaveProperty('context');
  });

  it('stays within the quotas however large the deck grows', async () => {
    const { store, sync, local } = setup();
    const deck: Statistics = {};
    for (let n = 0; n < 2000; n++) deck[`词${n}`] = studied(n);

    await store.mutate(() => deck);

    expect(Object.keys(local.words())).toHaveLength(2000);
    const carried = Object.keys(sync.words());
    expect(carried.length).toBeGreaterThan(0);
    expect(carried.length).toBeLessThan(SYNC_QUOTAS.items);
    // The most recently reviewed are the ones carried.
    expect(sync.words()['词1999']).toBeDefined();
    expect(sync.words()['词0']).toBeUndefined();
  });

  it('drops a word from sync once it no longer earns a place', async () => {
    const { store, sync } = setup();
    await store.mutate(() => ({ 選擇: { ...seen(), pinned: true } }));

    await store.mutate(() => ({ 選擇: seen() }));

    expect(sync.words()).toEqual({});
  });
});

describe('syncSelection', () => {
  it('keeps to the byte budget in order of eviction rank', () => {
    const record: Statistics = {};
    for (let n = 0; n < 1000; n++) record[`词${n}`] = studied(n);

    const selected = syncSelection(record);
    const bytes = Object.entries(selected).reduce(
      (sum, [word, stat]) =>
        sum + new TextEncoder().encode(`word:${word}${JSON.stringify(stat)}`).length,
      0,
    );

    expect(bytes).toBeLessThanOrEqual(SYNC_BUDGET_BYTES);
    expect(selected['词999']).toBeDefined();
  });
});

describe('migrating the legacy single item', () => {
  it('moves both areas into per-word items and removes the legacy item', async () => {
    const legacyLocal: Statistics = { 本地: seen(3), 兩邊: { ...seen(2), suppressed: true } };
    const legacySync: Statistics = { 兩邊: { ...seen(9), pinned: true }, 遠方: studied(1) };
    const { store, local, sync } = setup(
      { [LEGACY_STATISTICS_KEY]: legacyLocal },
      { [LEGACY_STATISTICS_KEY]: legacySync },
    );

    const stats = await store.read();

    expect(Object.keys(local.words()).sort()).toEqual(['兩邊', '本地', '遠方'].sort());
    // Local's legacy item decided the flags, and the count took the higher.
    expect(stats['兩邊']).toEqual({ count: 9, firstSeen: 1, lastSeen: 2, suppressed: true });
    expect(local.items()).not.toHaveProperty(LEGACY_STATISTICS_KEY);
    expect(sync.items()).not.toHaveProperty(LEGACY_STATISTICS_KEY);
  });

  it('finishes a migration interrupted part way without losing later progress', async () => {
    // Interrupted after writing some words, before removing the legacy item —
    // and the word already moved has been reviewed since.
    const { store, local } = setup({
      [LEGACY_STATISTICS_KEY]: { 已搬: studied(0, 1000), 未搬: seen(4) },
      ...asItems({ 已搬: studied(0, 5000) }),
    });

    const stats = await store.read();

    expect(stats['已搬']?.flashcard?.lastReviewed).toBe(5000);
    expect(stats['未搬']).toEqual(seen(4));
    expect(local.items()).not.toHaveProperty(LEGACY_STATISTICS_KEY);
  });

  it('migrates once for concurrent first calls and keeps what they write', async () => {
    const { store, local } = setup({ [LEGACY_STATISTICS_KEY]: { 舊: seen(2) } });

    const [first, , second] = await Promise.all([
      store.read(),
      store.mutate(existing => ({ ...existing, 新: seen() })),
      store.read(),
    ]);

    expect(local.mocks.remove.mock.calls.filter(([keys]) => keys === LEGACY_STATISTICS_KEY))
      .toHaveLength(1);
    expect(first['舊']).toEqual(seen(2));
    expect(second['舊']).toEqual(seen(2));
    expect(Object.keys(local.words()).sort()).toEqual(['新', '舊'].sort());
  });

  it('keeps the legacy item when local cannot take the words', async () => {
    const { store, local } = setup({ [LEGACY_STATISTICS_KEY]: { 舊: seen(2) } });
    local.mocks.set.mockRejectedValueOnce(new Error('disk full'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await store.read();
    expect(local.items()).toHaveProperty(LEGACY_STATISTICS_KEY);

    // The next call tries again.
    expect((await store.read())['舊']).toEqual(seen(2));
    expect(local.items()).not.toHaveProperty(LEGACY_STATISTICS_KEY);
  });
});

describe('StatisticsStore.clear', () => {
  it('empties both areas of words and the legacy item alone', async () => {
    const { store, local, sync } = setup(
      { ...asItems({ 一: seen() }), [LEGACY_STATISTICS_KEY]: { 二: seen() }, other: 1 },
      asItems({ 一: studied(0) }),
    );

    await store.clear();

    expect(local.items()).toEqual({ other: 1 });
    expect(sync.items()).toEqual({});
  });
});
