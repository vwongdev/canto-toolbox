// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { createEtymologySection } from '../etymology-section.js';
import type { CharacterEtymology } from '../types.js';

const makeEtymology = (overrides: Partial<CharacterEtymology> = {}): CharacterEtymology => ({
  character: '好',
  decomposition: '⿰女子',
  radical: '女',
  ...overrides,
});

describe('createEtymologySection', () => {
  it('renders the section label', () => {
    const el = createEtymologySection([makeEtymology()]);
    expect(el.querySelector('.popup-etymology-label')?.textContent).toBe('Character Breakdown');
  });

  it('renders one card per etymology entry', () => {
    const el = createEtymologySection([makeEtymology(), makeEtymology({ character: '字' })]);
    expect(el.querySelectorAll('.popup-etymology-character').length).toBe(2);
  });

  it('renders the character glyph', () => {
    const el = createEtymologySection([makeEtymology()]);
    expect(el.querySelector('.popup-etymology-char')?.textContent).toBe('好');
  });

  it('renders no type badge when etymologyType is absent', () => {
    const el = createEtymologySection([makeEtymology()]);
    expect(el.querySelector('.popup-etymology-type')).toBeNull();
  });

  it('renders Phonosemantic badge for pictophonetic type', () => {
    const el = createEtymologySection([makeEtymology({ etymologyType: 'pictophonetic' })]);
    expect(el.querySelector('.popup-etymology-type')?.textContent).toBe('Phonosemantic');
  });

  it('renders Ideographic badge for ideographic type', () => {
    const el = createEtymologySection([makeEtymology({ etymologyType: 'ideographic' })]);
    expect(el.querySelector('.popup-etymology-type')?.textContent).toBe('Ideographic');
  });

  it('renders Pictographic badge for pictographic type', () => {
    const el = createEtymologySection([makeEtymology({ etymologyType: 'pictographic' })]);
    expect(el.querySelector('.popup-etymology-type')?.textContent).toBe('Pictographic');
  });

  it('renders hint for ideographic', () => {
    const el = createEtymologySection([makeEtymology({ etymologyType: 'ideographic', hint: 'two trees' })]);
    expect(el.querySelector('.popup-etymology-hint')?.textContent).toBe('two trees');
  });

  it('renders hint for pictographic', () => {
    const el = createEtymologySection([makeEtymology({ etymologyType: 'pictographic', hint: 'sun' })]);
    expect(el.querySelector('.popup-etymology-hint')?.textContent).toBe('sun');
  });

  it('does not render hint for pictophonetic', () => {
    const el = createEtymologySection([makeEtymology({ etymologyType: 'pictophonetic', hint: 'person' })]);
    expect(el.querySelector('.popup-etymology-hint')).toBeNull();
  });

  it('renders semantic chip with meaning role for pictophonetic', () => {
    const el = createEtymologySection([makeEtymology({
      etymologyType: 'pictophonetic',
      semantic: '女',
      phonetic: '子',
    })]);
    const chips = el.querySelectorAll('.popup-etymology-component');
    expect(chips.length).toBe(2);
    const glyphs = Array.from(chips).map(c => c.querySelector('.popup-etymology-component-glyph')?.textContent);
    expect(glyphs).toContain('女');
    expect(glyphs).toContain('子');
    const roles = Array.from(chips).map(c => c.querySelector('[class*="component-role"]')?.textContent);
    expect(roles).toContain('meaning');
    expect(roles).toContain('sound');
  });

  it('renders only semantic chip when phonetic is absent', () => {
    const el = createEtymologySection([makeEtymology({
      etymologyType: 'pictophonetic',
      semantic: '女',
    })]);
    const chips = el.querySelectorAll('.popup-etymology-component');
    expect(chips.length).toBe(1);
    expect(chips[0]?.querySelector('.popup-etymology-component-glyph')?.textContent).toBe('女');
    expect(chips[0]?.querySelector('[class*="component-role--meaning"]')?.textContent).toBe('meaning');
  });

  it('renders decomposition components for ideographic type', () => {
    const el = createEtymologySection([makeEtymology({ etymologyType: 'ideographic' })]);
    const glyphs = Array.from(el.querySelectorAll('.popup-etymology-component-glyph')).map(e => e.textContent);
    expect(glyphs).toContain('女');
    expect(glyphs).toContain('子');
  });

  it('renders component definitions when provided', () => {
    const el = createEtymologySection([makeEtymology({
      etymologyType: 'pictophonetic',
      semantic: '女',
      phonetic: '子',
      componentDefinitions: { '女': 'woman', '子': 'child' },
    })]);
    const defs = Array.from(el.querySelectorAll('.popup-etymology-component-def')).map(e => e.textContent);
    expect(defs).toContain('woman');
    expect(defs).toContain('child');
  });

  it('drops overflowing sense portions and appends an ellipsis', () => {
    const el = createEtymologySection([makeEtymology({
      etymologyType: 'pictophonetic',
      semantic: '口',
      phonetic: '羊',
      componentDefinitions: {
        '口': 'mouth; entrance, gate, opening',
        '羊': 'sheep, goat',
      },
    })]);
    const defs = Array.from(el.querySelectorAll('.popup-etymology-component-def'));
    const mouth = defs.find(d => d.getAttribute('title') === 'mouth; entrance, gate, opening');
    const sheep = defs.find(d => d.getAttribute('title') === 'sheep, goat');
    expect(mouth?.textContent).toBe('mouth…');
    expect(sheep?.textContent).toBe('sheep, goat');
  });

  it('drops overflowing comma portions within a long first sense', () => {
    const el = createEtymologySection([makeEtymology({
      character: '白',
      decomposition: '白',
      etymologyType: 'pictographic',
      componentDefinitions: {
        '白': 'white, clear, pure, unblemished, bright',
      },
    })]);
    const def = el.querySelector('.popup-etymology-component-def');
    expect(def?.textContent).toBe('white, clear…');
    expect(def?.getAttribute('title')).toBe('white, clear, pure, unblemished, bright');
  });

  it('leaves a short definition without separators unchanged', () => {
    const el = createEtymologySection([makeEtymology({
      etymologyType: 'ideographic',
      componentDefinitions: { '女': 'woman', '子': 'child' },
    })]);
    const defs = Array.from(el.querySelectorAll('.popup-etymology-component-def'));
    expect(defs.map(d => d.textContent)).toEqual(expect.arrayContaining(['woman', 'child']));
    for (const def of defs) {
      expect(def.getAttribute('title')).toBe(def.textContent);
    }
  });

  it('renders no definition spans when componentDefinitions is absent', () => {
    const el = createEtymologySection([makeEtymology({
      etymologyType: 'pictophonetic',
      semantic: '女',
      phonetic: '子',
    })]);
    expect(el.querySelectorAll('.popup-etymology-component-def').length).toBe(0);
  });

  it('renders no components for pictophonetic with neither semantic nor phonetic', () => {
    const el = createEtymologySection([makeEtymology({ etymologyType: 'pictophonetic' })]);
    expect(el.querySelectorAll('.popup-etymology-component').length).toBe(0);
  });

  it('strips IDS operators from decomposition components', () => {
    const el = createEtymologySection([makeEtymology({ decomposition: '⿰女子' })]);
    const glyphs = Array.from(el.querySelectorAll('.popup-etymology-component-glyph')).map(e => e.textContent);
    expect(glyphs).not.toContain('⿰');
    expect(glyphs).toContain('女');
    expect(glyphs).toContain('子');
  });

  it('renders an empty characters container for an empty input array', () => {
    const el = createEtymologySection([]);
    expect(el.querySelectorAll('.popup-etymology-character').length).toBe(0);
  });
});

