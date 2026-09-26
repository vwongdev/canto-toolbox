import { describe, it, expect } from 'vitest';
import { StatsStorageClient } from '../stats-storage.js';
import { StatisticsStore } from '../../shared/statistics-store.js';
import { mergeStatistics } from '../../shared/statistics-utils.js';
import { asItems, fakeArea } from '../../__tests__/fake-storage.js';
import type { Statistics } from '../../shared/types.js';

const makeClient = (sync: Statistics = {}, local: Statistics = {}) => {
  const syncArea = fakeArea(asItems(sync));
  const localArea = fakeArea(asItems(local));
  return {
    client: new StatsStorageClient(new StatisticsStore(syncArea.area, localArea.area)),
    syncArea,
    localArea,
  };
};

describe('StatsStorageClient.getStatistics', () => {
  it('merges sync and local statistics via mergeStatistics', async () => {
    const now = Date.now();
    const sync: Statistics = { 你好: { count: 3, firstSeen: now, lastSeen: now } };
    const local: Statistics = { 你好: { count: 2, firstSeen: now - 1000, lastSeen: now + 1000 } };

    const result = await makeClient(sync, local).client.getStatistics();

    expect(result).toEqual(mergeStatistics(sync, local));
    expect(result['你好']).toEqual({ count: 3, firstSeen: now - 1000, lastSeen: now + 1000 });
  });

  it('returns an empty object when neither area has data', async () => {
    const result = await makeClient().client.getStatistics();
    expect(result).toEqual({});
  });

  it('falls back to one area when the other is empty', async () => {
    const now = Date.now();
    const only: Statistics = { 好: { count: 1, firstSeen: now, lastSeen: now } };

    const result = await makeClient(only).client.getStatistics();

    expect(result).toEqual(only);
  });
});

describe('StatsStorageClient.clearStatistics', () => {
  it('empties both areas so a read cannot resurrect either', async () => {
    const now = Date.now();
    const stat = { count: 1, firstSeen: now, lastSeen: now, pinned: true };
    const { client } = makeClient({ 好: stat }, { 好: stat, 你: stat });

    await client.clearStatistics();

    expect(await client.getStatistics()).toEqual({});
  });
});

describe('StatsStorageClient.restoreStatistics', () => {
  it('merges the backup into the record through the shared write path', async () => {
    const existing: Statistics = { 字: { count: 4, firstSeen: 5, lastSeen: 6 } };
    const backup: Statistics = {
      字: { count: 2, firstSeen: 1, lastSeen: 3 },
      好: { count: 1, firstSeen: 1, lastSeen: 1 },
    };
    const { client } = makeClient({}, existing);

    const outcome = await client.restoreStatistics(backup);

    const written = { 字: { count: 4, firstSeen: 1, lastSeen: 6 }, 好: backup['好'] };
    expect(outcome).toEqual({ statistics: written, imported: 2, added: 1 });
    expect(await client.getStatistics()).toEqual(written);
  });
});
