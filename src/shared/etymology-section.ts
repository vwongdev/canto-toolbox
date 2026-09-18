import type { CharacterEtymology } from './types.js';
import { createElement } from './dom-element.js';
import { CHEVRON_SVG, createIcon } from './icons.js';
import { parseComponents } from './decomposition.js';

/** Soft cap for chip gloss text; truncation drops whole portions, never mid-portion. */
const MAX_CHIP_GLOSS_CHARS = 14;

/**
 * Fit as many `sep`-joined units as will fit under `maxChars`.
 * When truncated, drops the overflowing unit and appends `…`.
 * Returns `null` when even the first unit alone exceeds the cap.
 */
function fitUnits(units: string[], sep: string, maxChars: number): string | null {
  if (units.length === 0) return '';
  if (units[0]!.length > maxChars) return null;

  const taken: string[] = [];
  for (const unit of units) {
    const candidate = taken.length === 0 ? unit : `${taken.join(sep)}${sep}${unit}`;
    if (candidate.length <= maxChars) {
      taken.push(unit);
    } else {
      break;
    }
  }

  if (taken.length === units.length) return taken.join(sep);

  while (taken.length > 0 && `${taken.join(sep)}…`.length > maxChars) {
    taken.pop();
  }
  if (taken.length === 0) return null;
  return `${taken.join(sep)}…`;
}

/**
 * Chip gloss: keep whole `;` / `,` / word portions under the char cap.
 * Overflowing portions are dropped and replaced with a trailing `…`.
 */
function firstGloss(definition: string, maxChars = MAX_CHIP_GLOSS_CHARS): string {
  const senses = definition.split(';').map(s => s.trim()).filter(Boolean);
  if (senses.length === 0) return '';

  const bySense = fitUnits(senses, '; ', maxChars);
  if (bySense !== null) return bySense;

  const byComma = fitUnits(
    senses[0]!.split(',').map(s => s.trim()).filter(Boolean),
    ', ',
    maxChars,
  );
  if (byComma !== null) return byComma;

  const byWord = fitUnits(senses[0]!.split(/\s+/).filter(Boolean), ' ', maxChars);
  if (byWord !== null) return byWord;

  // Single undividable token longer than the cap — show it whole rather than mid-split.
  return senses[0]!;
}

function createComponentChip(
  glyph: string,
  definition: string | undefined,
  role: 'meaning' | 'sound' | undefined,
  follow: (() => void) | undefined
): HTMLElement {
  const children: HTMLElement[] = [
    createElement({ tag: 'span', className: 'popup-etymology-component-glyph', textContent: glyph })
  ];
  if (definition) {
    children.push(createElement({
      tag: 'span',
      className: 'popup-etymology-component-def',
      textContent: firstGloss(definition),
      attributes: { title: definition },
    }));
  }
  if (role) {
    children.push(createElement({
      tag: 'span',
      className: `popup-etymology-component-role popup-etymology-component-role--${role}`,
      textContent: role
    }));
  }
  const roleClass = role ? ` popup-etymology-component--${role}` : '';
  if (!follow) {
    return createElement({ className: `popup-etymology-component${roleClass}`, children });
  }

  return createElement({
    tag: 'button',
    className: `popup-etymology-component${roleClass} popup-etymology-component--link`,
    children,
    attributes: { type: 'button', title: `Look up ${glyph}` },
    listeners: {
      // Surfaces wrap the breakdown in clickable rows; following a component
      // must not also collapse the row it sits in.
      click: (event: Event) => {
        event.stopPropagation();
        follow();
      },
    },
  });
}