describe('following a component', () => {
  const chipFor = (el: HTMLElement, glyph: string) =>
    Array.from(el.querySelectorAll('.popup-etymology-component')).find(
      chip => chip.querySelector('.popup-etymology-component-glyph')?.textContent === glyph,
    );

  it('leaves chips as labels when the surface cannot follow them', () => {
    const el = createEtymologySection([makeEtymology({ componentsWithEntries: ['女', '子'] })]);

    expect(el.querySelectorAll('.popup-etymology-component--link').length).toBe(0);
  });

  it('offers only the components the lookup found an entry for', () => {
    const el = createEtymologySection(
      [makeEtymology({ componentsWithEntries: ['女'] })],
      { onFollowComponent: vi.fn() },
    );

    expect(chipFor(el, '女')?.tagName).toBe('BUTTON');
    expect(chipFor(el, '子')?.tagName).not.toBe('BUTTON');
  });

  it('follows the component that was clicked', () => {
    const onFollowComponent = vi.fn();
    const el = createEtymologySection(
      [makeEtymology({ componentsWithEntries: ['女', '子'] })],
      { onFollowComponent },
    );

    (chipFor(el, '子') as HTMLButtonElement).click();

    expect(onFollowComponent).toHaveBeenCalledWith('子');
  });

  it('follows the phonosemantic pair as well as a plain decomposition', () => {
    const onFollowComponent = vi.fn();
    const el = createEtymologySection(
      [makeEtymology({
        character: '字',
        decomposition: '⿱宀子',
        etymologyType: 'pictophonetic',
        semantic: '宀',
        phonetic: '子',
        componentsWithEntries: ['子'],
      })],
      { onFollowComponent },
    );

    (chipFor(el, '子') as HTMLButtonElement).click();

    expect(onFollowComponent).toHaveBeenCalledWith('子');
    expect(chipFor(el, '宀')?.tagName).not.toBe('BUTTON');
  });

  it('does not collapse the row the breakdown sits in', () => {
    const onRowClick = vi.fn();
    const row = document.createElement('div');
    row.addEventListener('click', onRowClick);
    row.appendChild(createEtymologySection(
      [makeEtymology({ componentsWithEntries: ['女'] })],
      { onFollowComponent: vi.fn() },
    ));
    document.body.appendChild(row);

    (chipFor(row, '女') as HTMLButtonElement).click();

    expect(onRowClick).not.toHaveBeenCalled();
  });
});

