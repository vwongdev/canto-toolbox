import { lastReviewedAt, mergeStatistics, reconcileStatistics } from './statistics-utils.js';
import type { Statistics, WordStatistics } from './types.js';

/**
 * Where statistics live. The popup (write), stats (read/clear) and flashcard
 * (review progress) features all address the same record, so the layout and
 * the sync/local policy live here rather than being re-declared per feature.
 * Each feature still owns its own access policy on top — what to cap, what to
 * increment.
 *
 * Each word is its own item, `word:<word>`. The record used to be one item,
 * which every write rewrote whole: at a few thousand words that is hundreds of
 * kilobytes serialised to record one hover. One item per word means a write
 * costs what it changes, and `chrome.storage` has no per-item overhead worth
 * trading that for — a sharded layout would still rewrite a whole shard.
 */
export const WORD_KEY_PREFIX = 'word:';

/** The single item the whole record was held in before it was split per word. */
export const LEGACY_STATISTICS_KEY = 'wordStatistics';

/**
 * How many words the record holds before the least valuable are evicted. Both
 * the write path that enforces it and the stats page that warns about it read
 * it from here, so the number the reader is shown is the one actually applied.
 *
 * `unlimitedStorage` lifts local's quota, so this is not a storage limit: it
 * bounds what every write reads back, since a transform is handed the whole
 * record. Twenty thousand is years of reading, and the cap on the frequency
 * data too — past it a word is rare enough that forgetting its hover count
 * costs nothing.
 */
export const MAX_TRACKED_WORDS = 20_000;

/**
 * What `chrome.storage.sync` is allowed to hold of the record. Its quotas are
 * 102,400 bytes and 512 items in all; the margin is headroom for the byte
 * count being Chrome's, not ours.
 */
export const SYNC_BUDGET_BYTES = 90_000;
export const SYNC_BUDGET_ITEMS = 400;

/**
 * Eviction tiers, ordered by what is lost when the entry goes. Each tier is
 * far enough above the last that the value ranking within it — a timestamp, a
 * hover count — can never carry an entry into the tier above.
 */
const REVIEWED_TIER = 4e15;
const PINNED_TIER = 2e15;
const SUPPRESSED_TIER = 1e15;

/**
 * Study count decides which words get evicted when the cap is hit, but a word
 * that has been reviewed carries progress that cannot be recovered by reading
 * it again — so anything in the flashcard deck outranks every unreviewed word
 * regardless of how rarely it is studied.
 *
 * Within the deck the tie-break is the last review: ranking every reviewed
 * word identically left the order among them to chance, which threw away real
 * FSRS history once the deck alone filled the cap. A word the reader retired
 * or asked for is a decision rather than progress, so it sits between the two.
 *
 * The same order decides which words sync carries, for the same reason.
 */
export function evictionRank(entry: WordStatistics): number {
  const reviewed = lastReviewedAt(entry);
  if (reviewed !== undefined) return REVIEWED_TIER + reviewed;
  if (entry.pinned) return PINNED_TIER + entry.count;
  if (entry.suppressed) return SUPPRESSED_TIER + entry.count;
  return entry.count;
}

/** Only these carry anything another device could not rebuild by reading. */
function worthSyncing(entry: WordStatistics): boolean {
  return entry.pinned === true || entry.suppressed === true || lastReviewedAt(entry) !== undefined;
}

const encoder = new TextEncoder();

/**
 * The part of the record sync carries: the words with review progress or a
 * decision on them, best first, until the budget runs out. The sentence a word
 * was met in stays behind — it is the largest field and the only one a device
 * can do without, since merging keeps whichever area has one.
 */
export function syncSelection(record: Statistics): Statistics {
  const candidates = Object.entries(record)
    .filter(([, entry]) => worthSyncing(entry))
    .sort(([, a], [, b]) => evictionRank(b) - evictionRank(a));

  const selected: Statistics = {};
  let bytes = 0;
  let items = 0;

  for (const [word, entry] of candidates) {
    const carried = { ...entry };
    delete carried.context;

    const key = WORD_KEY_PREFIX + word;
    bytes += encoder.encode(key).length + encoder.encode(JSON.stringify(carried)).length;
    if (bytes > SYNC_BUDGET_BYTES || ++items > SYNC_BUDGET_ITEMS) break;

    selected[word] = carried;
  }

  return selected;
}

function wordsIn(items: Record<string, unknown>): Statistics {
  const words: Statistics = {};
  for (const [key, value] of Object.entries(items)) {
    if (key.startsWith(WORD_KEY_PREFIX)) {
      words[key.slice(WORD_KEY_PREFIX.length)] = value as WordStatistics;
    }
  }
  return words;
}

async function readAll(area: chrome.storage.StorageArea, name: string): Promise<Record<string, unknown>> {
  try {
    return (await area.get(null)) ?? {};
  } catch (error) {
    console.warn(`[Storage] Failed to read from ${name} storage:`, error);
    return {};
  }
}

/**
 * Bring `area` to hold exactly `words`, touching only the items that differ
 * from `held` — which is compared as serialised text, because a transform is
 * free to edit an entry in place and would otherwise look unchanged.
 */
async function writeDifference(
  area: chrome.storage.StorageArea,
  held: Map<string, string>,
  words: Statistics,
): Promise<void> {
  const changed: Record<string, WordStatistics> = {};
  for (const [word, entry] of Object.entries(words)) {
    if (held.get(word) !== JSON.stringify(entry)) changed[WORD_KEY_PREFIX + word] = entry;
  }

  const gone = [...held.keys()]
    .filter(word => !(word in words))
    .map(word => WORD_KEY_PREFIX + word);

  if (Object.keys(changed).length > 0) await area.set(changed);
  if (gone.length > 0) await area.remove(gone);
}

