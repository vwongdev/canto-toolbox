import type { DefinitionResult, DictionaryEntry, Statistics } from '../shared/types.js';
import { getFlashcardStage } from '../shared/statistics-utils.js';
import { toSyllables } from '../shared/pinyin.js';

/**
 * Which words leave for another flashcard app. The deck is what this
 * extension would itself drill — enrolled or already scheduled, and not
 * retired — so exporting it moves the reader's study, not their browsing.
 */
export type ExportScope = 'deck' | 'all';

export function wordsToExport(statistics: Statistics, scope: ExportScope): string[] {
  return Object.entries(statistics)
    .filter(([, stat]) =>
      scope === 'all' || (!stat.suppressed && getFlashcardStage(stat) !== 'candidate'))
    .sort(([, a], [, b]) => a.firstSeen - b.firstSeen)
    .map(([word]) => word);
}

/** One word as the export formats need it, with every reading it has. */
export interface ExportCard {
  traditional: string;
  simplified: string;
  /** CC-CEDICT's numbered form, e.g. `nu:3`; each format renders its own. */
  pinyin: string[];
  jyutping: string[];
  definitions: string[];
  context?: string;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

/**
 * A dictionary headword can stand for more than one written word — 发 is both
 * 發 and 髮 — and a card can only carry one. The first entry decides which, as
 * it does at the top of the popup, and the rest are kept only if they spell the
 * same word.
 */
export function cardFromDefinition(
  word: string,
  definition: DefinitionResult | undefined,
  context?: string,
): ExportCard {
  const mandarin = definition?.mandarin.entries ?? [];
  const cantonese = definition?.cantonese.entries ?? [];
  const head = mandarin[0] ?? cantonese[0];

  const traditional = head?.traditional ?? word;
  const simplified = head?.simplified ?? word;
  const sameWord = (entry: DictionaryEntry): boolean =>
    entry.traditional === traditional && entry.simplified === simplified;

  const mandarinEntries = mandarin.filter(sameWord);
  const cantoneseEntries = cantonese.filter(sameWord);

  return {
    traditional,
    simplified,
    pinyin: unique(mandarinEntries.map(entry => entry.romanisation)),
    jyutping: unique(cantoneseEntries.map(entry => entry.romanisation)),
    definitions: unique(
      [...mandarinEntries, ...cantoneseEntries].flatMap(entry => entry.definitions)
    ),
    ...(context && { context }),
  };
}

/** Numbered Pinyin as it reads on a card: `nu:3` → `nǚ`. */
export function markPinyin(pinyin: string): string {
  return toSyllables(pinyin, 'pinyin').map(syllable => syllable.text).join('');
}

/**
 * One field of Anki's delimited import. A field holding the separator, a
 * newline or a quote is wrapped in quotes with its own quotes doubled — Anki
 * reads the file as CSV with a tab delimiter. A leading `#` is quoted too, so a
 * row can never be mistaken for one of the header lines.
 */
export function escapeAnkiField(value: string): string {
  if (!/["\t\r\n]/.test(value) && !value.startsWith('#')) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export const ANKI_COLUMNS = [
  'Traditional',
  'Simplified',
  'Jyutping',
  'Pinyin',
  'Definition',
  'Context',
] as const;

export interface AnkiOptions {
  /**
   * Header lines Anki 2.1.54 and later read to set the separator and name the
   * columns. Older versions do not understand them.
   */
  header?: boolean;
}

export function toAnki(cards: ExportCard[], { header = true }: AnkiOptions = {}): string {
  const lines = header
    ? ['#separator:tab', '#html:false', `#columns:${ANKI_COLUMNS.join('\t')}`]
    : [];

  for (const card of cards) {
    const fields = [
      card.traditional,
      card.simplified,
      card.jyutping.join(' / '),
      card.pinyin.map(markPinyin).join(' / '),
      card.definitions.join('; '),
      card.context ?? '',
    ];
    lines.push(fields.map(escapeAnkiField).join('\t'));
  }

  return lines.join('\n') + '\n';
}

/**
 * Pleco's import has no quoting at all: a tab ends the field and a newline
 * ends the card. Both are folded into a space so a definition cannot split
 * into a second, broken card.
 */
function plecoField(value: string): string {
  return value.replace(/\s*[\t\r\n]+\s*/g, ' ').trim();
}

/**
 * Pleco's flashcard text format: `简体[繁體]<TAB>pinyin<TAB>definition`, one
 * card per line. The bracket is left out when both scripts agree. Pleco takes
 * one reading per card, so a word read more than one way keeps its first, and
 * numbered Pinyin is what Pleco parses most reliably — only CC-CEDICT's `u:`
 * is spelt out as `ü`.
 */
export function toPleco(cards: ExportCard[]): string {
  const lines = cards.map(card => {
    const headword = card.simplified === card.traditional
      ? card.simplified
      : `${card.simplified}[${card.traditional}]`;
    const pinyin = (card.pinyin[0] ?? '').replace(/u:/g, 'ü').replace(/U:/g, 'Ü');

    return [headword, pinyin, card.definitions.join('; ')].map(plecoField).join('\t');
  });

  return lines.join('\n') + '\n';
}

/**
 * Looks every word up through the page's own lookup, a few at a time. The
 * dictionary answers from one offscreen document, so running hundreds of
 * requests at once only queues them there; a small window keeps progress
 * honest without serialising the whole wait. A word the dictionary cannot find
 * still becomes a card — its headword and sentence are worth keeping.
 */
export async function collectCards(
  words: string[],
  statistics: Statistics,
  lookup: (word: string) => Promise<DefinitionResult | undefined>,
  onProgress: (done: number, total: number) => void = () => {},
  concurrency = 4,
): Promise<ExportCard[]> {
  const cards: ExportCard[] = new Array(words.length);
  let next = 0;
  let done = 0;

  const worker = async (): Promise<void> => {
    while (next < words.length) {
      const index = next++;
      const word = words[index]!;
      const definition = await lookup(word).catch(() => undefined);
      cards[index] = cardFromDefinition(word, definition, statistics[word]?.context);
      onProgress(++done, words.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, words.length) }, worker));
  return cards;
}
