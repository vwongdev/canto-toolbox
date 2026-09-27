import type { Statistics } from '../shared/types.js';
import { DIRECTION_KEYS, mergeStatistics } from '../shared/statistics-utils.js';
import { isLinkable } from '../shared/word-contexts.js';

/** Names the file as ours, so a stray JSON file is refused rather than merged. */
export const BACKUP_FORMAT = 'canto-toolbox-statistics';

/**
 * Raised when the record's shape changes in a way an older restore could not
 * read. A backup from a newer version is refused rather than half understood.
 */
export const BACKUP_VERSION = 1;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  /** ISO 8601, for the reader choosing between files — nothing reads it back. */
  exportedAt: string;
  statistics: Statistics;
}

/** A file that cannot be restored, with a message fit to show the reader. */
export class BackupError extends Error {
  override name = 'BackupError';
}

export function serialiseBackup(statistics: Statistics, now: Date = new Date()): string {
  const backup: Backup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    statistics,
  };
  return JSON.stringify(backup, null, 2);
}

export function backupFilename(now: Date = new Date()): string {
  return `canto-toolbox-backup-${now.toISOString().slice(0, 10)}.json`;
}

type Check = (value: unknown) => boolean;

const isNumber: Check = value => typeof value === 'number' && Number.isFinite(value);
const isString: Check = value => typeof value === 'string';
const isBoolean: Check = value => typeof value === 'boolean';
const RATINGS = new Set(['again', 'hard', 'good', 'easy']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The first field that is present with the wrong type, or undefined if none is. */
function badField(
  value: Record<string, unknown>,
  required: Record<string, Check>,
  optional: Record<string, Check>,
): string | undefined {
  for (const [key, check] of Object.entries(required)) {
    if (!check(value[key])) return key;
  }
  for (const [key, check] of Object.entries(optional)) {
    if (value[key] !== undefined && !check(value[key])) return key;
  }
  return undefined;
}

const SRS_FIELDS: Record<string, Check> = {
  due: isNumber,
  stability: isNumber,
  difficulty: isNumber,
  scheduledDays: isNumber,
  learningSteps: isNumber,
  lapses: isNumber,
  state: isNumber,
};

function badProgressField(progress: unknown): string | undefined {
  if (!isRecord(progress)) return '';

  const bad = badField(
    progress,
    { reviews: isNumber, consecutiveCorrect: isNumber },
    {
      correct: isNumber,
      lastRating: value => RATINGS.has(value as string),
      lastReviewed: isNumber,
    },
  );
  if (bad !== undefined) return bad;

  if (progress.srs === undefined) return undefined;
  if (!isRecord(progress.srs)) return 'srs';
  const badSrs = badField(progress.srs, SRS_FIELDS, {});
  return badSrs === undefined ? undefined : `srs.${badSrs}`;
}

/**
 * A source must be a web address: the stats page turns it into a link, and a
 * backup file is text anyone could have edited.
 */
const isSource: Check = value =>
  isRecord(value) &&
  typeof value.url === 'string' &&
  isLinkable(value.url) &&
  (value.title === undefined || isString(value.title));

const isSighting: Check = value =>
  isRecord(value) &&
  isString(value.text) &&
  isNumber(value.seen) &&
  (value.source === undefined || isSource(value.source));

const isSightingList: Check = value => Array.isArray(value) && value.every(isSighting);

const isTally: Check = value => isRecord(value) && Object.values(value).every(isNumber);

function badWordField(stat: unknown): string | undefined {
  if (!isRecord(stat)) return '';

  const bad = badField(
    stat,
    { count: isNumber, firstSeen: isNumber, lastSeen: isNumber },
    {
      // A backup made before words kept several sentences holds one, as a string.
      context: isString,
      contexts: isSightingList,
      rank: isNumber,
      confusedWith: isTally,
      decomposable: isBoolean,
      writable: isBoolean,
      suppressed: isBoolean,
      pinned: isBoolean,
      statusAt: isNumber,
    },
  );
  if (bad !== undefined) return bad;

  for (const key of DIRECTION_KEYS) {
    if (stat[key] === undefined) continue;
    const badProgress = badProgressField(stat[key]);
    if (badProgress !== undefined) return badProgress ? `${key}.${badProgress}` : key;
  }
  return undefined;
}

/**
 * The statistics a backup file holds, or a `BackupError` saying why it cannot
 * be restored. Every field the record defines is checked for its type, since
 * a restored word is read by the scheduler and the eviction ranking alike and
 * neither expects to meet a string where a date should be. Fields the record
 * does not define are carried through, the way a merge carries them.
 */
export function parseBackup(text: string): Statistics {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupError('This file is not a Canto Toolbox backup: it is not valid JSON.');
  }

  if (!isRecord(parsed) || parsed.format !== BACKUP_FORMAT) {
    throw new BackupError('This file is not a Canto Toolbox backup.');
  }
  if (!isNumber(parsed.version) || (parsed.version as number) < 1) {
    throw new BackupError('This backup has no readable format version.');
  }
  if ((parsed.version as number) > BACKUP_VERSION) {
    throw new BackupError('This backup was made by a newer version of Canto Toolbox. Update the extension to restore it.');
  }
  if (!isRecord(parsed.statistics)) {
    throw new BackupError('This backup holds no word statistics.');
  }

  for (const [word, stat] of Object.entries(parsed.statistics)) {
    if (!word.trim()) throw new BackupError('This backup has an entry with no word.');

    const bad = badWordField(stat);
    if (bad !== undefined) {
      const where = bad ? ` (${bad})` : '';
      throw new BackupError(`This backup is damaged: the entry for "${word}" is malformed${where}.`);
    }
  }

  return parsed.statistics as Statistics;
}

export interface RestoreOutcome {
  statistics: Statistics;
  /** Words the backup held, whether or not the record already had them. */
  imported: number;
  /** Words the record did not have before the restore. */
  added: number;
}

/**
 * The record with a backup folded into it. A restore is a merge rather than a
 * replacement, so nothing already recorded here is lost to an older file.
 *
 * The backup takes the part of the sync area in the reconciliation: a snapshot
 * of the record from elsewhere. Counts, dates and each schedule then resolve
 * as they do between the two areas — the higher count, the earliest sighting,
 * the more recently answered card — and this device keeps the say over a word
 * both hold that it has retired or chosen, since that is its latest decision.
 */
export function restoreBackup(existing: Statistics, backup: Statistics): RestoreOutcome {
  const words = Object.keys(backup);
  return {
    statistics: mergeStatistics(backup, existing),
    imported: words.length,
    added: words.filter(word => !Object.prototype.hasOwnProperty.call(existing, word)).length,
  };
}
