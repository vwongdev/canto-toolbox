// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  createDefinitionElement,
  createMandarinSection,
  createCantoneseSection,
  findScriptVariant,
  createDefinitionSections,
  headwordFor,
} from '../definition-section.js';
import { DEFAULT_SETTINGS } from '../settings.js';
import { createDefinitionTextElement, MAX_VISIBLE_DEFINITIONS } from '../definition-list.js';
import type { DefinitionResult } from '../types.js';

const makeDefinition = (overrides: Partial<DefinitionResult> = {}): DefinitionResult => ({
  word: '你好',
  mandarin: { entries: [{ traditional: '你好', simplified: '你好', romanisation: 'ni3 hao3', definitions: ['hello'] }] },
  cantonese: { entries: [{ traditional: '你好', simplified: '你好', romanisation: 'nei5 hou2', definitions: ['hi'] }] },
  ...overrides,
});

const withEtymology = (): DefinitionResult => makeDefinition({
  etymology: [{ character: '字', definition: 'character', decomposition: '⿱宀子', radical: '宀' }],
});

describe('createDefinitionTextElement', () => {
  it('renders one list item per definition', () => {
    const el = createDefinitionTextElement(['a', 'b']);
    expect(el.tagName).toBe('UL');
    expect(el.className).toBe('definition-text');
    expect(Array.from(el.querySelectorAll('.definition-item')).map(n => n.textContent)).toEqual(['a', 'b']);
  });

  it('falls back to "Not found" when empty or undefined', () => {
    expect(createDefinitionTextElement([]).textContent).toBe('Not found');
    expect(createDefinitionTextElement(undefined).textContent).toBe('Not found');
  });

  it('returns a bare list when there are at most MAX_VISIBLE_DEFINITIONS senses', () => {
    const defs = ['a', 'b', 'c'];
    expect(defs.length).toBe(MAX_VISIBLE_DEFINITIONS);
    const el = createDefinitionTextElement(defs);
    expect(el.tagName).toBe('UL');
    expect(el.classList.contains('definition-senses')).toBe(false);
    expect(el.querySelector('.definition-more')).toBeNull();
    expect(el.querySelectorAll('.definition-sense--overflow').length).toBe(0);
  });

  it('wraps longer lists and hides overflow until expanded', () => {
    const el = createDefinitionTextElement(['a', 'b', 'c', 'd', 'e']);
    expect(el.className).toBe('definition-senses is-collapsed');
    expect(el.querySelectorAll('.definition-sense--overflow').length).toBe(2);

    const btn = el.querySelector('.definition-more') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe('2 more');
    expect(btn.getAttribute('aria-expanded')).toBe('false');

    btn.click();
    expect(el.classList.contains('is-collapsed')).toBe(false);
    expect(btn.textContent).toBe('Show less');
    expect(btn.getAttribute('aria-expanded')).toBe('true');

    btn.click();
    expect(el.classList.contains('is-collapsed')).toBe(true);
    expect(btn.textContent).toBe('2 more');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('createMandarin/CantoneseSection', () => {
  it('labels the sections', () => {
    const def = makeDefinition();
    expect(createMandarinSection(def.mandarin).querySelector('.definition-label')?.textContent).toBe('Mandarin');
    expect(createCantoneseSection(def.cantonese).querySelector('.definition-label')?.textContent).toBe('Cantonese');
  });

  it('holds the Mandarin column open with a placeholder but not the Cantonese one', () => {
    const empty = { entries: [] };
    expect(createMandarinSection(empty).querySelector('.definition-text')).toBeNull();
    expect(createCantoneseSection(empty).querySelector('.definition-text')).toBeNull();

    const noSenses = { entries: [{ traditional: '字', simplified: '字', romanisation: 'zi6', definitions: [] }] };
    expect(createMandarinSection(noSenses).querySelector('.definition-text')?.textContent).toBe('Not found');
    expect(createCantoneseSection(noSenses).querySelector('.definition-text')).toBeNull();
  });
});

describe('createDefinitionElement', () => {
  it('builds the definition-container structure', () => {
    const el = createDefinitionElement('你好', makeDefinition());
    expect(el.className).toBe('definition-container');
    expect(el.querySelector('.definition-word')?.textContent).toBe('你好');
    expect(el.querySelectorAll('.definition-sections .definition-section')).toHaveLength(2);
    expect(el.querySelector('.character-etymology')).toBeNull();
  });

  it('prefers definition.word over the fallback word argument', () => {
    const el = createDefinitionElement('fallback', makeDefinition({ word: '漢字' }));
    expect(el.querySelector('.definition-word')?.textContent).toBe('漢字');
  });

  it('includes an etymology section only when etymology data is present', () => {
    const noEty = createDefinitionElement('字', makeDefinition());
    expect(noEty.children.length).toBe(2); // word + definition-sections

    const withEty = createDefinitionElement('字', withEtymology());
    // word + definition-sections + etymology
    expect(withEty.children.length).toBe(3);
  });

  it('puts the readings before the breakdown', () => {
    const el = createDefinitionElement('字', withEtymology());
    const order = Array.from(el.children).map(child => child.className);

    expect(order).toEqual([
      'definition-word',
      'definition-body',
      'popup-etymology-section is-collapsed',
    ]);
  });

  it('opens the breakdown only when asked to', () => {
    const closed = createDefinitionElement('字', withEtymology());
    expect(closed.querySelector('.popup-etymology-section')!.classList.contains('is-collapsed'))
      .toBe(true);

    const open = createDefinitionElement('字', withEtymology(), true, { expandEtymology: true });
    expect(open.querySelector('.popup-etymology-section')!.classList.contains('is-collapsed'))
      .toBe(false);
  });

  it('puts the met-in sentence under the senses and above the breakdown', () => {
    const el = createDefinitionElement('字', withEtymology(), true, { context: { text: '寫字' } });
    const order = Array.from(el.children).map(child => child.className);

    expect(order).toEqual([
      'definition-word',
      'definition-body',
      'context',
      'popup-etymology-section is-collapsed',
    ]);
    expect(el.querySelector('.context-sentence')?.textContent).toBe('寫字');
  });
});

describe('findScriptVariant', () => {
  const varied = (word: string): DefinitionResult => ({
    word,
    mandarin: {
      entries: [
        { traditional: '廣東話', simplified: '广东话', romanisation: 'Guang3dong1 hua4', definitions: ['Cantonese'] },
      ],
    },
    cantonese: { entries: [] },
  });

  it('offers the simplified form when reading traditional', () => {
    expect(findScriptVariant(varied('廣東話'))).toEqual({ label: 'Simplified', form: '广东话' });
  });

  it('offers the traditional form when reading simplified', () => {
    expect(findScriptVariant(varied('广东话'))).toEqual({ label: 'Traditional', form: '廣東話' });
  });

  it('offers nothing when the two scripts agree', () => {
    expect(findScriptVariant(makeDefinition())).toBeNull();
  });

  it('offers nothing for a word matching no entry', () => {
    expect(findScriptVariant(varied('別的'))).toBeNull();
  });

  it('finds the variant from the Cantonese entries too', () => {
    const definition: DefinitionResult = {
      word: '廣東話',
      mandarin: { entries: [] },
      cantonese: {
        entries: [
          { traditional: '廣東話', simplified: '广东话', romanisation: 'gwong2 dung1 waa2', definitions: ['Cantonese'] },
        ],
      },
    };

    expect(findScriptVariant(definition)).toEqual({ label: 'Simplified', form: '广东话' });
  });

  it('renders the counterpart above the readings', () => {
    const el = createDefinitionElement('廣東話', varied('廣東話'));
    expect(el.querySelector('.definition-variant-label')?.textContent).toBe('Simplified');
    expect(el.querySelector('.definition-variant-form')?.textContent).toBe('广东话');
  });

  it('renders no variant row when the scripts agree', () => {
    const el = createDefinitionElement('你好', makeDefinition());
    expect(el.querySelector('.definition-variant')).toBeNull();
  });
});

describe('definitions drawn with the reader\'s settings', () => {
  const simplified = (): DefinitionResult => makeDefinition({
    word: '学习',
    mandarin: {
      entries: [{ traditional: '學習', simplified: '学习', romanisation: 'xue2 xi2', definitions: ['to learn'] }],
    },
    cantonese: {
      entries: [{ traditional: '學習', simplified: '学习', romanisation: 'hok6 zaap6', definitions: ['to learn'] }],
    },
  });

  const labels = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('.definition-label'), node => node.textContent);

  it('puts the reader\'s primary language in the first column', () => {
    const el = createDefinitionSections(makeDefinition(), { ...DEFAULT_SETTINGS, primaryLanguage: 'cantonese' });
    expect(labels(el)).toEqual(['Cantonese', 'Mandarin']);
  });

  it('heads the definition in the reader\'s script and names the page\'s form as the variant', () => {
    const el = createDefinitionElement('学习', simplified(), true, {
      display: { ...DEFAULT_SETTINGS, script: 'traditional' },
    });

    expect(el.querySelector('.definition-word')!.textContent).toBe('學習');
    expect(el.querySelector('.definition-variant-form')!.textContent).toBe('学习');
  });

  it('measures the variant against the word the surface shows when it has no heading', () => {
    const el = createDefinitionElement('学习', simplified(), false, {
      display: { ...DEFAULT_SETTINGS, script: 'traditional' },
    });

    expect(el.querySelector('.definition-variant-form')!.textContent).toBe('學習');
  });

  it('hides the readings in both columns', () => {
    const el = createDefinitionSections(makeDefinition(), { ...DEFAULT_SETTINGS, hideRomanisation: true });
    expect(el.querySelectorAll('.romanisation-reveal')).toHaveLength(2);
  });
});

describe('headwordFor', () => {
  const definition = makeDefinition({
    word: '发',
    mandarin: {
      entries: [
        { traditional: '發', simplified: '发', romanisation: 'fa1', definitions: ['to send out'] },
        { traditional: '髮', simplified: '发', romanisation: 'fa4', definitions: ['hair'] },
      ],
    },
  });

  it('keeps the page\'s own form by default', () => {
    expect(headwordFor(definition, 'as-written')).toBe('发');
  });

  it('takes the first entry\'s form when the entries disagree', () => {
    expect(headwordFor(definition, 'traditional')).toBe('發');
  });

  it('keeps the form found when no entry holds it', () => {
    expect(headwordFor(makeDefinition({ word: '你們' }), 'simplified')).toBe('你們');
  });
});
