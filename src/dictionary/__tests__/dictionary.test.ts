import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  initDictionaries,
  isDefinitionValid,
  hasValidDefinition,
  lookupWordInDictionaries,
  findLongestMatchingWord,
  findWordCoveringOffset,
  lookupWord,
  lookupWordAt,
  lookupEtymology,
} from '../dictionary.js';
import type { CompactDictionary, DictionaryEntry, DefinitionResult } from '../../shared/types.js';

const mockMandarin: CompactDictionary = {
  rows: [
    ['好', '好', 'hao3', ['good', 'well']],
    ['好', '好', 'hao4', ['to be fond of']],
    ['字', '字', 'zi4', ['letter', 'symbol', 'character']],
    ['好字', '好字', 'hao3 zi4', ['good handwriting']],
    ['廣東話', '广东话', 'Guang3dong1 hua4', ['Cantonese (dialect)', '(Cantonese) Cantonese']],
    ['女', '女', 'nu:3', ['female', 'woman', 'daughter']],
    ['子', '子', 'zi3', ['son', 'child', 'seed', 'egg']],
  ],
  index: {
    '好': [0, 1],
    '字': 2,
    '好字': 3,
    '廣東話': 4,
    '广东话': 4,
    '女': 5,
    '子': 6,
  },
};

const mockCantonese: CompactDictionary = {
  rows: [
    ['好', '好', 'hou2', ['good', 'well']],
    ['字', '字', 'zi6', ['character', 'letter']],
  ],
  index: {
    '好': 0,
    '字': 1,
  },
};

const mockEtymology = {
  '好': { character: '好', decomposition: '⿰女子', radical: '女', etymologyType: 'ideographic', hint: 'woman with child' },
  '字': { character: '字', decomposition: '⿱宀子', radical: '宀', etymologyType: 'pictophonetic', semantic: '宀', phonetic: '子' },
  '女': { character: '女', decomposition: '女', radical: '女', etymologyType: 'pictographic', hint: 'a woman with folded hands' },
};

// Ranks from the real SUBTLEX-CH build; 廣東話 is genuinely outside the cap.
const mockFrequency = {
  '好': 10,
  '字': 1207,
  '广东话': 18450,
};

vi.stubGlobal('fetch', vi.fn((url: string) => {
  let data: unknown;
  if (url.includes('mandarin')) data = mockMandarin;
  else if (url.includes('cantonese')) data = mockCantonese;
  else if (url.includes('etymology')) data = mockEtymology;
  else if (url.includes('frequency')) data = mockFrequency;
  return Promise.resolve({ json: () => Promise.resolve(data) });
}));

beforeAll(async () => {
  await initDictionaries();
});

const makeEntry = (romanisation: string, definitions: string[]): DictionaryEntry => ({
  traditional: '字',
  simplified: '字',
  romanisation,
  definitions,
});

describe('isDefinitionValid', () => {
  it('returns false for an empty entry list', () => {
    expect(isDefinitionValid([])).toBe(false);
  });

  it('returns false when all definitions are empty strings', () => {
    expect(isDefinitionValid([makeEntry('pin1', ['', '   '])])).toBe(false);
  });

  it('returns true when at least one definition is non-empty', () => {
    expect(isDefinitionValid([makeEntry('pin1', ['to spell'])])).toBe(true);
  });

  it('returns true when one entry has a valid definition among multiple empty ones', () => {
    expect(isDefinitionValid([makeEntry('pin1', ['']), makeEntry('pin3', ['spelling'])])).toBe(true);
  });
});

describe('hasValidDefinition', () => {
  const empty: DefinitionResult = {
    word: 'test',
    mandarin: { entries: [] },
    cantonese: { entries: [] },
  };

  it('returns false when both mandarin and cantonese are empty', () => {
    expect(hasValidDefinition(empty)).toBe(false);
  });

  it('returns true when mandarin has valid entries', () => {
    const result: DefinitionResult = {
      ...empty,
      mandarin: { entries: [makeEntry('pin1', ['to spell'])] },
    };
    expect(hasValidDefinition(result)).toBe(true);
  });

  it('returns true when cantonese has valid entries', () => {
    const result: DefinitionResult = {
      ...empty,
      cantonese: { entries: [makeEntry('ping3', ['to spell'])] },
    };
    expect(hasValidDefinition(result)).toBe(true);
  });
});

