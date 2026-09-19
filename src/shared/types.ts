// Type definitions for the extension

export type EtymologyType = 'pictophonetic' | 'ideographic' | 'pictographic';

export interface CharacterEtymology {
  character: string;
  definition?: string;
  decomposition: string;
  radical: string;
  etymologyType?: EtymologyType;
  hint?: string;
  phonetic?: string;
  semantic?: string;
  componentDefinitions?: Record<string, string>;
  /**
   * Components the dictionaries hold an entry for, added at lookup time. These
   * are the parts a breakdown can be followed into; the rest are labels.
   */
  componentsWithEntries?: string[];
}

export type EtymologyDictionary = Record<string, CharacterEtymology>;

/**
 * One character's stroke graphics, as `build-tools/build-strokes.ts` writes
 * them. The shape is makemeahanzi's own and is what hanzi-writer expects, so
 * the data passes through untouched.
 */
export interface CharacterStrokes {
  /** SVG path data per stroke, in stroke order. */
  strokes: string[];
  /** The centre line of each stroke, used to grade what the reader drew. */
  medians: number[][][];
}

export interface DictionaryEntry {
  traditional: string;
  simplified: string;
  romanisation: string; // Pinyin for Mandarin, Jyutping for Cantonese
  definitions: string[];
}

export type Dictionary = Record<string, DictionaryEntry[]>;

/**
 * On-disk form of {@link Dictionary}. Each unique entry is stored once in
 * `rows`; `index` maps both the simplified and traditional forms to the row
 * (or rows) they share. A single hit is a number rather than a one-element
 * array, which is the common case.
 */
export type CompactDictionaryEntry = [
  traditional: string,
  simplified: string,
  romanisation: string,
  definitions: string[],
];

export interface CompactDictionary {
  rows: CompactDictionaryEntry[];
  index: Record<string, number | number[]>;
}

/** Word → its rank in the SUBTLEX-CH corpus, 1 being the commonest. */
export type FrequencyRanks = Record<string, number>;

export type FrequencyBand = 'core' | 'common' | 'frequent' | 'uncommon' | 'rare';

export type FlashcardRating = 'again' | 'hard' | 'good' | 'easy';
export type FlashcardStage = 'candidate' | 'new' | 'learning' | 'familiar' | 'mastered';

/**
 * What a card asks for. Recognition (word → meaning) is what reading trains on
 * its own; the other three are what reading never tests, so each carries its
 * own schedule rather than riding on the recognition card.
 */
export type ReviewDirection = 'recognition' | 'production' | 'components' | 'writing';

/**
 * Compact projection of an FSRS card. Dates are epoch milliseconds and reals
 * are rounded, because every tracked word's progress shares one storage item.
 */
export interface SrsState {
  /** Epoch ms at which the word is next due for review. */
  due: number;
  /** Days the memory is expected to last from the last review. */
  stability: number;
  difficulty: number;
  scheduledDays: number;
  learningSteps: number;
  lapses: number;
  /** FSRS `State`: 0 New, 1 Learning, 2 Review, 3 Relearning. */
  state: number;
}

export interface FlashcardProgress {
  reviews: number;
  /** Reviews answered Good or Easy, for the accuracy the stats page reports. */
  correct?: number;
  consecutiveCorrect: number;
  lastRating?: FlashcardRating;
  lastReviewed?: number;
  /** Absent until the word's first review. */
  srs?: SrsState;
}

export interface WordStatistics {
  count: number;
  firstSeen: number;
  lastSeen: number;
  /** Recognition progress. The original single-card key, kept for stored data. */
  flashcard?: FlashcardProgress;
  /** Meaning → word. Unlocked once recognition leaves its learning steps. */
  production?: FlashcardProgress;
  /** Character → its parts. Only for single characters the etymology covers. */
  components?: FlashcardProgress;
  /** Stroke order. Only for single characters the stroke data covers. */
  writing?: FlashcardProgress;
  /**
   * A snippet of the sentence the word was first met in. The strongest memory
   * hook available and free to capture, so it is kept for recall — one per
   * word, since every tracked word shares a single storage item.
   */
  context?: string;
  /** SUBTLEX-CH rank recorded at track time, so study order can follow it. */
  rank?: number;
  /** True once the character has parts worth drilling, decided at track time. */
  decomposable?: boolean;
  /** True once the character has packaged strokes, decided at track time. */
  writable?: boolean;
  /** Retired by the reader, or buried automatically as a leech. */
  suppressed?: boolean;
  /** Added deliberately, so it skips the exposure gate new words wait behind. */
  pinned?: boolean;
}

export interface Statistics {
  [word: string]: WordStatistics;
}

export interface WordFrequency {
  /** 1 is the commonest word in the corpus. */
  rank: number;
  band: FrequencyBand;
}

export interface DefinitionResult {
  word: string;
  mandarin: {
    entries: DictionaryEntry[];
  };
  cantonese: {
    entries: DictionaryEntry[];
  };
  etymology?: CharacterEtymology[];
  /** Absent when the word is rarer than the corpus cap. */
  frequency?: WordFrequency;
  /**
   * Characters of a compound the dictionaries hold an entry for, added at
   * lookup time. These are the parts of the headword a reader can follow into;
   * a single-character word has none.
   */
  charactersWithEntries?: string[];
}

