import { describe, it, expect, vi } from 'vitest';
import {
  cardFromDefinition,
  collectCards,
  escapeAnkiField,
  markPinyin,
  toAnki,
  toPleco,
  wordsToExport,
  type ExportCard,
} from '../card-export.js';
import { MIN_COUNT } from '../../shared/statistics-utils.js';
import type { DefinitionResult, DictionaryEntry, Statistics } from '../../shared/types.js';

const entry = (
  traditional: string,
  simplified: string,
  romanisation: string,
  definitions: string[],
): DictionaryEntry => ({ traditional, simplified, romanisation, definitions });

function definition(
  word: string,
  mandarin: DictionaryEntry[],
  cantonese: DictionaryEntry[] = [],
): DefinitionResult {
  return { word, mandarin: { entries: mandarin }, cantonese: { entries: cantonese } };
}

const 好 = definition(
  '好',
  [entry('好', '好', 'hao3', ['good', 'well']), entry('好', '好', 'hao4', ['to be fond of'])],
  [entry('好', '好', 'hou2', ['good', 'well'])],
);

const 广东话 = definition('广东话', [entry('廣東話', '广东话', 'Guang3 dong1 hua4', ['Cantonese language'])]);

describe('wordsToExport', () => {
  const statistics: Statistics = {
    好: { count: MIN_COUNT, firstSeen: 2, lastSeen: 9 },
    女: { count: 1, firstSeen: 1, lastSeen: 9, pinned: true },
    字: { count: 1, firstSeen: 3, lastSeen: 9 },
    子: { count: MIN_COUNT, firstSeen: 4, lastSeen: 9, suppressed: true },
  };

  it('takes the enrolled deck without retired words by default', () => {
    expect(wordsToExport(statistics, 'deck')).toEqual(['女', '好']);
  });

  it('counts the deck against the reader\'s threshold', () => {
    expect(wordsToExport(statistics, 'deck', 1)).toEqual(['女', '好', '字']);
  });

  it('takes every tracked word when asked for all', () => {
    expect(wordsToExport(statistics, 'all')).toEqual(['女', '好', '字', '子']);
  });

  // A word with a schedule stays in the deck whatever its count, as it does
  // when a session is built.
  it('keeps a word already being reviewed', () => {
    const reviewed: Statistics = {
      東: {
        count: 1,
        firstSeen: 1,
        lastSeen: 1,
        flashcard: { reviews: 1, consecutiveCorrect: 1, lastReviewed: 1 },
      },
    };
    expect(wordsToExport(reviewed, 'deck')).toEqual(['東']);
  });
});

describe('cardFromDefinition', () => {
  it('gathers every reading from both dictionaries', () => {
    const card = cardFromDefinition('好', 好, '你好嗎');

    expect(card).toEqual({
      traditional: '好',
      simplified: '好',
      pinyin: ['hao3', 'hao4'],
      jyutping: ['hou2'],
      definitions: ['good', 'well', 'to be fond of'],
      context: '你好嗎',
    });
  });

  it('keeps both scripts of the headword', () => {
    const card = cardFromDefinition('广东话', 广东话);
    expect([card.traditional, card.simplified]).toEqual(['廣東話', '广东话']);
  });

  // 发 is both 發 and 髮; a card can only be one word.
  it('keeps to the word the first entry spells', () => {
    const card = cardFromDefinition('发', definition('发', [
      entry('發', '发', 'fa1', ['to send out']),
      entry('髮', '发', 'fa4', ['hair']),
    ]));

    expect(card.traditional).toBe('發');
    expect(card.pinyin).toEqual(['fa1']);
    expect(card.definitions).toEqual(['to send out']);
  });

  it('still makes a card for a word the dictionary cannot find', () => {
    expect(cardFromDefinition('好', undefined, '好嘢')).toEqual({
      traditional: '好',
      simplified: '好',
      pinyin: [],
      jyutping: [],
      definitions: [],
      context: '好嘢',
    });
  });
});