describe('lookupWordInDictionaries', () => {
  it('returns mandarin and cantonese entries for a known word', () => {
    const result = lookupWordInDictionaries('好');
    expect(result.word).toBe('好');
    expect(result.mandarin.entries.length).toBeGreaterThan(0);
    expect(result.cantonese.entries.length).toBeGreaterThan(0);
  });

  it('returns multiple mandarin entries for words with multiple readings', () => {
    const result = lookupWordInDictionaries('好');
    expect(result.mandarin.entries.length).toBe(2);
    expect(result.mandarin.entries[0]!.romanisation).toBe('hao3');
    expect(result.mandarin.entries[1]!.romanisation).toBe('hao4');
  });

  it('filters out Cantonese-marked definitions from mandarin entries', () => {
    const result = lookupWordInDictionaries('廣東話');
    const defs = result.mandarin.entries.flatMap(e => e.definitions);
    expect(defs.every(d => !d.toLowerCase().includes('(cantonese)'))).toBe(true);
  });

  it('does not filter cantonese entries', () => {
    const result = lookupWordInDictionaries('字');
    expect(result.cantonese.entries.length).toBeGreaterThan(0);
  });

  it('returns empty entries for an unknown word', () => {
    const result = lookupWordInDictionaries('囧');
    expect(result.mandarin.entries).toEqual([]);
    expect(result.cantonese.entries).toEqual([]);
  });

  it('attaches etymology when characters are in the etymology dictionary', () => {
    const result = lookupWordInDictionaries('好');
    expect(result.etymology).toBeDefined();
    expect(result.etymology![0]!.character).toBe('好');
  });

  it('omits etymology when no characters are found', () => {
    const result = lookupWordInDictionaries('囧');
    expect(result.etymology).toBeUndefined();
  });
});

describe('lookupEtymology', () => {
  it('returns etymology for known characters', () => {
    const result = lookupEtymology('好字');
    expect(result.length).toBe(2);
    expect(result[0]!.character).toBe('好');
    expect(result[1]!.character).toBe('字');
  });

  it('skips unknown characters', () => {
    const result = lookupEtymology('好囧');
    expect(result.length).toBe(1);
    expect(result[0]!.character).toBe('好');
  });

  it('still answers correctly once the cache has turned over', () => {
    // The keys are whatever gets hovered, so the cache is capped; a word
    // pushed out has to be rebuilt rather than come back wrong or empty.
    for (let i = 0; i < 2100; i++) lookupEtymology(`好${i}`);

    const result = lookupEtymology('好字');
    expect(result.map(entry => entry.character)).toEqual(['好', '字']);
  });

  it('returns empty array when no characters are found', () => {
    expect(lookupEtymology('囧')).toEqual([]);
  });

  it('marks the components the dictionaries hold an entry for', () => {
    expect(lookupEtymology('好')[0]!.linkableComponents).toEqual(['女', '子']);
  });

  it('leaves out a component the dictionaries know nothing about', () => {
    // 宀 is a radical the dictionaries have no entry for; 子 is a word.
    expect(lookupEtymology('字')[0]!.linkableComponents).toEqual(['子']);
  });

  it('does not mark a character as a component of itself', () => {
    expect(lookupEtymology('女')[0]!.linkableComponents).toBeUndefined();
  });
});

