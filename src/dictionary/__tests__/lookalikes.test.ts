import { describe, it, expect } from 'vitest';
import { buildLookalikeIndex, MAX_FAMILY_SIZE } from '../lookalikes.js';
import type { EtymologyDictionary } from '../../shared/types.js';

function entry(character: string, decomposition: string) {
  return { character, decomposition, radical: '' };
}

// Real makemeahanzi decompositions.
const etymology: EtymologyDictionary = {
  清: entry('清', '⿰氵青'),
  晴: entry('晴', '⿰日青'),
  情: entry('情', '⿰忄青'),
  请: entry('请', '⿰讠青'),
  河: entry('河', '⿰氵可'),
  何: entry('何', '⿰亻可'),
  字: entry('字', '⿱宀子'),
  好: entry('好', '⿰女子'),
  己: entry('己', '⿱？乚'),
  鲭: entry('鲭', '⿰鱼青'),
};

const common = (character: string) => character !== '鲭';

describe('buildLookalikeIndex', () => {
  const lookalikes = buildLookalikeIndex(etymology, common);

  it('finds characters that differ in one part, with the parts that differ', () => {
    expect(lookalikes('清')).toEqual([
      { character: '河', ownPart: '青', otherPart: '可' },
      { character: '晴', ownPart: '氵', otherPart: '日' },
      { character: '情', ownPart: '氵', otherPart: '忄' },
      { character: '请', ownPart: '氵', otherPart: '讠' },
    ]);
  });

  it('leaves out rare characters', () => {
    expect(lookalikes('清').map(match => match.character)).not.toContain('鲭');
  });

  it('still answers for a rare character from the common ones', () => {
    expect(lookalikes('鲭').map(match => match.character)).toEqual(['清', '晴', '情', '请']);
  });

  it('matches only the same layout', () => {
    // 字 and 好 share 子 but one is stacked and the other side by side.
    expect(lookalikes('字')).toEqual([]);
  });

  it('skips a decomposition with an unknown part', () => {
    expect(lookalikes('己')).toEqual([]);
  });

  it('drops a family too large to be more than a shared radical', () => {
    const big: EtymologyDictionary = { 河: entry('河', '⿰氵可') };
    for (let i = 0; i <= MAX_FAMILY_SIZE; i++) {
      const character = String.fromCodePoint(0x4e00 + i);
      big[character] = entry(character, `⿰氵${String.fromCodePoint(0x5000 + i)}`);
    }

    expect(buildLookalikeIndex(big, () => true)('河')).toEqual([]);
  });
});
