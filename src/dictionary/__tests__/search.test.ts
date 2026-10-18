import { describe, it, expect } from 'vitest';
import { createSearcher } from '../search.js';
import type { CompactDictionary } from '../../shared/types.js';

const mandarin: CompactDictionary = {
  rows: [
    ['吃', '吃', 'chi1', ['to eat; to consume', 'to eat at (a cafeteria etc)', 'to eradicate; to destroy', 'to absorb', 'to suffer (shock, injury, defeat etc)']],
    ['用', '用', 'yong4', ['to use; to make use of; to employ', '(coverb) with; using', 'to need; to have to (usu. used in the negative or in questions)', 'usefulness; utility', '(bound form) expense; outlay', '(courteous) to eat; to drink', '(literary) hence; therefore']],
    ['吃飯', '吃饭', 'chi1 fan4', ['to have a meal', 'to eat', 'to make a living']],
    ['你好', '你好', 'ni3 hao3', ['hello; hi']],
    ['學習', '学习', 'xue2 xi2', ['to learn', 'to study']],
    ['血洗', '血洗', 'xue4 xi3', ['to carry out a bloodbath in (a place)', '(fig.) to wreak havoc on']],
    ['2019冠狀病毒病', '2019冠状病毒病', 'er4 ling2 yi1 jiu3 guan1 zhuang4 bing4 du2 bing4', ['COVID-19, the coronavirus disease identified in 2019']],
  ],
  index: {
    '吃': 0,
    '用': 1,
    '吃飯': 2,
    '吃饭': 2,
    '你好': 3,
    '學習': 4,
    '学习': 4,
    '血洗': 5,
    '2019冠狀病毒病': 6,
    '2019冠状病毒病': 6,
  },
};

const cantonese: CompactDictionary = {
  rows: [
    ['吃', '吃', 'hek3', ['to eat', 'to consume', 'to eat at (a cafeteria etc)', 'to eradicate', 'to destroy', 'to absorb', 'to suffer']],
    ['你好', '你好', 'nei5 hou2', []],
    ['學習', '学习', 'hok6 zaap6', ['study; learnings']],
  ],
  index: {
    '吃': 0,
    '你好': 1,
    '學習': 2,
    '学习': 2,
  },
};

// Real SUBTLEX-CH ranks; 血洗 is outside the cap.
const ranks: Record<string, number> = { 吃: 153, 用: 81, 吃饭: 1336, 你好: 2021, 学习: 1218 };

const search = createSearcher(mandarin, cantonese, (traditional, simplified) => ranks[simplified] ?? ranks[traditional], 4);
const LIMITS = { seen: 50, others: 50 };

function words(query: string, seen: string[] = []): string[] {
  return search(query, new Set(seen), LIMITS).map(hit => hit.word);
}

describe('createSearcher', () => {
  describe('by headword', () => {
    it('puts the word itself before words that start with it', () => {
      expect(words('吃')).toEqual(['吃', '吃飯']);
    });

    it('answers in the script the query was written in', () => {
      expect(search('学', new Set(), LIMITS)).toEqual([
        { word: '学习', traditional: '學習', simplified: '学习', rank: 1218 },
      ]);
    });

    it('leaves out words too long to be hovered', () => {
      expect(words('病')).toEqual([]);
    });
  });

  describe('by English', () => {
    it('puts a word that chiefly means the query before a commoner one that can', () => {
      expect(words('eat')).toEqual(['吃', '用', '吃飯']);
    });

    it('reads past a leading "to"', () => {
      expect(words('to eat')).toEqual(words('eat'));
    });

    it('matches whole words only', () => {
      expect(words('hell')).toEqual([]);
    });
  });

  describe('by romanisation', () => {
    it('matches pinyin with or without tones and spaces', () => {
      expect(words('nihao')).toEqual(['你好']);
      expect(words('ni3 hao3')).toEqual(['你好']);
      expect(words('ni4hao3')).toEqual([]);
    });

    it('finds a word by a Jyutping reading that carries no English of its own', () => {
      expect(words('nei5 hou2')).toEqual(['你好']);
    });

    it('ranks a common word above a rare one sharing its toneless pinyin', () => {
      expect(words('xuexi')).toEqual(['學習', '血洗']);
    });
  });

  it('puts words the reader has met first, in either script', () => {
    expect(words('eat', ['吃飯'])).toEqual(['吃飯', '吃', '用']);
    expect(words('xuexi', ['血洗'])[0]).toBe('血洗');
  });

  it('caps each group separately', () => {
    const hits = search('eat', new Set(['吃飯']), { seen: 1, others: 1 }).map(hit => hit.word);
    expect(hits).toEqual(['吃飯', '吃']);
  });
});