describe('createEtymologySection disclosure', () => {
  const toggleOf = (el: HTMLElement) =>
    el.querySelector('.popup-etymology-toggle') as HTMLButtonElement;

  it('starts closed', () => {
    const el = createEtymologySection([makeEtymology()]);

    expect(el.classList.contains('is-collapsed')).toBe(true);
    expect(toggleOf(el).getAttribute('aria-expanded')).toBe('false');
  });

  it('starts open when asked to', () => {
    const el = createEtymologySection([makeEtymology()], { expanded: true });

    expect(el.classList.contains('is-collapsed')).toBe(false);
    expect(toggleOf(el).getAttribute('aria-expanded')).toBe('true');
  });

  it('opens and closes on the toggle', () => {
    const el = createEtymologySection([makeEtymology()]);
    const toggle = toggleOf(el);

    toggle.click();
    expect(el.classList.contains('is-collapsed')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    toggle.click();
    expect(el.classList.contains('is-collapsed')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  // Stats rows expand on a click anywhere in them, so an opening breakdown
  // must not close the row that holds it.
  it('does not let the toggle click reach the surface around it', () => {
    const el = createEtymologySection([makeEtymology()]);
    const row = document.createElement('div');
    const onRowClick = vi.fn();
    row.addEventListener('click', onRowClick);
    row.appendChild(el);

    toggleOf(el).click();

    expect(onRowClick).not.toHaveBeenCalled();
  });
});
