import type {
  FlashcardProgress,
  FlashcardStage,
  ReviewDirection,
  Statistics,
  WordStatistics,
  WordStatus,
} from './types';
import { isLearning, isMastered } from './scheduler.js';

/**
 * Sightings before an unchosen word is enrolled in the deck.
 *
 * Tracking a word and drilling it are different claims. Hovering is a cheap,
 * honest record of what was read; enrolment spends a session slot on every
 * review the word ever gets, and a session only has so many of them. At two
 * sightings the commonest words enrolled themselves faster than anything else
 * could — which is why retiring by hand was routine rather than rare. A word
 * looked up this many times is one the reader demonstrably has not retained,
 * which is better evidence than a judgement made mid-sentence.
 *
 * This is the default. The reader can move it in settings, so every caller
 * that can see the settings passes their value instead.
 */
export const MIN_COUNT = 5;

/**
 * Whether the word is in the deck at all: chosen outright with Study, or met
 * often enough to have earned a slot. A word already carrying a schedule stays
 * in regardless — this only gates the first card a word is ever offered.
 */
export function isEnrolled(stat: WordStatistics, minCount: number = MIN_COUNT): boolean {
  return stat.pinned === true || stat.count >= minCount;
}

/**
 * The reader's decisions applied to a word. Retiring a word and choosing it
 * answer the same question opposite ways, so each clears the other. A word
 * carrying both is read inconsistently: the deck leaves it out, the list draws
 * it as studied, and the eviction tiers keep it as wanted. Every path that
 * sets either flag goes through here, so the rule is stated once.
 */
export function applyWordStatus(stat: WordStatistics, status: WordStatus): WordStatistics {
  const next = { ...stat };

  if (status.suppressed !== undefined) {
    if (status.suppressed) {
      next.suppressed = true;
      delete next.pinned;
    } else {
      delete next.suppressed;
    }
  }

  if (status.pinned !== undefined) {
    if (status.pinned) {
      next.pinned = true;
      delete next.suppressed;
    } else {
      delete next.pinned;
    }
  }

  return next;
}

/**
 * Staging reads the scheduler rather than a raw streak, so a word decays out
 * of `mastered` on its own once its recall probability drops — a streak from
 * six months ago is not mastery.
 */
export function getFlashcardStage(
  stat: WordStatistics,
  now: Date = new Date(),
  minCount: number = MIN_COUNT,
): FlashcardStage {
  const fc = stat.flashcard;
  // Seen but not in the deck is its own answer, not a kind of `new`: one is
  // waiting to be taught, the other is waiting to be chosen.
  if (!fc || fc.reviews === 0) return isEnrolled(stat, minCount) ? 'new' : 'candidate';
  if (isLearning(fc)) return 'learning';
  return isMastered(fc, now) ? 'mastered' : 'familiar';
}

/**
 * Where each direction's schedule is stored. Recognition keeps the original
 * `flashcard` key so decks recorded before there were other directions read
 * back unchanged.
 */
export const DIRECTION_FIELD: Readonly<Record<ReviewDirection, keyof WordStatistics>> = {
  recognition: 'flashcard',
  production: 'production',
  listening: 'listening',
  components: 'components',
  writing: 'writing',
};

/** Every schedule a word carries, in the order cards are introduced. */
export const DIRECTION_KEYS = ['flashcard', 'production', 'listening', 'components', 'writing'] as const;

export function progressFor(
  stat: WordStatistics,
  direction: ReviewDirection,
): FlashcardProgress | undefined {
  return stat[DIRECTION_FIELD[direction]] as FlashcardProgress | undefined;
}

/**
 * Every schedule the word actually carries. Four call sites used to walk the
 * direction fields themselves to take a minimum or a maximum of one property;
 * they differ only in which property and which way, so the walk lives here and
 * they keep the part that is theirs.
 */
export function* schedulesOf(stat: WordStatistics): Generator<FlashcardProgress> {
  for (const key of DIRECTION_KEYS) {
    const progress = stat[key];
    if (progress) yield progress;
  }
}

