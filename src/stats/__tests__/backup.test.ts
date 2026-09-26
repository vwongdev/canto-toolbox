import { describe, it, expect } from 'vitest';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BackupError,
  backupFilename,
  parseBackup,
  restoreBackup,
  serialiseBackup,
} from '../backup.js';
import type { FlashcardProgress, Statistics } from '../../shared/types.js';

const REVIEWED: FlashcardProgress = {
  reviews: 3,
  correct: 2,
  consecutiveCorrect: 1,
  lastRating: 'good',
  lastReviewed: 1_700_000_000_000,
  srs: {
    due: 1_700_400_000_000,
    stability: 4.2,
    difficulty: 5.1,
    scheduledDays: 4,
    learningSteps: 0,
    lapses: 1,
    state: 2,
  },
};

const STATISTICS: Statistics = {
  你好: {
    count: 7,
    firstSeen: 1_690_000_000_000,
    lastSeen: 1_700_000_000_000,
    context: '你好，歡迎光臨',
    rank: 520,
    pinned: true,
    flashcard: REVIEWED,
    production: { reviews: 1, consecutiveCorrect: 1, lastReviewed: 1_699_000_000_000 },
  },
  好: { count: 2, firstSeen: 1, lastSeen: 2, decomposable: true, writable: true, suppressed: true },
};

function envelope(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: '2026-09-27T00:00:00.000Z',
    statistics: STATISTICS,
    ...overrides,
  });
}

describe('serialiseBackup', () => {
  it('carries the format, version and export time', () => {
    const backup = JSON.parse(serialiseBackup(STATISTICS, new Date('2026-09-27T08:00:00Z')));

    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.version).toBe(BACKUP_VERSION);
    expect(backup.exportedAt).toBe('2026-09-27T08:00:00.000Z');
  });

  it('round-trips every progress field through a restore', () => {
    expect(parseBackup(serialiseBackup(STATISTICS))).toEqual(STATISTICS);
  });
});

describe('backupFilename', () => {
  it('names the file by the day it was made', () => {
    expect(backupFilename(new Date('2026-09-27T08:00:00Z'))).toBe('canto-toolbox-backup-2026-09-27.json');
  });
});

describe('parseBackup', () => {
  function rejection(text: string): string {
    try {
      parseBackup(text);
    } catch (error) {
      expect(error).toBeInstanceOf(BackupError);
      return (error as Error).message;
    }
    throw new Error('expected the backup to be rejected');
  }

  it('rejects text that is not JSON', () => {
    expect(rejection('wordStatistics,count')).toMatch(/not valid JSON/);
  });

  it('rejects JSON that is not one of ours', () => {
    expect(rejection(JSON.stringify(STATISTICS))).toBe('This file is not a Canto Toolbox backup.');
  });

  it('rejects a backup from a newer version rather than half reading it', () => {
    expect(rejection(envelope({ version: BACKUP_VERSION + 1 }))).toMatch(/newer version/);
  });

  it('rejects a backup with no statistics', () => {
    expect(rejection(envelope({ statistics: [] }))).toMatch(/no word statistics/);
  });

  it('names the word and field that are malformed', () => {
    const statistics = { ...STATISTICS, 好: { ...STATISTICS['好'], lastSeen: 'yesterday' } };
    expect(rejection(envelope({ statistics }))).toBe(
      'This backup is damaged: the entry for "好" is malformed (lastSeen).'
    );
  });

  it('checks the schedule inside a review direction', () => {
    const flashcard = { ...REVIEWED, srs: { ...REVIEWED.srs, due: null } };
    const statistics = { 你好: { ...STATISTICS['你好'], flashcard } };
    expect(rejection(envelope({ statistics }))).toMatch(/\(flashcard\.srs\.due\)/);
  });

  it('rejects a rating the scheduler does not know', () => {
    const production = { reviews: 1, consecutiveCorrect: 0, lastRating: 'meh' };
    const statistics = { 你好: { ...STATISTICS['你好'], production } };
    expect(rejection(envelope({ statistics }))).toMatch(/\(production\.lastRating\)/);
  });

  it('reads both the single sentence of an old backup and the list of a new one', () => {
    const contexts = [{ text: '好嘢', source: { url: 'https://example.com/', title: '例子' }, seen: 1 }];
    const statistics = { ...STATISTICS, 好: { ...STATISTICS['好'], contexts } };

    const parsed = parseBackup(envelope({ statistics }));
    expect(parsed['你好']!.context).toBe('你好，歡迎光臨');
    expect(parsed['好']!.contexts).toEqual(contexts);
  });

  it('rejects a sentence without the time it was met', () => {
    const statistics = { 好: { ...STATISTICS['好'], contexts: [{ text: '好嘢' }] } };
    expect(rejection(envelope({ statistics }))).toMatch(/\(contexts\)/);
  });

  // The stats page turns a source into a link.
  it('rejects a source that is not a web address', () => {
    const contexts = [{ text: '好嘢', source: { url: 'javascript:alert(1)' }, seen: 1 }];
    const statistics = { 好: { ...STATISTICS['好'], contexts } };
    expect(rejection(envelope({ statistics }))).toMatch(/\(contexts\)/);
  });

  // A field a later version adds is carried, the way a merge carries it.
  it('keeps fields the record does not define', () => {
    const statistics = { 好: { ...STATISTICS['好'], tags: ['hsk1'] } };
    expect(parseBackup(envelope({ statistics }))['好']).toHaveProperty('tags', ['hsk1']);
  });
});

