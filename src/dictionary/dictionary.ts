import type {
  CompactDictionary,
  CompactDictionaryEntry,
  DictionaryEntry,
  DefinitionResult,
  EtymologyDictionary,
  FrequencyRanks,
  CharacterEtymology,
  Lookalike,
  SegmentedWord,
  WordFrequency,
} from '../shared/types.js';
import { parseComponents } from '../shared/decomposition.js';
import { bandForRank } from '../shared/frequency.js';
import { buildLookalikeIndex, type LookalikeMatch } from './lookalikes.js';

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
 * The components of `entry` that are words in their own right, which a surface
 * showing the breakdown can offer to look up. The character itself is not a
 * part of itself. The chips a breakdown can render come from the decomposition
 * or from the phonosemantic pair, so both are covered.
 */
function componentsWithEntries(entry: CharacterEtymology): string[] {
  const shown = new Set(parseComponents(entry.decomposition));
  if (entry.semantic) shown.add(entry.semantic);
  if (entry.phonetic) shown.add(entry.phonetic);
  shown.delete(entry.character);

  return [...shown].filter(comp => hasValidDefinition(lookupEntries(comp)));
}

/**
 * More than the popup shows, so the worker can put the ones the reader is
 * studying first and still have a few to fill in with.
 */
const MAX_LOOKALIKES = 8;

let lookalikeIndex: ((character: string) => LookalikeMatch[]) | null = null;

/**
 * A character the corpus ranks, through its simplified form when it has one:
 * the corpus is keyed by simplified forms, and a traditional reader's
 * lookalikes should be traditional characters.
 */
function isCommonCharacter(character: string): boolean {
  const { mandarin, cantonese } = lookupEntries(character);
  return lookupFrequency(character, [...mandarin.entries, ...cantonese.entries]) !== undefined;
}

/** Built on first use, since most hovers never reach a single character's breakdown. */
function lookalikeMatches(character: string): LookalikeMatch[] {
  lookalikeIndex ??= buildLookalikeIndex(etymologyDict, isCommonCharacter);
  return lookalikeIndex(character);
}

type Script = 'traditional' | 'simplified' | 'both';

/** Which script a character belongs to, and its forms in the other one. */
function scriptOf(character: string): { script: Script; variants: Set<string> } {
  const variants = new Set<string>();
  let script: Script = 'both';

  for (const entry of lookupEntries(character).mandarin.entries) {
    if (entry.traditional === entry.simplified) continue;
    if (entry.traditional === character) {
      script = 'traditional';
      variants.add(entry.simplified);
    } else if (entry.simplified === character) {
      script = 'simplified';
      variants.add(entry.traditional);
    }
  }

  return { script, variants };
}

/**
 * The index holds both scripts, so it pairs 請 with its own simplified form
 * 请 and lists 讠 characters beside 言 ones. A character's other form is not
 * a lookalike to tell it apart from, and a reader of one script is not helped
 * by the other's characters. A character common to both scripts cannot say
 * which one its reader uses, so it keeps both.
 */
function inReadersScript(character: string, matches: LookalikeMatch[]): LookalikeMatch[] {
  const own = scriptOf(character);

  return matches.filter(match => {
    if (own.variants.has(match.character)) return false;
    if (own.script === 'both') return true;

    const other = scriptOf(match.character).script;
    return other === 'both' || other === own.script;
  });
}

function lookalikesOf(character: string): Lookalike[] {
  const definitionOf = (glyph: string): string | undefined => etymologyDict[glyph]?.definition;

  return inReadersScript(character, lookalikeMatches(character))
    .slice(0, MAX_LOOKALIKES)
    .map(({ character: other, ownPart, otherPart }) => {
      const definition = definitionOf(other);
      const ownPartDefinition = definitionOf(ownPart);
      const otherPartDefinition = definitionOf(otherPart);
      return {
        character: other,
        ownPart,
        otherPart,
        ...(definition && { definition }),
        ...(ownPartDefinition && { ownPartDefinition }),
        ...(otherPartDefinition && { otherPartDefinition }),
      };
    });
}

/**
 * Which of `words` a reader could take for one another: two words are
 * confusable when a character of one is a lookalike of a character of the
 * other. Only words with at least one such partner are returned.
 */
