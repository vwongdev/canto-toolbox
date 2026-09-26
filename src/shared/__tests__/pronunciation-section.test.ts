// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { createPronunciationSection } from '../pronunciation-section.js';
import type { DictionaryEntry } from '../types.js';

const makeEntry = (romanisation: string, definitions: string[]): DictionaryEntry => ({
  traditional: '字',
  simplified: '字',
  romanisation,
  definitions,
});

describe('createPronunciationSection', () => {
  it('renders the section label', () => {
    const el = createPronunciationSection({ entries: [makeEntry('hao3', ['good'])] }, 'Mandarin', 'pinyin');
    expect(el.querySelector('.definition-label')?.textContent).toBe('Mandarin');
  });

  it('groups entries sharing the same romanisation into one group element', () => {
    const el = createPronunciationSection({
      entries: [makeEntry('hao3', ['good']), makeEntry('hao3', ['well'])],
    }, 'Mandarin', 'pinyin');
    expect(el.querySelectorAll('.pronunciation-group').length).toBe(1);
  });

  it('creates separate groups for different romanisations', () => {
    const el = createPronunciationSection({
      entries: [makeEntry('hao3', ['good']), makeEntry('hao4', ['to like'])],
    }, 'Mandarin', 'pinyin');
    expect(el.querySelectorAll('.pronunciation-group').length).toBe(2);
  });

  it('uses the pinyin pronunciation class for pinyin key', () => {
    const el = createPronunciationSection({ entries: [makeEntry('hao3', ['good'])] }, 'Mandarin', 'pinyin');
    expect(el.querySelector('.definition-pinyin')).not.toBeNull();
  });

  it('uses the jyutping pronunciation class for jyutping key', () => {
    const el = createPronunciationSection({ entries: [makeEntry('hou2', ['good'])] }, 'Cantonese', 'jyutping');
    expect(el.querySelector('.definition-jyutping')).not.toBeNull();
  });

  it('merges definitions from the same romanisation group into one list', () => {
    const el = createPronunciationSection({
      entries: [makeEntry('hao3', ['good', 'well']), makeEntry('hao3', ['fine'])],
    }, 'Mandarin', 'pinyin');
    expect(Array.from(el.querySelectorAll('.definition-item')).map(n => n.textContent))
      .toEqual(['good', 'well', 'fine']);
  });

  it('filters out blank definitions when grouping', () => {
    const el = createPronunciationSection({
      entries: [makeEntry('hao3', ['good', '', '  '])],
    }, 'Mandarin', 'pinyin');
    expect(Array.from(el.querySelectorAll('.definition-item')).map(n => n.textContent))
      .toEqual(['good']);
  });

  it('renders no groups when entries are empty', () => {
    const el = createPronunciationSection({ entries: [] }, 'Mandarin', 'pinyin');
    expect(el.querySelectorAll('.pronunciation-group').length).toBe(0);
  });

  it('omits the definition list when a reading has no senses', () => {
    const el = createPronunciationSection({
      entries: [makeEntry('hao3', ['', '  '])],
    }, 'Mandarin', 'pinyin');
    expect(el.querySelector('.definition-text')).toBeNull();
  });

  it('renders the placeholder for an empty reading when asked', () => {
    const el = createPronunciationSection({
      entries: [makeEntry('hao3', [])],
    }, 'Mandarin', 'pinyin', { showPlaceholderWhenEmpty: true });
    expect(el.querySelector('.definition-text')?.textContent).toBe('Not found');
  });
});

describe('createPronunciationSection with romanisation hidden', () => {
  const hidden = () => createPronunciationSection(
    { entries: [makeEntry('hao3', ['good']), makeEntry('hao4', ['to like'])] },
    'Mandarin',
    'pinyin',
    { hideRomanisation: true },
  );

  it('puts a reveal control in place of each reading', () => {
    const el = hidden();
    expect(el.querySelector('.definition-pinyin')).toBeNull();
    expect(Array.from(el.querySelectorAll('.romanisation-reveal'), n => n.textContent))
      .toEqual(['Show Pinyin', 'Show Pinyin']);
  });

  it('still shows the senses', () => {
    expect(hidden().querySelectorAll('.definition-item')).toHaveLength(2);
  });

  it('reveals only the reading that was pressed, without the press reaching the row', () => {
    const el = hidden();
    const row = document.createElement('div');
    const rowClick = vi.fn();
    row.addEventListener('click', rowClick);
    row.appendChild(el);

    (el.querySelector('.romanisation-reveal') as HTMLButtonElement).click();

    expect(el.querySelector('.definition-pinyin')?.textContent).toBe('hǎo');
    expect(el.querySelectorAll('.romanisation-reveal')).toHaveLength(1);
    expect(rowClick).not.toHaveBeenCalled();
  });

  it('leaves an entry with no reading as it is', () => {
    const el = createPronunciationSection(
      { entries: [makeEntry('', ['dialect word'])] },
      'Cantonese',
      'jyutping',
      { hideRomanisation: true },
    );
    expect(el.querySelector('.romanisation-reveal')).toBeNull();
  });
});
