import { MAX_TRACKED_WORDS, StatisticsStore, evictionRank, statisticsStore } from '../shared/statistics-store.js';
import { createBatchedDebounce } from '../shared/debounce.js';
import { BoundedMap } from '../shared/bounded-map.js';
import { applyWordStatus } from '../shared/statistics-utils.js';
import { MAX_CONTEXT_CHARS } from '../shared/context-sentence.js';
import type { Statistics, WordStatus } from '../shared/types';

const DEBOUNCE_DELAY = 500;

/** What a sighting knows about the word beyond the fact that it happened. */
export interface WordDetails {
  context?: string;
  rank?: number;
  decomposable?: boolean;
  writable?: boolean;
  /** The reader asked for this word outright rather than dwelling on it. */
  pinned?: boolean;
}

export interface PopupStorage {
  updateStatistics(word: string, details?: WordDetails): void;
  setStatus(word: string, status: WordStatus, details?: WordDetails): void;
  read(): Promise<Statistics>;
  statusOf(word: string, statistics: Statistics): WordStatus;
}

export class PopupStorageClient implements PopupStorage {
  private readonly queueUpdate: (word: string) => void;
  /**
   * Details ride alongside the debounced counts rather than through them: the
   * batcher accumulates a count per key, and only the first details seen for a
   * word in the batch are kept.
   */
  private readonly pendingDetails = new Map<string, WordDetails>();
  /**
   * The reader's latest decision per word in the batch. Only the latest
   * counts: pressing Study and then Known is a change of mind, not two
   * decisions to reconcile. Kept apart from the details, which keep the
   * *first* — so a Study pressed after the dwell had already queued the word
   * still pins it.
   */
  private readonly pendingStatuses = new Map<string, WordStatus>();
  /**
   * Queued calls that were decisions rather than sightings. A decision rides
   * the same batch so it cannot race the sightings written beside it, and is
   * taken back out of the count when the batch is written.
   */
  private readonly pendingDecisions = new Map<string, number>();

  constructor(private readonly store: StatisticsStore) {
    this.queueUpdate = createBatchedDebounce(
      (updates) => this.flushUpdates(updates),
      DEBOUNCE_DELAY
    );
  }

  updateStatistics(word: string, details: WordDetails = {}): void {
    if (!isValidWord(word)) return;

    this.rememberDetails(word, details);
    // Asking for a word is also a way of saying it is no longer retired.
    if (details.pinned) this.pendingStatuses.set(word, { pinned: true });

    this.queueUpdate(word);
  }

  /**
   * Record a decision about a word without it counting as a sighting — the
   * popup's Known button. A word not yet tracked is recorded with no sightings
   * at all, so the retirement has an entry to stick to.
   */
  setStatus(word: string, status: WordStatus, details: WordDetails = {}): void {
    if (!isValidWord(word)) return;

    this.rememberDetails(word, details);
    this.pendingStatuses.set(word, status);
    this.pendingDecisions.set(word, (this.pendingDecisions.get(word) ?? 0) + 1);

    this.queueUpdate(word);
  }

  /** The whole record, reconciled across both storage areas. */
  read(): Promise<Statistics> {
    return this.store.read<Statistics>(STATISTICS_KEY, reconcileStatistics);
  }

  /**
   * The reader's decisions about a word as a lookup should report them. A
   * decision still waiting for its batch counts already, or pressing Known and
   * hovering the word again straight away would show it unpressed.
   */
  statusOf(word: string, statistics: Statistics): WordStatus {
    const stored = statistics[word];
    const pending = this.pendingStatuses.get(word);
    const decided = pending
      ? applyWordStatus(stored ?? { count: 0, firstSeen: 0, lastSeen: 0 }, pending)
      : stored;

    return {
      ...(decided?.suppressed && { suppressed: true }),
      ...(decided?.pinned && { pinned: true }),
    };
  }

  private rememberDetails(word: string, details: WordDetails): void {
    if (this.pendingDetails.has(word)) return;

    const context = details.context?.trim();
    this.pendingDetails.set(word, {
      ...(context && { context: context.slice(0, MAX_CONTEXT_CHARS) }),
      ...(details.rank !== undefined && { rank: details.rank }),
      ...(details.decomposable !== undefined && { decomposable: details.decomposable }),
      ...(details.writable !== undefined && { writable: details.writable }),
    });
  }

  private async flushUpdates(updates: Map<string, number>): Promise<void> {
    const details = new Map(this.pendingDetails);
    const statuses = new Map(this.pendingStatuses);
    const decisions = new Map(this.pendingDecisions);
    this.pendingDetails.clear();
    this.pendingStatuses.clear();
    this.pendingDecisions.clear();

    await this.store.mutate((existing) => {
      const now = Date.now();
      const stats = new BoundedMap<string, Statistics[string]>(
        MAX_TRACKED_WORDS,
        evictionRank,
        Object.entries(existing)
      );

      // Collected and written in one go, so a batch of new words is ranked
      // against the record once rather than after each word in it.
      const touched: Array<[string, Statistics[string]]> = [];

      for (const [word, queued] of updates) {
        const sightings = queued - (decisions.get(word) ?? 0);
        const status = statuses.get(word);
        const tracked = stats.get(word);

        // Taking back a Known pressed on a word never tracked leaves nothing
        // to record.
        if (!tracked && sightings === 0 && !status?.suppressed && !status?.pinned) continue;

        const entry = tracked ?? { count: 0, firstSeen: now, lastSeen: now };
        if (sightings > 0) {
          entry.count += sightings;
          entry.lastSeen = now;
        }

        const seen = details.get(word);

        // The sentence a word was first met in is the memory hook; later
        // sightings do not overwrite it.
        if (seen?.context && !entry.context) entry.context = seen.context;

        // None of these change, but writing them on every sighting backfills
        // words tracked before they were recorded.
        if (seen?.rank !== undefined) entry.rank = seen.rank;
        if (seen?.decomposable !== undefined) entry.decomposable = seen.decomposable;
        if (seen?.writable !== undefined) entry.writable = seen.writable;

        // Only a decision changes a word's status. A dwell is a sighting, so it
        // never undoes a Known pressed a moment earlier; pressing Known again,
        // pressing Study, or the stats and flashcard pages' own controls are
        // what put a retired word back.
        touched.push([word, status ? applyWordStatus(entry, status) : entry]);
      }

      stats.setAll(touched);
      return stats.toObject();
    });
  }
}

function isValidWord(word: string): boolean {
  if (word?.trim()) return true;
  console.warn('[Background] Invalid word for statistics:', word);
  return false;
}

export const popupStorage = new PopupStorageClient(statisticsStore);
