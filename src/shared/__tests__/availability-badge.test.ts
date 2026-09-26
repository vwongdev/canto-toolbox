// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { createAvailabilityBadge, languageAvailability } from '../availability-badge.js';
import { createDefinitionSections } from '../definition-section.js';
import type { DefinitionResult, DictionaryEntry } from '../types.js';

const define = (
  word: string,
  mandarin: DictionaryEntry[],
  cantonese: DictionaryEntry[],
): DefinitionResult => ({ word, mandarin: { entries: mandarin }, cantonese: { entries: cantonese } });

// 唔該 is in CC-Canto alone.
const MGOI = define('唔該', [], [
  { traditional: '唔該', simplified: '唔该', romanisation: 'm4 goi1', definitions: ['(verb) please; thanks (for services rendered rather than gifts); excuse me'] },
]);

// 取決於 is in CC-CEDICT alone.
const DEPEND = define('取決於', [
  { traditional: '取決於', simplified: '取决于', romanisation: 'qu3 jue2 yu2', definitions: ['to hinge on', 'to be decided by', 'to depend on'] },
], []);

const BOTH = define('靚仔', [
  { traditional: '靚仔', simplified: '靓仔', romanisation: 'liang4 zai3', definitions: ['handsome young man'] },
], [
  { traditional: '靚仔', simplified: '靓仔', romanisation: 'leng3 zai2', definitions: ['(noun) junior'] },
]);

describe('languageAvailability', () => {
  it('names the one dictionary a word turned up in', () => {
    expect(languageAvailability(MGOI)).toBe('cantonese');
    expect(languageAvailability(DEPEND)).toBe('mandarin');
  });

  it('says nothing of a word both dictionaries hold', () => {
    expect(languageAvailability(BOTH)).toBeNull();
  });

  it('does not call a word in the Mandarin subtitle corpus Cantonese only', () => {
    // CC-CEDICT has no entry for 很多, but SUBTLEX-CH ranks it 254th.
    const many = {
      ...define('很多', [], [
        { traditional: '很多', simplified: '很多', romanisation: 'han2 do1', definitions: ['noun; a lot of'] },
      ]),
      frequency: { rank: 254, band: 'core' as const },
    };

    expect(languageAvailability(many)).toBeNull();
  });

  it('does not call a bare Cantonese reading a Cantonese word', () => {
    // CC-Canto lists 來說 with a reading and no senses.
    const reading = define('來說', [], [
      { traditional: '來說', simplified: '来说', romanisation: 'loi4 syut3', definitions: [] },
    ]);

    expect(languageAvailability(reading)).toBeNull();
  });
});

describe('createAvailabilityBadge', () => {
  it('labels a single-dictionary word', () => {
    expect(createAvailabilityBadge(MGOI)?.textContent).toBe('Cantonese only');
    expect(createAvailabilityBadge(DEPEND)?.textContent).toBe('Mandarin only');
  });

  it('renders nothing for a word in both', () => {
    expect(createAvailabilityBadge(BOTH)).toBeNull();
  });

  it('sits beside the frequency badge on every definition surface', () => {
    const badges = createDefinitionSections(MGOI).querySelector('.definition-badges')!;

    expect(Array.from(badges.children).map(child => child.classList[0]))
      .toEqual(['frequency-badge', 'availability-badge']);
  });
});
