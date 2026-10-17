import type {
  ContextSighting,
  FlashcardProgress,
  FlashcardRating,
  Statistics,
  WordStatistics,
} from './types.js';

/**
 * How a word is held in `chrome.storage`: one item, `w:<word>`, in a compact
 * encoding of its `WordStatistics`. Sync's quotas are what limit how many words
 * reach the reader's other devices, and in plain JSON most of a reviewed word's
 * bytes were field names — each card spelled out a dozen of them. Local uses
 * the same encoding so both areas go through one codec.
 *
 * The encoding is lossless: fields it has no short form for are kept under
 * their own names, and a card or sentence with such a field is kept whole.
 */
export const WORD_KEY_PREFIX = 'w:';

/** The prefix words were held under in plain JSON, read until rewritten. */
export const LEGACY_WORD_KEY_PREFIX = 'word:';

const RATINGS: readonly FlashcardRating[] = ['again', 'hard', 'good', 'easy'];

const CARD_FIELDS = new Set(['reviews', 'correct', 'consecutiveCorrect', 'lastRating', 'lastReviewed', 'srs']);
const SRS_FIELDS = new Set(['due', 'stability', 'difficulty', 'scheduledDays', 'learningSteps', 'lapses', 'state']);
const CONTEXT_FIELDS = new Set(['text', 'source', 'seen']);
const SOURCE_FIELDS = new Set(['url', 'title']);

const CARDS = {
  flashcard: 'r',
  production: 'p',
  listening: 'h',
  contrast: 'x',
  components: 'k',
  writing: 'g',
} as const;

const FLAGS = {
  decomposable: 'd',
  writable: 'b',
  suppressed: 'u',
  pinned: 'i',
} as const;

const NUMBERS = {
  count: 'n',
  firstSeen: 'f',
  lastSeen: 'l',
  rank: 'q',
  statusAt: 'a',
} as const;

const OTHERS = {
  contexts: 's',
  context: 't',
  confusedWith: 'm',
} as const;

const SHORT_NAMES = new Map<string, string>(Object.entries({ ...CARDS, ...FLAGS, ...NUMBERS, ...OTHERS }));

type Encoded = Record<string, unknown>;

const onlyFields = (value: object, fields: Set<string>) => Object.keys(value).every(key => fields.has(key));

function encodeCard(card: FlashcardProgress): unknown {
  if (!onlyFields(card, CARD_FIELDS) || (card.srs && !onlyFields(card.srs, SRS_FIELDS))) return card;

  const head = [
    card.reviews,
    card.consecutiveCorrect,
    card.correct ?? null,
    card.lastRating === undefined ? null : RATINGS.indexOf(card.lastRating),
    card.lastReviewed ?? null,
  ];
  const { srs } = card;
  if (!srs) return head;
  return [
    ...head,
    srs.due,
    srs.stability,
    srs.difficulty,
    srs.scheduledDays,
    srs.learningSteps,
    srs.lapses,
    srs.state,
  ];
}

function decodeCard(value: unknown): FlashcardProgress {
  if (!Array.isArray(value)) return value as FlashcardProgress;

  const [reviews, consecutiveCorrect, correct, rating, lastReviewed, ...srs] = value as [
    number,
    number,
    number | null,
    number | null,
    number | null,
    ...number[],
  ];
  const card: FlashcardProgress = { reviews, consecutiveCorrect };
  if (correct !== null) card.correct = correct;
  if (rating !== null) card.lastRating = RATINGS[rating]!;
  if (lastReviewed !== null) card.lastReviewed = lastReviewed;
  if (srs.length > 0) {
    const [due, stability, difficulty, scheduledDays, learningSteps, lapses, state] = srs as [
      number, number, number, number, number, number, number,
    ];
    card.srs = { due, stability, difficulty, scheduledDays, learningSteps, lapses, state };
  }
  return card;
}

function encodeContext(sighting: ContextSighting): unknown {
  const { source } = sighting;
  if (!onlyFields(sighting, CONTEXT_FIELDS) || (source && !onlyFields(source, SOURCE_FIELDS))) return sighting;
  if (!source) return [sighting.text, sighting.seen];
  return source.title === undefined
    ? [sighting.text, sighting.seen, source.url]
    : [sighting.text, sighting.seen, source.url, source.title];
}

function decodeContext(value: unknown): ContextSighting {
  if (!Array.isArray(value)) return value as ContextSighting;

  const [text, seen, url, title] = value as [string, number, string?, string?];
  const sighting: ContextSighting = { text, seen };
  if (url !== undefined) sighting.source = title === undefined ? { url } : { url, title };
  return sighting;
}

export function encodeWord(entry: WordStatistics): Encoded {
  const encoded: Encoded = {};
  for (const [field, value] of Object.entries(entry)) {
    if (value === undefined) continue;
    const short = SHORT_NAMES.get(field);
    if (short === undefined) {
      encoded[field] = value;
    } else if (field in CARDS) {
      encoded[short] = encodeCard(value as FlashcardProgress);
    } else if (field in FLAGS) {
      encoded[short] = value ? 1 : 0;
    } else if (field === 'contexts') {
      encoded[short] = (value as ContextSighting[]).map(encodeContext);
    } else {
      encoded[short] = value;
    }
  }
  return encoded;
}

const LONG_NAMES = new Map([...SHORT_NAMES].map(([field, short]) => [short, field]));

export function decodeWord(encoded: Encoded): WordStatistics {
  const entry: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(encoded)) {
    const field = LONG_NAMES.get(key);
    if (field === undefined) entry[key] = value;
    else if (field in CARDS) entry[field] = decodeCard(value);
    else if (field in FLAGS) entry[field] = value === 1;
    else if (field === 'contexts') entry[field] = (value as unknown[]).map(decodeContext);
    else entry[field] = value;
  }
  return entry as unknown as WordStatistics;
}

/** The word a storage item holds, in either layout, or nothing if it holds none. */
export function storedWord(key: string, value: unknown): [string, WordStatistics] | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  if (key.startsWith(WORD_KEY_PREFIX)) {
    return [key.slice(WORD_KEY_PREFIX.length), decodeWord(value as Encoded)];
  }
  if (key.startsWith(LEGACY_WORD_KEY_PREFIX)) {
    return [key.slice(LEGACY_WORD_KEY_PREFIX.length), value as WordStatistics];
  }
  return undefined;
}

/** Whether a storage item holds a word, in either layout. */
export function isWordKey(key: string): boolean {
  return key.startsWith(WORD_KEY_PREFIX) || key.startsWith(LEGACY_WORD_KEY_PREFIX);
}

/** A record's words as the items storage holds them in. */
export function wordItems(words: Statistics): Record<string, Encoded> {
  return Object.fromEntries(
    Object.entries(words).map(([word, entry]) => [WORD_KEY_PREFIX + word, encodeWord(entry)]),
  );
}
