import type {
  CompactDictionary,
  CompactDictionaryEntry,
  DictionaryEntry,
  DefinitionResult,
  EtymologyDictionary,
  FrequencyRanks,
  CharacterEtymology,
  WordFrequency,
} from '../shared/types.js';
import { parseComponents } from '../shared/decomposition.js';
import { bandForRank } from '../shared/frequency.js';

const CANTONESE_MARKER = '(cantonese)';
const MAX_WORD_LENGTH = 4;

const EMPTY_DICT: CompactDictionary = { rows: [], index: {} };

let mandarinDict: CompactDictionary = EMPTY_DICT;
let cantoneseDict: CompactDictionary = EMPTY_DICT;
let etymologyDict: EtymologyDictionary = {};
let frequencyRanks: FrequencyRanks = {};

let dictionariesPromise: Promise<void> | null = null;

export function initDictionaries(): Promise<void> {
  if (!dictionariesPromise) {
    dictionariesPromise = Promise.all([
      fetch(chrome.runtime.getURL('data/mandarin.json')).then(r => r.json() as Promise<CompactDictionary>),
      fetch(chrome.runtime.getURL('data/cantonese.json')).then(r => r.json() as Promise<CompactDictionary>),
      fetch(chrome.runtime.getURL('data/etymology.json')).then(r => r.json() as Promise<EtymologyDictionary>),
      fetch(chrome.runtime.getURL('data/frequency.json')).then(r => r.json() as Promise<FrequencyRanks>),
    ]).then(([mandarin, cantonese, etymology, frequency]) => {
      mandarinDict = mandarin;
      cantoneseDict = cantonese;
      etymologyDict = etymology;
      frequencyRanks = frequency;
    });
  }
  return dictionariesPromise;
}

/**
 * The corpus is keyed by simplified forms, so a traditional word is found
 * through its entries' simplified counterpart.
 */
export function lookupFrequency(word: string, entries: DictionaryEntry[]): WordFrequency | undefined {
  let rank = frequencyRanks[word];

  if (rank === undefined) {
    for (const entry of entries) {
      const simplified = entry.simplified;
      if (simplified && simplified !== word && frequencyRanks[simplified] !== undefined) {
        rank = frequencyRanks[simplified];
        break;
      }
    }
  }

  return rank === undefined ? undefined : { rank, band: bandForRank(rank) };
}

function decodeEntry(row: CompactDictionaryEntry): DictionaryEntry {
  return {
    traditional: row[0],
    simplified: row[1],
    romanisation: row[2],
    definitions: row[3],
  };
}

function lookupInDict(dict: CompactDictionary, word: string): DictionaryEntry[] {
  const ids = dict.index[word];
  if (ids === undefined) return [];

  const rows = typeof ids === 'number' ? [ids] : ids;
  return rows.map(id => decodeEntry(dict.rows[id]!));
}

function filterOutCantoneseDefinitions(mandarinEntries: DictionaryEntry[]): DictionaryEntry[] {
  const filteredEntries: DictionaryEntry[] = [];

  for (const entry of mandarinEntries) {
    const filteredDefs = (entry.definitions || []).filter(
      def => def && def.trim().length > 0 && !def.toLowerCase().includes(CANTONESE_MARKER.toLowerCase())
    );

    if (filteredDefs.length > 0) {
      filteredEntries.push({
        ...entry,
        definitions: filteredDefs
      });
    }
  }

  return filteredEntries;
}

function processDictionaryLookup(
  dict: CompactDictionary,
  word: string,
  filterCantonese: boolean
): DictionaryEntry[] {
  const entries = lookupInDict(dict, word);
  return filterCantonese ? filterOutCantoneseDefinitions(entries) : entries;
}

/**
 * Breakdowns already assembled, capped because the service worker outlives any
 * one page and the keys come from whatever the reader hovers. Insertion order
 * makes the Map its own queue: the oldest key is the first one it yields, so
 * the least recently added entry is the one dropped.
 */
const ETYMOLOGY_CACHE_LIMIT = 2000;
const etymologyCache = new Map<string, CharacterEtymology[]>();

function cacheEtymology(word: string, result: CharacterEtymology[]): void {
  etymologyCache.set(word, result);

  while (etymologyCache.size > ETYMOLOGY_CACHE_LIMIT) {
    const oldest = etymologyCache.keys().next();
    if (oldest.done) break;
    etymologyCache.delete(oldest.value);
  }
}

/**
 * The components of `entry` that are words in their own right. A breakdown is
 * only worth following into where the dictionaries have something to show, and
 * the character itself is not a part of itself. The chips a breakdown can
 * render come from the decomposition or from the phonosemantic pair, so both
 * are offered.
 */
