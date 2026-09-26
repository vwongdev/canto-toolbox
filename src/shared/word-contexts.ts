import type { ContextSighting, ContextSource, WordStatistics } from './types.js';

/**
 * The sentences a word keeps. One sentence cues recall of that sentence as
 * much as of the word; a handful from different pages is what shows how the
 * word is used. Past five the list stops teaching and starts costing a stats
 * row its screen, and every write of the word rewrites the list with it.
 */
export const MAX_CONTEXTS = 5;

const MAX_TITLE_CHARS = 120;

/**
 * Two snippets sharing this much of their character pairs are one sentence.
 * The content script windows a long sentence around the hovered character, so
 * the same sentence met twice can come back shifted by a few characters —
 * which compares as around 0.9, where two different sentences built around the
 * same word rarely pass 0.5.
 */
const SAME_SENTENCE_SIMILARITY = 0.8;

/** The word's sentences oldest first, whichever shape the record holds them in. */
export function contextsOf(stat: WordStatistics | undefined): ContextSighting[] {
  if (!stat) return [];
  if (stat.contexts) return stat.contexts;
  // A sentence from before the list existed was the first one met, so the
  // word's first sighting is when it was met.
  return stat.context ? [{ text: stat.context, seen: stat.firstSeen }] : [];
}

/** The sentence the word was first met in — the one hook a single slot keeps. */
export function firstContext(stat: WordStatistics | undefined): ContextSighting | undefined {
  return contextsOf(stat)[0];
}

/**
 * The sentence a card shows on its `turn`th review. Each card is answered at
 * most once a session, so turning with its review count gives each session the
 * next sentence — a cloze always cut from the same sentence ends up testing
 * the reader's memory of that sentence rather than of the word.
 */
export function contextForReview(
  stat: WordStatistics,
  turn: number,
): ContextSighting | undefined {
  const contexts = contextsOf(stat);
  return contexts.length > 0 ? contexts[turn % contexts.length] : undefined;
}

/** Letters and digits only: punctuation and spacing do not make a new sentence. */
function normalise(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]/gu, '');
}

function pairCounts(text: string): Map<string, number> {
  const chars = [...text];
  const counts = new Map<string, number>();
  for (let i = 0; i < chars.length - 1; i++) {
    const pair = chars[i]! + chars[i + 1]!;
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return counts;
}

/** Dice's coefficient over character pairs: 1 for the same text, 0 for none shared. */
function similarity(a: string, b: string): number {
  const pairsA = pairCounts(a);
  const pairsB = pairCounts(b);
  let total = 0;
  let shared = 0;
  for (const count of pairsA.values()) total += count;
  for (const [pair, count] of pairsB) {
    total += count;
    shared += Math.min(count, pairsA.get(pair) ?? 0);
  }
  return total === 0 ? 0 : (2 * shared) / total;
}

export function isSameSentence(a: string, b: string): boolean {
  const left = normalise(a);
  const right = normalise(b);
  if (left === right || left.includes(right) || right.includes(left)) return true;
  return similarity(left, right) >= SAME_SENTENCE_SIMILARITY;
}

/**
 * The list with `sighting` added, if it is a sentence the word does not
 * already hold. A sentence met again keeps its first sighting, gaining only a
 * page to link to if it had none — which is how a sentence recorded before
 * pages were gets one.
 *
 * When the list is full the first sentence stays and the oldest of the rest
 * gives way. The first is the hook the word was learned on and the one a
 * single-sentence export keeps, so it is worth more than its age says; among
 * the rest, recent reading is what the reader will recognise.
 */
export function addContext(
  contexts: readonly ContextSighting[],
  sighting: ContextSighting,
): ContextSighting[] {
  const index = contexts.findIndex(held => isSameSentence(held.text, sighting.text));
  if (index !== -1) {
    const held = contexts[index]!;
    if (held.source || !sighting.source) return [...contexts];
    return contexts.map((entry, i) => (i === index ? { ...held, source: sighting.source! } : entry));
  }

  const added = [...contexts, sighting];
  if (added.length > MAX_CONTEXTS) added.splice(1, added.length - MAX_CONTEXTS);
  return added;
}

/**
 * Both lists as one, as though every sentence had been met on one device in
 * the order it was met — so the same sentence met on two keeps its earlier
 * sighting, and a full list keeps what `addContext` would have kept.
 */
export function mergeContexts(
  a: readonly ContextSighting[],
  b: readonly ContextSighting[],
): ContextSighting[] {
  return [...a, ...b]
    .sort((x, y) => x.seen - y.seen)
    .reduce<ContextSighting[]>(addContext, []);
}

const LOCAL_HOST =
  /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[.*\])$|\.(localhost|local|internal|lan|home\.arpa)$/i;

/**
 * A path segment that reads as a credential rather than a name: a long hex
 * string (reset and invite links), or a long run mixing both cases and digits
 * (share links, document ids). Article slugs are words joined by hyphens and
 * almost never mixed case, so they pass.
 */
function looksSecret(segment: string): boolean {
  if (/^[0-9a-f]{32,}$/i.test(segment)) return true;
  return (
    segment.length >= 24 &&
    /^[\w-]+$/.test(segment) &&
    /\d/.test(segment) &&
    /[a-z]/.test(segment) &&
    /[A-Z]/.test(segment)
  );
}

/**
 * What of the page a sentence was read on is worth keeping. Sync never carries
 * it, but it is written to backup files and shown on the stats page, so only
 * what identifies the page is kept, and nothing that identifies the reader:
 *
 * - Only http(s). Anything else — a local file, an extension or browser page —
 *   is not a page to go back to from somewhere else.
 * - The origin and path, without the query, fragment or any credentials. The
 *   query is where session ids, search terms and tracking live and the
 *   fragment is where sign-in tokens are handed back; the path is what names
 *   an article or thread. A site that names its pages by query links back to
 *   its front page instead, which is the price.
 * - Nothing at all for a machine on the reader's own network, or a path that
 *   looks like it holds a secret: a link that works only there, or works for
 *   anyone holding it, is not one to keep. The title goes with it, since a
 *   private page's title is as private as its address.
 */
export function sourceFrom(url: string, title?: string): ContextSource | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  if (LOCAL_HOST.test(parsed.hostname)) return undefined;
  if (parsed.pathname.split('/').some(looksSecret)) return undefined;

  const cleanTitle = title?.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_CHARS);
  return {
    url: parsed.origin + parsed.pathname,
    ...(cleanTitle && { title: cleanTitle }),
  };
}

/** A link is only drawn for a web page, whatever a restored backup claims. */
export function isLinkable(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