describe('markPinyin', () => {
  it('turns tone numbers into marks, including ü', () => {
    expect(markPinyin('Guang3 dong1 hua4')).toBe('Guǎng dōng huà');
    expect(markPinyin('nu:3')).toBe('nǚ');
  });
});

describe('escapeAnkiField', () => {
  it('leaves a plain field alone', () => {
    expect(escapeAnkiField('good; well')).toBe('good; well');
  });

  it('quotes a field holding a tab, a newline or a quote, doubling the quote', () => {
    expect(escapeAnkiField('a\tb')).toBe('"a\tb"');
    expect(escapeAnkiField('a\nb')).toBe('"a\nb"');
    expect(escapeAnkiField('he said "hi"')).toBe('"he said ""hi"""');
  });

  it('quotes a field that could be read as a header line', () => {
    expect(escapeAnkiField('#columns')).toBe('"#columns"');
  });
});

const CARDS: ExportCard[] = [
  cardFromDefinition('广东话', 广东话, '佢講"廣東話"'),
  cardFromDefinition('好', 好),
];

describe('toAnki', () => {
  it('writes the header Anki reads the separator and columns from', () => {
    const lines = toAnki(CARDS).split('\n');
    expect(lines.slice(0, 3)).toEqual([
      '#separator:tab',
      '#html:false',
      '#columns:Traditional\tSimplified\tJyutping\tPinyin\tDefinition\tContext',
    ]);
  });

  it('writes one row per card in column order', () => {
    const rows = toAnki(CARDS, { header: false }).split('\n').slice(0, -1);

    expect(rows).toEqual([
      '廣東話\t广东话\t\tGuǎng dōng huà\tCantonese language\t"佢講""廣東話"""',
      '好\t好\thou2\thǎo / hào\tgood; well; to be fond of\t',
    ]);
  });
});

describe('toPleco', () => {
  it('writes simplified with traditional in brackets, and one headword when they agree', () => {
    const lines = toPleco(CARDS).trimEnd().split('\n');

    expect(lines).toEqual([
      '广东话[廣東話]\tGuang3 dong1 hua4\tCantonese language',
      '好\thao3\tgood; well; to be fond of',
    ]);
  });

  it('spells out ü, which CC-CEDICT writes as u:', () => {
    const card = cardFromDefinition('女', definition('女', [entry('女', '女', 'nu:3', ['female'])]));
    expect(toPleco([card])).toBe('女\tnü3\tfemale\n');
  });

  // Pleco has no quoting, so a tab or newline would split the card.
  it('folds tabs and newlines out of a field', () => {
    const card: ExportCard = { ...CARDS[1]!, definitions: ['good\tfine', 'well\nokay'] };
    expect(toPleco([card])).toBe('好\thao3\tgood fine; well okay\n');
  });
});

describe('collectCards', () => {
  it('keeps the words in order and reports progress', async () => {
    const lookup = vi.fn(async (word: string) => (word === '好' ? 好 : 广东话));
    const progress = vi.fn();
    const statistics: Statistics = { 好: { count: 1, firstSeen: 1, lastSeen: 1, context: '好嘢' } };

    const cards = await collectCards(['广东话', '好'], statistics, lookup, progress, 1);

    expect(cards.map(card => card.simplified)).toEqual(['广东话', '好']);
    expect(cards[1]!.context).toBe('好嘢');
    expect(progress).toHaveBeenLastCalledWith(2, 2);
  });

  it('exports the first sentence a word was met in', async () => {
    const statistics: Statistics = {
      好: {
        count: 2, firstSeen: 1, lastSeen: 5,
        contexts: [{ text: '好嘢', seen: 1 }, { text: '你好嗎', seen: 5 }],
      },
    };

    const [card] = await collectCards(['好'], statistics, async () => 好);

    expect(card!.context).toBe('好嘢');
  });

  it('carries on past a failed lookup', async () => {
    const lookup = vi.fn(async (word: string) => {
      if (word === '好') throw new Error('offscreen document gone');
      return 广东话;
    });

    const cards = await collectCards(['好', '广东话'], {}, lookup);

    expect(cards[0]!.definitions).toEqual([]);
    expect(cards[1]!.traditional).toBe('廣東話');
  });
});