describe('findLongestMatchingWord', () => {
  it('returns null when no match exists', () => {
    expect(findLongestMatchingWord('囧')).toBeNull();
  });

  it('returns the longest matching prefix', () => {
    const result = findLongestMatchingWord('好字囧');
    expect(result).not.toBeNull();
    expect(result!.matchedWord).toBe('好字');
  });

  it('falls back to a shorter match when the longest has no definition', () => {
    // '好囧' is not in the dictionary but '好' is
    const result = findLongestMatchingWord('好囧');
    expect(result).not.toBeNull();
    expect(result!.matchedWord).toBe('好');
  });

  it('returns definition alongside matched word', () => {
    const result = findLongestMatchingWord('字');
    expect(result!.definition.word).toBe('字');
    expect(result!.definition.mandarin.entries.length).toBeGreaterThan(0);
  });

  it('matches the same word the offset-aware scan finds at the start', () => {
    const prefix = findLongestMatchingWord('好字囧');
    const covering = findWordCoveringOffset('好字囧', 0);

    expect(prefix!.matchedWord).toBe(covering!.matchedWord);
  });

  it('counts a leading astral character as one character', () => {
    // Outside the BMP, so a UTF-16 scan would split it and match nothing.
    expect(findLongestMatchingWord('𠮷好字')).toBeNull();
  });
});

describe('lookupWord', () => {
  it('returns a definition for a known word', () => {
    const result = lookupWord('好');
    expect(result.word).toBe('好');
    expect(result.mandarin.entries.length).toBeGreaterThan(0);
  });

  it('sets word to the matched prefix, not the full input', () => {
    const result = lookupWord('好囧');
    expect(result.word).toBe('好');
  });

  it('throws when the word is not found', () => {
    expect(() => lookupWord('囧')).toThrow('囧');
  });
});

describe('lookupFrequency', () => {
  it('bands a very common word as core vocabulary', () => {
    expect(lookupWord('好').frequency).toEqual({ rank: 10, band: 'core' });
  });

  it('bands a mid-frequency word by its rank', () => {
    expect(lookupWord('字').frequency).toEqual({ rank: 1207, band: 'common' });
  });

  it('finds a traditional word through its simplified counterpart', () => {
    // 廣東話 is not in the corpus under its traditional form; 广东话 is.
    expect(lookupWord('廣東話').frequency).toEqual({ rank: 18450, band: 'uncommon' });
  });

  it('finds the same entry under the simplified form', () => {
    expect(lookupWord('广东话').word).toBe('广东话');
    expect(lookupWord('广东话').mandarin.entries[0]!.traditional).toBe('廣東話');
  });

  it('omits frequency for a word rarer than the corpus cap', () => {
    expect(lookupWord('好字').frequency).toBeUndefined();
  });
});

describe('findWordCoveringOffset', () => {
  it('extends backwards past the cursor to the longest word', () => {
    // Hovering 字 alone would match 字; the compound covering it wins.
    expect(findWordCoveringOffset('好字', 1)!.matchedWord).toBe('好字');
  });

  it('still matches when the cursor is on the first character', () => {
    expect(findWordCoveringOffset('好字', 0)!.matchedWord).toBe('好字');
  });

  it('finds a compound embedded in a longer run', () => {
    expect(findWordCoveringOffset('囧好字囧', 2)!.matchedWord).toBe('好字');
  });

  it('falls back to the single character when no compound covers it', () => {
    expect(findWordCoveringOffset('字囧', 0)!.matchedWord).toBe('字');
  });

  it('returns null when nothing in range is a word', () => {
    expect(findWordCoveringOffset('囧', 0)).toBeNull();
  });

  it('rejects an offset outside the run', () => {
    expect(findWordCoveringOffset('好字', 5)).toBeNull();
    expect(findWordCoveringOffset('好字', -1)).toBeNull();
  });

  it('reports the matched word on the definition', () => {
    expect(findWordCoveringOffset('好字', 1)!.definition.word).toBe('好字');
  });

  // Enrichment is skipped for the candidates the scan rejects, so the one it
  // settles on has to be enriched on the way out.
  it('carries the character breakdown on the candidate it settles on', () => {
    expect(findWordCoveringOffset('囧好字囧', 2)!.definition.etymology).toBeDefined();
  });

  it('carries the corpus rank on the candidate it settles on', () => {
    expect(findWordCoveringOffset('囧好囧', 1)!.definition.frequency).toEqual({
      rank: 10,
      band: 'core',
    });
  });
});

describe('lookupWordAt', () => {
  it('returns the word covering the hovered character', () => {
    expect(lookupWordAt('好字', 1).word).toBe('好字');
  });

  it('throws when no word covers the offset', () => {
    expect(() => lookupWordAt('囧', 0)).toThrow();
  });
});