describe('restoreBackup', () => {
  it('adds words the record does not have', () => {
    const outcome = restoreBackup({ 字: { count: 1, firstSeen: 5, lastSeen: 6 } }, STATISTICS);

    expect(Object.keys(outcome.statistics).sort()).toEqual(['你好', '好', '字'].sort());
    expect(outcome.statistics['你好']).toEqual(STATISTICS['你好']);
    expect(outcome.imported).toBe(2);
    expect(outcome.added).toBe(2);
  });

  it('never loses a word that only the record holds', () => {
    const existing: Statistics = { 字: { count: 4, firstSeen: 5, lastSeen: 6 } };
    expect(restoreBackup(existing, {}).statistics).toEqual(existing);
  });

  it('keeps the more recently answered schedule of the two', () => {
    const newer = { ...REVIEWED, reviews: 9, lastReviewed: REVIEWED.lastReviewed! + 1 };
    const existing: Statistics = { 你好: { ...STATISTICS['你好']!, flashcard: newer } };

    const outcome = restoreBackup(existing, STATISTICS);

    expect(outcome.statistics['你好']!.flashcard).toEqual(newer);
    expect(outcome.added).toBe(1);
  });

  it('takes the higher count and the earlier first sighting', () => {
    const existing: Statistics = { 好: { count: 9, firstSeen: 100, lastSeen: 200 } };

    const merged = restoreBackup(existing, STATISTICS).statistics['好']!;

    expect(merged.count).toBe(9);
    expect(merged.firstSeen).toBe(1);
    expect(merged.lastSeen).toBe(200);
  });

  // The record on this device holds the reader's latest decision about a word
  // both sides know; an older file does not get to overturn it.
  it("leaves this device's retire and study decisions standing", () => {
    const existing: Statistics = { 好: { count: 2, firstSeen: 1, lastSeen: 2, pinned: true } };

    const merged = restoreBackup(existing, STATISTICS).statistics['好']!;

    expect(merged.pinned).toBe(true);
    expect(merged.suppressed).toBeUndefined();
  });

  it('adds the sentences an old backup holds to the ones recorded here', () => {
    const existing: Statistics = {
      你好: { count: 1, firstSeen: 1_695_000_000_000, lastSeen: 1_695_000_000_000, contexts: [
        { text: '跟他說你好', seen: 1_695_000_000_000 },
      ] },
    };

    const merged = restoreBackup(existing, STATISTICS).statistics['你好']!;

    expect(merged.contexts!.map(c => c.text)).toEqual(['你好，歡迎光臨', '跟他說你好']);
  });
});