export function findConfusables(words: string[]): Record<string, string[]> {
  const byCharacter = new Map<string, string[]>();
  for (const word of words) {
    for (const character of new Set(word)) {
      const holding = byCharacter.get(character);
      if (holding) holding.push(word);
      else byCharacter.set(character, [word]);
    }
  }

  const lookalikeCharacters = new Map<string, string[]>();
  const lookalikesFor = (character: string): string[] => {
    let found = lookalikeCharacters.get(character);
    if (!found) {
      found = inReadersScript(character, lookalikeMatches(character)).map(match => match.character);
      lookalikeCharacters.set(character, found);
    }
    return found;
  };

  const confusables: Record<string, string[]> = {};
  for (const word of new Set(words)) {
    const partners = new Set<string>();
    for (const character of new Set(word)) {
      for (const lookalike of lookalikesFor(character)) {
        for (const partner of byCharacter.get(lookalike) ?? []) {
          if (partner !== word) partners.add(partner);
        }
      }
    }
    if (partners.size > 0) confusables[word] = [...partners];
  }
  return confusables;
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

      const withEntries = componentsWithEntries(entry);
      const lookalikes = lookalikesOf(char);

      return {
        ...entry,
        ...(Object.keys(componentDefinitions).length > 0 && { componentDefinitions }),
        ...(withEntries.length > 0 && { componentsWithEntries: withEntries }),
        ...(lookalikes.length > 0 && { lookalikes }),
      };
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

/**
 * The characters of a compound that are words in their own right, which a
 * surface showing the headword can offer to look up. A character is not a part
 * of itself, so a single-character word yields none.
 */
function charactersWithEntries(word: string): string[] {
  const characters = [...word];
  if (characters.length < 2) return [];

  return [...new Set(characters)].filter(char => hasValidDefinition(lookupEntries(char)));
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

  const characters = charactersWithEntries(result.word);
  if (characters.length > 0) {
    result.charactersWithEntries = characters;
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

/**
 * Whether either index holds the word at all — the cheap test that lets the
 * page-wide scan skip decoding rows for the many candidates that are not words.
 */
function isIndexed(word: string): boolean {
  return mandarinDict.index[word] !== undefined || cantoneseDict.index[word] !== undefined;
}

/**
 * CC-CEDICT capitalises the pinyin of a proper noun. Only one the corpus does
 * not rank is set aside: 中國 and 中文 are capitalised too, and a reader has to
 * know them, whereas the name of a minor character in a novel is read past.
 */
function isName(word: string, definition: DefinitionResult): boolean {
  const mandarin = definition.mandarin.entries;
  if (mandarin.length === 0 || !mandarin.every(entry => /^[A-Z]/.test(entry.romanisation))) {
    return false;
  }
  return lookupFrequency(word, [...mandarin, ...definition.cantonese.entries]) === undefined;
}

function segmentedWord(word: string, definition: DefinitionResult, start: number): SegmentedWord {
  const variants = new Set<string>();
  for (const entry of [...definition.mandarin.entries, ...definition.cantonese.entries]) {
    if (entry.traditional) variants.add(entry.traditional);
    if (entry.simplified) variants.add(entry.simplified);
  }
  variants.delete(word);

  return {
    start,
    end: start + word.length,
    ...(variants.size > 0 && { variants: [...variants] }),
    ...(isName(word, definition) && { name: true as const }),
  };
}

/**
 * A run split into words, left to right, each the longest the dictionaries
 * hold from where the last one ended — the scan `lookupWordAt` makes from offset 0, repeated
 * along the run. A character no entry starts with is stepped over. Nothing is
 * enriched, and a row is decoded only once the index has the candidate, so a
 * page of text costs far less than a hover per word.
 */
export function segmentRun(run: string): SegmentedWord[] {
  const characters = [...run];
  const words: SegmentedWord[] = [];
  let position = 0;
  let offset = 0;

  while (position < characters.length) {
    let length = Math.min(MAX_WORD_LENGTH, characters.length - position);

    for (; length >= 1; length--) {
      const candidate = characters.slice(position, position + length).join('');
      if (!isIndexed(candidate)) continue;

      const definition = lookupEntries(candidate);
      if (!hasValidDefinition(definition)) continue;

      words.push(segmentedWord(candidate, definition, offset));
      break;
    }

    const step = Math.max(length, 1);
    for (let i = 0; i < step; i++) offset += characters[position + i]!.length;
    position += step;
  }

  return words;
}

/**
 * The word covering the hovered character. At offset 0 that is the longest
 * word the run starts with, since candidates covering the first character can
 * only start there.
 */
export function lookupWordAt(run: string, offset = 0): DefinitionResult {
  const match = findWordCoveringOffset(run, offset);
  if (match) return match.definition;

  console.error('[Dict] Word not found at offset:', offset, 'in', run);
  throw new Error(`No word found at offset ${offset} of "${run}"`);
}
