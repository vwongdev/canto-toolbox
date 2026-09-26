import { describe, it, expect, vi, beforeAll } from 'vitest';
import { initDictionaries, segmentRun } from '../dictionary.js';
import type { CompactDictionary } from '../../shared/types.js';

// CC-CEDICT and CC-Canto lines, trimmed to the senses the tests need.
const mockMandarin: CompactDictionary = {
  rows: [
    ['我', '我', 'wo3', ['I', 'me', 'my']],
    ['學習', '学习', 'xue2 xi2', ['to learn', 'to study']],
    ['學', '学', 'xue2', ['to learn', 'to study', 'science', '-ology']],
    ['習', '习', 'xi2', ['to practice', 'to study', 'habit']],
    ['中文', '中文', 'Zhong1 wen2', ['Chinese language']],
    ['中', '中', 'zhong1', ['within', 'among', 'in', 'middle', 'center']],
    ['文', '文', 'wen2', ['language', 'culture', 'writing']],
    ['孔子', '孔子', 'Kong3 zi3', ['Confucius (551-479 BC), Chinese thinker and social philosopher']],
  ],
  index: {
    '我': 0,
    '學習': 1,
    '学习': 1,
    '學': 2,
    '学': 2,
    '習': 3,
    '习': 3,
    '中文': 4,
    '中': 5,
    '文': 6,
    '孔子': 7,
  },
};

const mockCantonese: CompactDictionary = {
  rows: [['我', '我', 'ngo5', ['I', 'me', 'myself']]],
  index: { '我': 0 },
};

// Real SUBTLEX-CH ranks. 孔子 ranks 35,885th, past the 20,000 the build keeps.
const mockFrequency = {
  '我': 2,
  '学习': 1218,
  '中文': 9443,
};

vi.stubGlobal('fetch', vi.fn((url: string) => {
  let data: unknown;
  if (url.includes('mandarin')) data = mockMandarin;
  else if (url.includes('cantonese')) data = mockCantonese;
  else if (url.includes('etymology')) data = {};
  else if (url.includes('frequency')) data = mockFrequency;
  return Promise.resolve({ json: () => Promise.resolve(data) });
}));

beforeAll(async () => {
  await initDictionaries();
});

describe('segmentRun', () => {
  it('takes the longest word from each point along the run', () => {
    expect(segmentRun('我學習中文').map(({ start, end }) => [start, end])).toEqual([
      [0, 1],
      [1, 3],
      [3, 5],
    ]);
  });

  it('names the other script form so a word is known in either', () => {
    const [, study] = segmentRun('我學習');
    expect(study!.variants).toEqual(['学习']);
  });

  it('steps over characters no entry starts with', () => {
    expect(segmentRun('很我').map(({ start, end }) => [start, end])).toEqual([[1, 2]]);
  });

  it('counts offsets in UTF-16 units past a character outside the BMP', () => {
    const [word] = segmentRun('𠮷我');
    expect(word).toMatchObject({ start: 2, end: 3 });
  });

  it('marks a capitalised proper noun the corpus does not rank as a name', () => {
    expect(segmentRun('孔子')[0]!.name).toBe(true);
  });

  it('keeps a capitalised word the corpus ranks as vocabulary', () => {
    expect(segmentRun('中文')[0]!.name).toBeUndefined();
  });
});