function linkableComponents(entry: CharacterEtymology): string[] {
  const shown = new Set(parseComponents(entry.decomposition));
  if (entry.semantic) shown.add(entry.semantic);
  if (entry.phonetic) shown.add(entry.phonetic);
  shown.delete(entry.character);

  return [...shown].filter(comp => hasValidDefinition(lookupEntries(comp)));
}

export function lookupEtymology(word: string): CharacterEtymology[] {
  const cached = etymologyCache.get(word);
  if (cached) return cached;

  const result = [...word]
    .map(char => {
      const entry = etymologyDict[char];
      if (!entry) return undefined;

      const toResolve = new Set<string>();
      if (entry.semantic) toResolve.add(entry.semantic);
      if (entry.phonetic) toResolve.add(entry.phonetic);
      if (toResolve.size === 0) {
        for (const component of parseComponents(entry.decomposition)) toResolve.add(component);
      }

      const componentDefinitions: Record<string, string> = {};
      for (const comp of toResolve) {
        const def = etymologyDict[comp]?.definition;
        if (def) componentDefinitions[comp] = def;
      }

      const enriched: CharacterEtymology = { ...entry };
      if (Object.keys(componentDefinitions).length > 0) {
        enriched.componentDefinitions = componentDefinitions;
      }

      const linkable = linkableComponents(entry);
      if (linkable.length > 0) {
        enriched.linkableComponents = linkable;
      }

      return enriched;
    })
    .filter((entry): entry is CharacterEtymology => entry !== undefined);

  cacheEtymology(word, result);
  return result;
}

/**
 * Just the senses. The longest-match scan tries a candidate per length and
 * start offset and throws away all but one, so the parts that are not needed
 * to judge a candidate — the character breakdown and the corpus rank — are
 * left to {@link enrich}, which the winner alone goes through.
 */
function lookupEntries(word: string): DefinitionResult {
  return {
    word,
    mandarin: { entries: processDictionaryLookup(mandarinDict, word, true) },
    cantonese: { entries: processDictionaryLookup(cantoneseDict, word, false) },
  };
}

/** Add the character breakdown and corpus rank to a definition that was chosen. */
function enrich(result: DefinitionResult): DefinitionResult {
  const etymology = lookupEtymology(result.word);
  if (etymology.length > 0) {
    result.etymology = etymology;
  }

  const frequency = lookupFrequency(result.word, [
    ...result.mandarin.entries,
    ...result.cantonese.entries,
  ]);
  if (frequency) {
    result.frequency = frequency;
  }

  return result;
}

export function lookupWordInDictionaries(word: string): DefinitionResult {
  return enrich(lookupEntries(word));
}

export function isDefinitionValid(entries: DictionaryEntry[]): boolean {
  if (!entries.length) return false;
  return entries.some(e => e.definitions.some(d => d.trim().length > 0));
}

export function hasValidDefinition(definition: DefinitionResult): boolean {
  return isDefinitionValid(definition.mandarin.entries) || isDefinitionValid(definition.cantonese.entries);
}

/**
 * The longest dictionary word starting at the beginning of `word`. This is the
 * offset-aware scan anchored at the first character: candidates covering
 * offset 0 can only start there, so the two searches are the same one.
 */
export function findLongestMatchingWord(word: string): { definition: DefinitionResult; matchedWord: string } | null {
  return findWordCoveringOffset(word, 0);
}

export function lookupWord(word: string): DefinitionResult {
  const matchResult = findLongestMatchingWord(word);
  if (matchResult) {
    return matchResult.definition;
  }

  console.error('[Dict] Word not found:', word);
  throw new Error(`Word "${word}" not found in dictionary`);
}

/**
 * The longest dictionary word that *covers* the hovered character, rather than
 * one that merely starts there — hovering the middle of 中國人 should find
 * 中國人, not 國人. Candidates of equal length are tried nearest the cursor
 * first, so the hovered character stays the anchor.
 */
export function findWordCoveringOffset(
  run: string,
  offset: number,
): { definition: DefinitionResult; matchedWord: string } | null {
  const characters = [...run];
  if (offset < 0 || offset >= characters.length) return null;

  for (let length = Math.min(MAX_WORD_LENGTH, characters.length); length >= 1; length--) {
    const earliest = Math.max(0, offset - length + 1);
    const latest = Math.min(offset, characters.length - length);

    for (let start = latest; start >= earliest; start--) {
      const candidate = characters.slice(start, start + length).join('');
      const definition = lookupEntries(candidate);
      if (hasValidDefinition(definition)) {
        return { definition: enrich(definition), matchedWord: candidate };
      }
    }
  }

  return null;
}

/** Look up the hovered character's word, falling back to a plain lookup. */
export function lookupWordAt(run: string, offset: number): DefinitionResult {
  const match = findWordCoveringOffset(run, offset);
  if (match) return match.definition;

  console.error('[Dict] Word not found at offset:', offset, 'in', run);
  throw new Error(`No word found at offset ${offset} of "${run}"`);
}
