import { dueAt, isDue, isLearning } from '../shared/scheduler.js';
import { confusionsOf, isEnrolled, progressFor } from '../shared/statistics-utils.js';
import { DEFAULT_SETTINGS, type Settings } from '../shared/settings.js';
import { contextForReview } from '../shared/word-contexts.js';
import type {
  Confusables,
  ContextSighting,
  ReviewDirection,
  Statistics,
  WordStatistics,
} from '../shared/types.js';

/** How big a session is and what may enter it, as the reader has set them. */
export type SessionLimits = Pick<Settings, 'maxCards' | 'maxNewCards' | 'minCount'>;

export interface ReviewCard {
  word: string;
  direction: ReviewDirection;
  /**
   * One of the sentences the word was met in, when any was captured — a
   * different one each time this card comes round, see `contextForReview`.
   */
  context?: ContextSighting;
}

export function cardKey(card: ReviewCard): string {
  return `${card.word}|${card.direction}`;
}

/**
 * What this page can put in front of the reader, as opposed to what the record
 * says is owed. A listening card needs a voice, and whether one exists is a
 * fact about the browser rather than the word.
 */
export interface DeckCapabilities {
  /** A voice for either reading exists, so a listening card can be played. */
  listening?: boolean;
  /**
   * The deck's words paired with the ones they look like, from the dictionary
   * this page does not have. Absent, a contrast card has only the mix-ups the
   * record holds to draw on.
   */
  confusables?: Confusables;
}

/**
 * The words `word` could be taken for, in the order a contrast card offers
 * them: the ones the reader has actually mixed it up with first, then the
 * lookalikes. Only words still in the deck count — a retired word is one the
 * reader has said they know.
 */
export function partnersOf(
  word: string,
  statistics: Statistics,
  capabilities: DeckCapabilities,
): string[] {
  const partners = new Set([...confusionsOf(statistics[word]), ...(capabilities.confusables?.[word] ?? [])]);
  partners.delete(word);
  return [...partners].filter(partner => statistics[partner] && !statistics[partner].suppressed);
}

/**
 * The order a word's cards are introduced. Recognition comes first because it
 * is what reading already half-teaches; the others ask for what reading never
 * tests, and none is worth asking about a word the reader cannot yet
 * recognise. Listening follows production so that a deck gaining it does not
 * hold back the recall card it already had. Writing comes last: it is the only
 * card that asks the reader to produce the character stroke by stroke rather
 * than just name or pick it. Contrast follows the cards that test the word on
 * its own, since telling it from its lookalikes asks for a surer grasp of it.
 */
const INTRODUCTION_ORDER: readonly ReviewDirection[] = [
  'recognition',
  'production',
  'listening',
  'contrast',
  'components',
  'writing',
];

/**
 * A card this page cannot play is neither introduced nor owed. Skipping a due
 * one leaves its schedule untouched for a browser that has the voice, or a
 * deck that has the lookalikes, rather than letting it hold a slot — or the
 * "next review" line — it can never fill.
 */
function isOffered(
  word: string,
  direction: ReviewDirection,
  statistics: Statistics,
  capabilities: DeckCapabilities,
): boolean {
  if (direction === 'listening') return capabilities.listening === true;
  if (direction === 'contrast') return partnersOf(word, statistics, capabilities).length > 0;
  return true;
}

function isUnlocked(stat: WordStatistics, direction: ReviewDirection, minCount: number): boolean {
  if (direction === 'recognition') return isEnrolled(stat, minCount);

  // Producing a word, hearing it, taking it apart, or writing it tests nothing
  // until it is recognised reliably — which is exactly what leaving the
  // learning steps means.
  const recognition = stat.flashcard;
  if (!recognition?.srs || isLearning(recognition)) return false;

  // Dispatched rather than defaulted: a direction added later must state its
  // own gate instead of silently inheriting the one above it.
  if (direction === 'production' || direction === 'listening' || direction === 'contrast') return true;
  if (direction === 'components') return stat.decomposable === true;
  return stat.writable === true;
}