/**
 * The run of Chinese text under the cursor and the hovered index within it.
 * Segmentation needs the dictionary, which lives in the service worker, so the
 * content script sends the raw run and lets the lookup pick the word.
 */
export interface HoverSegment {
  run: string;
  offset: number;
}

/** A rectangle in the source image's own (natural) pixel coordinates. */
export interface OcrBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One recognised run of text and where it sits in the image. */
export interface OcrItem {
  text: string;
  box: OcrBox;
}

/**
 * What an image turned out to say. The boxes are natural pixels, so the
 * overlay can scale them to whatever size the page happens to render the
 * image at without re-reading it.
 */
export interface OcrResult {
  width: number;
  height: number;
  items: OcrItem[];
}

export interface OcrImageMessage {
  type: 'ocr_image';
  /** An http(s) URL to fetch, or a `data:` URL when the source is page-scoped. */
  src: string;
}

/**
 * The service worker's hop to the offscreen document. A worker cannot hold a
 * WebAssembly model across its own teardown, so the engine lives in the
 * offscreen document and the worker only forwards to it.
 */
export interface OcrRunMessage {
  type: 'ocr_run';
  src: string;
}

/**
 * Screenshot the visible tab. The last resort for a video frame the page will
 * not let a canvas read: a screenshot sees what was composited, so it works
 * for cross-origin media, but only at the size the frame is drawn on screen.
 */
export interface CaptureTabMessage {
  type: 'capture_tab';
}

/**
 * The service worker's hop to the offscreen document for a dictionary
 * lookup. The parsed maps live there so a discarded worker does not throw
 * them away; the worker only forwards.
 */
export interface DictLookupMessage {
  type: 'dict_lookup';
  word: string;
  segment?: HoverSegment;
  /**
   * Return whatever the maps hold, even if empty, instead of throwing.
   * Used when describing a tracked word: a missing rank is not a failed study.
   */
  allowMissing?: boolean;
}

export interface LookupMessage {
  type: 'lookup_word';
  word: string;
  segment?: HoverSegment;
}

export interface TrackWordMessage {
  type: 'track_word';
  word: string;
  /** Sentence the word was met in, recorded the first time it is studied. */
  context?: string;
  /** Set when the reader asked for the word outright rather than dwelling on it. */
  pin?: boolean;
}

/** The reader's own decisions about a word, as opposed to what was observed. */
export interface WordStatus {
  suppressed?: boolean;
  pinned?: boolean;
}

/** Retire a word from review, or put a retired one back. */
export interface SetWordStatusMessage extends WordStatus {
  type: 'set_word_status';
  word: string;
}

export interface GetStatisticsMessage {
  type: 'get_statistics';
}

export interface UpdateFlashcardMessage {
  type: 'update_flashcard';
  word: string;
  rating: FlashcardRating;
  /** Omitted by older callers, which only ever rated the recognition card. */
  direction?: ReviewDirection;
}

export type BackgroundMessage =
  | LookupMessage
  | TrackWordMessage
  | GetStatisticsMessage
  | UpdateFlashcardMessage
  | SetWordStatusMessage
  | OcrImageMessage
  | OcrRunMessage
  | CaptureTabMessage
  | DictLookupMessage;

export interface LookupResponse {
  success: true;
  type: 'lookup_word';
  definition: DefinitionResult;
}

export interface ErrorResponse {
  success: false;
  error: string;
  errorName?: string;
}

export interface StatisticsResponse {
  success: true;
  type: 'get_statistics';
  statistics: Statistics;
}

export interface TrackWordResponse {
  success: true;
  type: 'track_word';
}

export interface UpdateFlashcardResponse {
  success: true;
  type: 'update_flashcard';
}

export interface SetWordStatusResponse {
  success: true;
  type: 'set_word_status';
}

export interface OcrImageResponse {
  success: true;
  type: 'ocr_image';
  result: OcrResult;
}

export interface OcrRunResponse {
  success: true;
  type: 'ocr_run';
  result: OcrResult;
}

export interface CaptureTabResponse {
  success: true;
  type: 'capture_tab';
  /** PNG data URL of the whole visible viewport, in device pixels. */
  dataUrl: string;
}

export interface DictLookupResponse {
  success: true;
  type: 'dict_lookup';
  definition: DefinitionResult;
}

export type BackgroundResponse =
  | LookupResponse
  | ErrorResponse
  | StatisticsResponse
  | TrackWordResponse
  | UpdateFlashcardResponse
  | SetWordStatusResponse
  | OcrImageResponse
  | OcrRunResponse
  | CaptureTabResponse
  | DictLookupResponse;

// Every non-error response carries a `type` that matches its request, so the
// success response for a given message is derivable from the union — no
// hand-written per-call validator needed.
export type SuccessResponse = Exclude<BackgroundResponse, ErrorResponse>;
export type ResponseFor<M extends BackgroundMessage> = Extract<SuccessResponse, { type: M['type'] }>;
