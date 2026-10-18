import type { CompactDictionary, CompactDictionaryEntry } from '../shared/types.js';

/** A dictionary word a search found, before its readings and gloss are filled in. */
export interface SearchMatch {
  /** The form the query was written in; the traditional form for a query in English or romanisation. */
  word: string;
  traditional: string;
  simplified: string;
  rank?: number;
}

export interface SearchLimits {
  /** Matches the reader has already met, which lead the results. */
  seen: number;
  others: number;
}

export type Searcher = (query: string, seen: ReadonlySet<string>, limits: SearchLimits) => SearchMatch[];

const EXACT = 0;
const PREFIX = 1;
const CONTAINS = 2;

interface Candidate extends SearchMatch {
  tier: number;
  /** Matched on the word's first sense, which is what it chiefly means. */
  primary: boolean;
}

interface Match {
  tier: number;
  primary: boolean;
}

/** Per-row text for English and romanisation queries, built on the first one. */
interface RowText {
  row: CompactDictionaryEntry;
  toned: string;
  toneless: string;
  senses: string;
}

const HAN = /\p{Script=Han}/u;
const ROMANISATION = /^[a-z0-9\s'ü:]+$/;
const LEADING_FILLER = /^(?:to|a|an|the) /;
const BRACKETED = /\([^)]*\)|\[[^\]]*\]/g;

/**
 * CC-CEDICT writes ü as `u:` and both dictionaries space their syllables. A
 * reader types `nihao`, `ni hao` or `ni3hao3`, and rarely has ü to hand, so
 * every spelling of it folds to `u`.
 */