function serialised(words: Statistics): Map<string, string> {
  return new Map(Object.entries(words).map(([word, entry]) => [word, JSON.stringify(entry)]));
}

/**
 * Local holds the record; sync carries the part of it worth carrying to the
 * reader's other devices.
 *
 * Local is the authority because it is the area every write reaches:
 * `unlimitedStorage` gives it no quota to outgrow. Sync's quotas cannot hold a
 * regular reader's record, so rather than attempting all of it and keeping
 * whatever fossil last fitted, it is given a deliberate share
 * (`syncSelection`) and every write keeps that share current — a device
 * reading it gets the recent reviews and decisions, never a months-old
 * snapshot of everything.
 *
 * Reads reconcile both areas with `reconcileStatistics`, as before: counts take
 * the higher, the later review wins, and local decides a word's retired and
 * chosen flags. A word another device synced is written into local by the next
 * write, which is how it arrives for good.
 */
export class StatisticsStore {
  private migration: Promise<void> | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly sync: chrome.storage.StorageArea,
    private readonly local: chrome.storage.StorageArea,
  ) {}

  async read(): Promise<Statistics> {
    await this.migrated();
    const { sync, local } = await this.readAreas();
    return reconcileStatistics(sync, local);
  }

  /**
   * Read-modify-write over the reconciled record. Mutations run one at a time,
   * since each reads what the last one wrote; without the queue two flushes in
   * flight would each write back the record without the other's words.
   *
   * Either area failing is logged and swallowed — statistics are best-effort,
   * and sync is expected to refuse writes past its rate limits.
   */
  mutate(transform: (existing: Statistics) => Statistics): Promise<void> {
    const run = this.queue.then(() => this.apply(transform));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Empty both areas, the legacy item included — a read reconciles them, so
   * clearing one is not enough.
   */
  async clear(): Promise<void> {
    await Promise.all([this.clearArea(this.sync), this.clearArea(this.local)]);
  }

  private async clearArea(area: chrome.storage.StorageArea): Promise<void> {
    const items = await area.get(null);
    const keys = Object.keys(items ?? {}).filter(
      key => key.startsWith(WORD_KEY_PREFIX) || key === LEGACY_STATISTICS_KEY,
    );
    if (keys.length > 0) await area.remove(keys);
  }

  private async apply(transform: (existing: Statistics) => Statistics): Promise<void> {
    await this.migrated();
    const { sync, local } = await this.readAreas();
    // Taken before the transform runs, since it may edit the entries it is handed.
    const syncHeld = serialised(sync);
    const localHeld = serialised(local);
    await this.persist(syncHeld, localHeld, transform(reconcileStatistics(sync, local)));
  }

  private async readAreas(): Promise<{ sync: Statistics; local: Statistics }> {
    const [sync, local] = await Promise.all([
      readAll(this.sync, 'sync'),
      readAll(this.local, 'local'),
    ]);
    return { sync: wordsIn(sync), local: wordsIn(local) };
  }

  private async persist(
    syncHeld: Map<string, string>,
    localHeld: Map<string, string>,
    next: Statistics,
  ): Promise<void> {
    try {
      await writeDifference(this.local, localHeld, next);
    } catch (error) {
      console.error('[Storage] Local write failed:', error);
    }

    try {
      await writeDifference(this.sync, syncHeld, syncSelection(next));
    } catch (error) {
      console.warn('[Storage] Sync write failed; local holds the record:', error);
    }
  }

  /**
   * Once per store, before anything reads or writes: fold the legacy single
   * item into the per-word layout, then remove it. Concurrent first calls share
   * the one migration, so none of them reads a half-moved record.
   */
  private migrated(): Promise<void> {
    this.migration ??= this.migrate().catch((error: unknown) => {
      // The words are still in the legacy item, so the next call tries again.
      console.error('[Storage] Statistics migration failed:', error);
      this.migration = undefined;
    });
    return this.migration;
  }

  /**
   * A migration interrupted after writing some words and before removing the
   * legacy item is simply run again: the legacy record is merged into the
   * per-word one as the sync side of a reconcile, so the words already moved —
   * and anything changed since — keep their local authority, and nothing is
   * counted twice.
   */
  private async migrate(): Promise<void> {
    const [syncItems, localItems] = await Promise.all([
      readAll(this.sync, 'sync'),
      readAll(this.local, 'local'),
    ]);

    const legacySync = syncItems[LEGACY_STATISTICS_KEY] as Statistics | undefined;
    const legacyLocal = localItems[LEGACY_STATISTICS_KEY] as Statistics | undefined;
    if (legacySync === undefined && legacyLocal === undefined) return;

    const sync = wordsIn(syncItems);
    const local = wordsIn(localItems);
    const moved = mergeStatistics(reconcileStatistics(legacySync, legacyLocal), local);

    // Not swallowed: the legacy item goes only once local holds every word.
    await writeDifference(this.local, serialised(local), moved);
    await this.local.remove(LEGACY_STATISTICS_KEY);

    try {
      await writeDifference(this.sync, serialised(sync), syncSelection(reconcileStatistics(sync, moved)));
      await this.sync.remove(LEGACY_STATISTICS_KEY);
    } catch (error) {
      console.warn('[Storage] Sync migration failed; local holds the record:', error);
    }
  }
}

export const statisticsStore = new StatisticsStore(chrome.storage.sync, chrome.storage.local);

/**
 * Change the record. Every writer goes through here so none of them can
 * transform a single storage area's partial view of it — which silently
 * dropped a retirement, or a review, for any word the area did not hold.
 */
export function mutateStatistics(
  transform: (existing: Statistics) => Statistics,
): Promise<void> {
  return statisticsStore.mutate(transform);
}
