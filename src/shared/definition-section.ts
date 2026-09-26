import type { DefinitionResult, DictionaryEntry } from './types.js';
import { createElement } from './dom-element.js';
import { createPronunciationSection } from './pronunciation-section.js';
import { createEtymologySection } from './etymology-section.js';
import { createContextSentence } from './context-sentence.js';
import { createFrequencyBadge } from './frequency-badge.js';
import { createAvailabilityBadge } from './availability-badge.js';

export function createMandarinSection(
  data: DefinitionResult['mandarin'],
  word?: string,
): HTMLElement {
  // Mandarin holds the column open with "Not found" so the two readings stay
  // side by side even when only Cantonese has senses.
  return createPronunciationSection(data, 'Mandarin', 'pinyin', {
    showPlaceholderWhenEmpty: true,
    ...(word && { word }),
  });
}

export function createCantoneseSection(
  data: DefinitionResult['cantonese'],
  word?: string,
): HTMLElement {
  return createPronunciationSection(data, 'Cantonese', 'jyutping', {
    ...(word && { word }),
  });
}

function allEntries(definition: DefinitionResult): DictionaryEntry[] {
  return [...(definition.mandarin?.entries ?? []), ...(definition.cantonese?.entries ?? [])];
}

/**
 * The same word in the script the reader is *not* looking at. Both forms are
 * already indexed, and a learner reading traditional benefits from meeting the
 * simplified counterpart in passing (and the reverse).
 */
export function findScriptVariant(
  definition: DefinitionResult,
): { label: string; form: string } | null {
  const displayed = definition.word;
  if (!displayed) return null;

  for (const entry of allEntries(definition)) {
    if (entry.traditional === entry.simplified) continue;

    if (displayed === entry.traditional) {
      return { label: 'Simplified', form: entry.simplified };
    }
    if (displayed === entry.simplified) {
      return { label: 'Traditional', form: entry.traditional };
    }
  }

  return null;
}

function createScriptVariantElement(variant: { label: string; form: string }): HTMLElement {
  return createElement({
    className: 'definition-variant',
    children: [
      createElement({
        tag: 'span',
        className: 'definition-variant-label',
        textContent: variant.label,
      }),
      createElement({
        tag: 'span',
        className: 'definition-variant-form',
        textContent: variant.form,
      }),
    ],
  });
}

/**
 * The `definition-sections` pair (Mandarin + Cantonese) shared by every
 * surface. The popup wraps it in its own shell; stats and flashcards wrap it
 * in {@link createDefinitionElement}.
 */
export function createDefinitionSections(definition: DefinitionResult): HTMLElement {
  const word = definition.word;

  const columns = createElement({
    className: 'definition-sections',
    children: [
      createMandarinSection(definition.mandarin, word),
      createCantoneseSection(definition.cantonese, word)
    ]
  });

  // How common the word is comes first — it is what decides whether the rest
  // is worth reading — then the script counterpart, then the readings. Which
  // language the word belongs to rides beside the frequency: both say whether
  // the word is worth learning, and for which half of the reader's study.
  const variant = findScriptVariant(definition);
  const availability = createAvailabilityBadge(definition);

  return createElement({
    className: 'definition-body',
    children: [
      createElement({
        className: 'definition-badges',
        children: [
          createFrequencyBadge(definition.frequency),
          ...(availability ? [availability] : []),
        ],
      }),
      ...(variant ? [createScriptVariantElement(variant)] : []),
      columns,
    ],
  });
}

export interface DefinitionElementOptions {
  /** Render the character breakdown already open. See {@link createEtymologySection}. */
  expandEtymology?: boolean;
  /**
   * The sentence the word was met in. Sits under the senses and above the
   * breakdown: a gloss says what a word means, this says how it was used, and
   * the components are the optional extra.
   */
  context?: string;
}

/**
 * Full `definition-container` element (word + Mandarin/Cantonese sections +
 * optional etymology) shared verbatim by the stats and flashcard surfaces. The
 * popup builds its own shell around {@link createDefinitionSections} instead.
 *
 * What the word means comes before what it is built from: the breakdown is
 * worth reading second, and leading with it buried the definition under a
 * screen of component chips. When a sentence is supplied, it sits between
 * those two — under the senses, above the disclosure — so the breakdown is
 * never the thing that splits the word from where it was met.
 */
export function createDefinitionElement(
  word: string,
  definition: DefinitionResult,
  showWord = true,
  { expandEtymology = false, context }: DefinitionElementOptions = {},
): HTMLElement {
  const displayWord = definition.word || word;

  const children: HTMLElement[] = showWord
    ? [createElement({ className: 'definition-word', textContent: displayWord })]
    : [];

  children.push(createDefinitionSections(definition));

  if (context) {
    children.push(createContextSentence(word, context));
  }

  if (definition.etymology?.length) {
    children.push(createEtymologySection(definition.etymology, { expanded: expandEtymology }));
  }

  return createElement({ className: 'definition-container', children });
}