function toCard(word: string, stat: WordStatistics, direction: ReviewDirection): ReviewCard {
  const context = contextForReview(stat, progressFor(stat, direction)?.reviews ?? 0);
  return {
    word,
    direction,
    ...(context && { context }),
  };
}

/**
 * The one card this word offers the session. A word never appears twice in a
 * session: answering 電話 and then being asked to produce it minutes later
 * tests the session's memory rather than the reader's.
 */
function chooseCard(
  word: string,
  statistics: Statistics,
  now: number,
  capabilities: DeckCapabilities,
  minCount: number,
): { card: ReviewCard; due: number } | { card: ReviewCard; introduce: true } | null {
  const stat = statistics[word]!;
  const directions = INTRODUCTION_ORDER.filter(direction =>
    isOffered(word, direction, statistics, capabilities),
  );
  let owed: { direction: ReviewDirection; due: number } | null = null;

  for (const direction of directions) {
    const progress = progressFor(stat, direction);
    if (!progress?.srs) continue;
    if (!isDue(progress, now)) continue;

    const due = dueAt(progress);
    if (!owed || due < owed.due) owed = { direction, due };
  }

  if (owed) return { card: toCard(word, stat, owed.direction), due: owed.due };

  for (const direction of directions) {
    if (progressFor(stat, direction)?.srs) continue;
    if (!isUnlocked(stat, direction, minCount)) continue;
    return { card: toCard(word, stat, direction), introduce: true };
  }

  return null;
}

/**
 * Which unseen word is worth a session slot. The commonest word the reader has
 * met pays back the most for the same effort, so new cards follow the corpus
 * rank rather than arriving in whatever order a shuffle produced. A word the
 * corpus never ranked is rarer than its cap and goes last; ties fall back to
 * how often the reader has actually met it.
 */
function compareNewWords(a: WordStatistics, b: WordStatistics): number {
  const rankA = a.rank ?? Infinity;
  const rankB = b.rank ?? Infinity;
  if (rankA !== rankB) return rankA - rankB;
  return b.count - a.count;
}

/**
 * A session is the cards the scheduler says are owed, most overdue first,
 * topped up with cards not yet introduced. Words already in the deck stay
 * eligible however rarely they are hovered; new ones still have to clear the
 * exposure gate, and retired ones are left out entirely. New cards have a cap
 * of their own inside the session's, so due reviews are never crowded out.
 */
export function selectSession(
  statistics: Statistics,
  now: number = Date.now(),
  capabilities: DeckCapabilities = {},
  { maxCards, maxNewCards, minCount }: SessionLimits = DEFAULT_SETTINGS,
): ReviewCard[] {
  const due: Array<{ card: ReviewCard; due: number }> = [];
  const fresh: Array<{ card: ReviewCard; stat: WordStatistics }> = [];

  for (const [word, stat] of Object.entries(statistics)) {
    if (stat.suppressed) continue;

    const chosen = chooseCard(word, statistics, now, capabilities, minCount);
    if (!chosen) continue;

    if ('due' in chosen) due.push(chosen);
    else fresh.push({ card: chosen.card, stat });
  }

  due.sort((a, b) => a.due - b.due);
  fresh.sort((a, b) => compareNewWords(a.stat, b.stat));

  const reviews = due.slice(0, maxCards).map(entry => entry.card);
  const room = Math.min(maxNewCards, maxCards - reviews.length);

  return [...reviews, ...fresh.slice(0, room).map(entry => entry.card)];
}

/** Epoch ms of the soonest scheduled review across every card this page can offer. */
export function nextReviewAt(
  statistics: Statistics,
  capabilities: DeckCapabilities = {},
): number | undefined {
  let soonest: number | undefined;

  for (const [word, stat] of Object.entries(statistics)) {
    if (stat.suppressed) continue;

    for (const direction of INTRODUCTION_ORDER) {
      if (!isOffered(word, direction, statistics, capabilities)) continue;
      const due = progressFor(stat, direction)?.srs?.due;
      if (due === undefined) continue;
      if (soonest === undefined || due < soonest) soonest = due;
    }
  }

  return soonest;
}