/** The extreme of one property across the word's schedules, or undefined if none has it. */
function acrossSchedules(
  stat: WordStatistics,
  value: (progress: FlashcardProgress) => number | undefined,
  pick: (a: number, b: number) => number,
): number | undefined {
  let chosen: number | undefined;

  for (const progress of schedulesOf(stat)) {
    const candidate = value(progress);
    if (candidate === undefined) continue;
    chosen = chosen === undefined ? candidate : pick(chosen, candidate);
  }

  return chosen;
}

/** When any of the word's cards was last answered, or undefined if none was. */
export function lastReviewedAt(stat: WordStatistics): number | undefined {
  return acrossSchedules(stat, progress => progress.lastReviewed ?? 0, Math.max);
}

/** When the soonest of the word's cards is next due, or undefined if none is scheduled. */
export function nextDueAt(stat: WordStatistics): number | undefined {
  return acrossSchedules(stat, progress => progress.srs?.due, Math.min);
}

function mergeFlashcardProgress(
  sync: FlashcardProgress | undefined,
  local: FlashcardProgress | undefined,
): FlashcardProgress | undefined {
  if (!sync && !local) return undefined;
  if (!sync) return local;
  if (!local) return sync;
  return (sync.lastReviewed ?? 0) >= (local.lastReviewed ?? 0) ? sync : local;
}

/** The snippet from whichever area met the word first — context records a first sighting. */
function mergeContext(sync: WordStatistics, local: WordStatistics): string | undefined {
  if (!sync.context) return local.context;
  if (!local.context) return sync.context;
  return sync.firstSeen <= local.firstSeen ? sync.context : local.context;
}

function mergeWord(sync: WordStatistics, local: WordStatistics): WordStatistics {
  // Spreading both areas first carries every field the branches below do not
  // name, so anything recorded per word survives a merge by default instead of
  // being dropped the first time the word turns up in both areas. Local is
  // spread last because it is the area every write reaches.
  const merged: WordStatistics = {
    ...sync,
    ...local,
    // Each area holds a snapshot of the whole record rather than a share of it,
    // so the larger count is the later one. Summing them counted every sighting
    // that reached both areas twice over, and would compound now that a
    // reconciled record is what gets written back.
    count: Math.max(sync.count, local.count),
    firstSeen: Math.min(sync.firstSeen, local.firstSeen),
    lastSeen: Math.max(sync.lastSeen, local.lastSeen),
  };

  for (const key of DIRECTION_KEYS) {
    const progress = mergeFlashcardProgress(sync[key], local[key]);
    if (progress) merged[key] = progress;
    else delete merged[key];
  }

  const context = mergeContext(sync, local);
  if (context) merged.context = context;
  else delete merged.context;

  // Retiring or choosing a word is a decision, and local is where every
  // decision lands: sync only carries it on to other devices and is skipped
  // whenever the record has outgrown its 8 KB item quota. So local's answer
  // stands, including when that answer is the absence of one — ORing the two
  // made a retirement impossible to undo, since the fossil in sync kept
  // putting it back.
  if (local.suppressed) merged.suppressed = true;
  else delete merged.suppressed;

  // Retiring wins over choosing, which heals a record written before the two
  // were made exclusive: the deck already skipped such a word, so keeping the
  // pin would only have the list disagree with it.
  if (local.pinned && !merged.suppressed) merged.pinned = true;
  else delete merged.pinned;

  return merged;
}

export function mergeStatistics(syncStats: Statistics, localStats: Statistics): Statistics {
  const merged: Statistics = { ...localStats, ...syncStats };

  for (const word in localStats) {
    const syncStat = syncStats[word];
    const localStat = localStats[word];
    if (syncStat && localStat) {
      merged[word] = mergeWord(syncStat, localStat);
    }
  }

  return merged;
}

/**
 * The record as both storage areas together hold it. Reads and writes go
 * through the same reconciliation — a write that transformed one area alone
 * would be editing a record missing every word the other area holds.
 */
export function reconcileStatistics(
  sync: Statistics | undefined,
  local: Statistics | undefined,
): Statistics {
  return mergeStatistics(sync ?? {}, local ?? {});
}