function createComponentsRow(
  etymology: CharacterEtymology,
  onFollowComponent?: (character: string) => void,
): HTMLElement | null {
  const defs = etymology.componentDefinitions ?? {};
  const linkable = new Set(etymology.linkableComponents ?? []);

  const chip = (glyph: string, role?: 'meaning' | 'sound'): HTMLElement =>
    createComponentChip(
      glyph,
      defs[glyph],
      role,
      onFollowComponent && linkable.has(glyph) ? () => onFollowComponent(glyph) : undefined,
    );

  if (etymology.etymologyType === 'pictophonetic') {
    const chips: HTMLElement[] = [];
    if (etymology.semantic) {
      chips.push(chip(etymology.semantic, 'meaning'));
    }
    if (etymology.phonetic) {
      chips.push(chip(etymology.phonetic, 'sound'));
    }
    if (chips.length === 0) return null;
    return createElement({ className: 'popup-etymology-components', children: chips });
  }

  const components = parseComponents(etymology.decomposition);
  if (components.length === 0) return null;
  return createElement({
    className: 'popup-etymology-components',
    children: components.map(ch => chip(ch))
  });
}

const TYPE_LABELS: Record<string, string> = {
  pictophonetic: 'Phonosemantic',
  ideographic: 'Ideographic',
  pictographic: 'Pictographic',
};

function createCharacterCard(
  etymology: CharacterEtymology,
  onFollowComponent?: (character: string) => void,
): HTMLElement {
  const detailChildren: HTMLElement[] = [];

  if (etymology.etymologyType) {
    const label = TYPE_LABELS[etymology.etymologyType];
    if (label) {
      detailChildren.push(createElement({ className: 'popup-etymology-type', textContent: label }));
    }
  }

  if (etymology.hint && etymology.etymologyType !== 'pictophonetic') {
    detailChildren.push(createElement({ className: 'popup-etymology-hint', textContent: etymology.hint }));
  }

  const components = createComponentsRow(etymology, onFollowComponent);
  if (components) {
    detailChildren.push(components);
  }

  return createElement({
    className: 'popup-etymology-character',
    children: [
      createElement({ className: 'popup-etymology-char', textContent: etymology.character }),
      createElement({ className: 'popup-etymology-details', children: detailChildren })
    ]
  });
}

export interface EtymologySectionOptions {
  /**
   * Open the breakdown on render. Off everywhere but the components card,
   * whose question the breakdown is itself the answer to.
   */
  expanded?: boolean;
  /**
   * Show a component's own dictionary entry. Only the components the lookup
   * marked linkable are offered, and only where a surface can put another word
   * in front of the reader — elsewhere the chips stay labels.
   */
  onFollowComponent?: (character: string) => void;
}

/**
 * The character breakdown, behind a disclosure and under the definition. It
 * starts closed because a reader who stopped on a word wants to know what the
 * word means: expanded, the breakdown pushed that answer most of a screen down
 * on every surface that shows both.
 */
export function createEtymologySection(
  etymologies: CharacterEtymology[],
  { expanded = false, onFollowComponent }: EtymologySectionOptions = {},
): HTMLElement {
  const characters = createElement({
    className: 'popup-etymology-characters',
    children: etymologies.map(etymology => createCharacterCard(etymology, onFollowComponent))
  });

  const toggle = createElement<HTMLButtonElement>({
    tag: 'button',
    className: 'popup-etymology-toggle',
    attributes: { type: 'button', 'aria-expanded': String(expanded) },
    children: [
      createElement({
        tag: 'span',
        className: 'popup-etymology-label',
        textContent: 'Character Breakdown',
      }),
    ],
  });

  toggle.appendChild(
    createIcon(CHEVRON_SVG, { tag: 'span', className: 'popup-etymology-chevron' }),
  );

  const section = createElement({
    className: expanded ? 'popup-etymology-section' : 'popup-etymology-section is-collapsed',
    children: [toggle, characters],
  });

  toggle.addEventListener('click', (event) => {
    // Surfaces wrap this in clickable rows; opening the breakdown must not
    // also collapse the row it sits in.
    event.stopPropagation();
    const collapsed = section.classList.toggle('is-collapsed');
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  });

  return section;
}