function normaliseRomanisation(text: string): string {
  return text.toLowerCase().replace(/u:|ü|v/g, 'u').replace(/[\s'·-]/g, '');
}

/** A sense without its glosses-on-the-gloss: "(of a person) kind" is "kind", "to eat" is "eat". */
function bareSense(sense: string): string {
  return sense.replace(BRACKETED, '').replace(/\s+/g, ' ').trim().replace(LEADING_FILLER, '');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasDefinition(row: CompactDictionaryEntry): boolean {
  return row[3].some(sense => sense.trim().length > 0);
}

/**
 * How well one sense list answers an English query: a sense that is the query
 * outright, one that starts with it, or one that holds it as whole words.
 */
function englishMatch(senses: string, query: string, wholeWord: RegExp): Match | undefined {
  if (!senses.includes(query)) return undefined;

  let best: Match | undefined;
  senses.split('\n').forEach((sense, index) => {
    // CC-CEDICT packs synonyms into one sense: "to eat; to consume".
    for (const synonym of sense.split(';')) {
      const bare = bareSense(synonym);
      const tier = bare === query
        ? EXACT
        : bare.startsWith(query) && !/[a-z]/.test(bare.charAt(query.length))
          ? PREFIX
          : wholeWord.test(synonym) ? CONTAINS : undefined;
      if (tier !== undefined && (!best || tier < best.tier)) best = { tier, primary: index === 0 };
    }
  });
  return best;
}

/** A reading is all a word says, so a match on it counts as a match on what the word chiefly means. */
function romanisationMatch(row: RowText, query: string, toned: boolean): Match | undefined {
  const reading = toned ? row.toned : row.toneless;
  if (reading === query) return { tier: EXACT, primary: true };
  if (reading.startsWith(query)) return { tier: PREFIX, primary: true };
  return undefined;
}

function rankKey(candidate: Candidate): number {
  return candidate.rank ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Best tier first, and within it any word the corpus ranks before the many it
 * does not. Then a word that chiefly means the query, so 吃 leads 用 for "eat"
 * although 用 is commoner; then the commoner word, then the shorter.
 */
function byRelevance(a: Candidate, b: Candidate): number {
  return a.tier - b.tier
    || Number(a.rank === undefined) - Number(b.rank === undefined)
    || Number(b.primary) - Number(a.primary)
    || rankKey(a) - rankKey(b)
    || [...a.word].length - [...b.word].length;
}

/**
 * Searches both dictionaries by headword, English sense, pinyin or Jyutping.
 * A query holding a Chinese character matches headwords; anything else is
 * tried as English and as romanisation at once, since "he" and "man" are both.
 * Words longer than `maxLength` are left out: the reader can never hover one,
 * so it could never be looked up or tracked as itself.
 */
export function createSearcher(
  mandarin: CompactDictionary,
  cantonese: CompactDictionary,
  rankOf: (traditional: string, simplified: string) => number | undefined,
  maxLength: number,
): Searcher {
  const dicts = [mandarin, cantonese];
  let headwords: { key: string; dict: CompactDictionary }[] | null = null;
  let rowTexts: RowText[] | null = null;
  let defined: Set<string> | null = null;

  const fits = (word: string): boolean => [...word].length <= maxLength;
  const idOf = (row: CompactDictionaryEntry): string => `${row[0]}\u0000${row[1]}`;

  /**
   * Whether either dictionary defines the row's word. CC-Canto gives many
   * words a Jyutping reading and no English, and 你好 is still found by
   * `nei5 hou2` through the sense CC-CEDICT gives it.
   */
  function isDefined(row: CompactDictionaryEntry): boolean {
    defined ??= new Set(dicts.flatMap(dict => dict.rows.filter(hasDefinition).map(idOf)));
    return defined.has(idOf(row));
  }

  function rowsOf(dict: CompactDictionary, key: string): CompactDictionaryEntry[] {
    const ids = dict.index[key];
    if (ids === undefined) return [];
    return (typeof ids === 'number' ? [ids] : ids).map(id => dict.rows[id]!);
  }

  function searchHeadwords(query: string, found: Map<string, Candidate>): void {
    headwords ??= dicts.flatMap(dict => Object.keys(dict.index).map(key => ({ key, dict })));

    for (const { key, dict } of headwords) {
      if (!key.includes(query) || !fits(key)) continue;
      const tier = key === query ? EXACT : key.startsWith(query) ? PREFIX : CONTAINS;

      for (const row of rowsOf(dict, key)) {
        if (isDefined(row)) consider(found, row, key, { tier, primary: true });
      }
    }
  }

  function searchText(query: string, found: Map<string, Candidate>): void {
    rowTexts ??= dicts.flatMap(dict =>
      dict.rows.filter(row => fits(row[0]) && isDefined(row)).map(row => {
        const toned = normaliseRomanisation(row[2]);
        return { row, toned, toneless: toned.replace(/\d/g, ''), senses: row[3].join('\n').toLowerCase() };
      }),
    );

    const english = bareSense(query);
    const wholeWord = new RegExp(`(?:^|[^a-z])${escapeRegExp(english)}(?:$|[^a-z])`);
    const reading = ROMANISATION.test(query) ? normaliseRomanisation(query) : '';
    const toned = /\d/.test(reading);

    for (const text of rowTexts) {
      const byReading = reading ? romanisationMatch(text, reading, toned) : undefined;
      const byEnglish = english ? englishMatch(text.senses, english, wholeWord) : undefined;
      const best = byReading && byEnglish
        ? (byEnglish.tier < byReading.tier ? byEnglish : byReading)
        : byReading ?? byEnglish;
      if (best) consider(found, text.row, text.row[0], best);
    }
  }

  /** One candidate per word, however many rows or readings matched it, keeping its best match. */
  function consider(found: Map<string, Candidate>, row: CompactDictionaryEntry, word: string, match: Match): void {
    const id = idOf(row);
    const held = found.get(id);
    if (held) {
      if (match.tier < held.tier || (match.tier === held.tier && match.primary)) {
        held.tier = match.tier;
        held.primary = match.primary;
      }
      return;
    }

    const [traditional, simplified] = row;
    const rank = rankOf(traditional, simplified);
    found.set(id, { word, traditional, simplified, ...match, ...(rank !== undefined && { rank }) });
  }

  return (rawQuery, seen, limits) => {
    const query = rawQuery.trim().toLowerCase();
    if (!query) return [];

    const found = new Map<string, Candidate>();
    if (HAN.test(query)) searchHeadwords(query, found);
    else searchText(query, found);

    const isSeen = (c: Candidate): boolean =>
      seen.has(c.word) || seen.has(c.traditional) || seen.has(c.simplified);

    const ranked = [...found.values()].sort(byRelevance);
    const met = ranked.filter(isSeen).slice(0, limits.seen);
    const others = ranked.filter(c => !isSeen(c)).slice(0, limits.others);

    return [...met, ...others].map(({ word, traditional, simplified, rank }) => ({
      word,
      traditional,
      simplified,
      ...(rank !== undefined && { rank }),
    }));
  };
}
