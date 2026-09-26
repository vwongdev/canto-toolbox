import { StatisticsStore, statisticsStore } from '../shared/statistics-store.js';
import type { Statistics } from '../shared/types';
import { restoreBackup, type RestoreOutcome } from './backup.js';

export interface StatsStorage {
  getStatistics(): Promise<Statistics>;
  clearStatistics(): Promise<void>;
  restoreStatistics(backup: Statistics): Promise<RestoreOutcome>;
}

export class StatsStorageClient implements StatsStorage {
  constructor(private readonly store: StatisticsStore) {}

  async getStatistics(): Promise<Statistics> {
    return this.store.read();
  }

  /** Both areas are emptied — a read reconciles them, so clearing one is not enough. */
  async clearStatistics(): Promise<void> {
    await this.store.clear();
  }

  /** Merged into the record through the one write path every feature shares. */
  async restoreStatistics(backup: Statistics): Promise<RestoreOutcome> {
    let outcome: RestoreOutcome | undefined;
    await this.store.mutate((existing) => {
      outcome = restoreBackup(existing, backup);
      return outcome.statistics;
    });
    return outcome!;
  }
}

export const statsStorage = new StatsStorageClient(statisticsStore);
