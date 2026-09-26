import type { DefinitionResult } from './types.js';
import { createElement } from './dom-element.js';

/** The one dictionary a word turned up in, when it did not turn up in both. */
export type LanguageAvailability = 'mandarin' | 'cantonese';

const LABELS: Record<LanguageAvailability, string> = {
  mandarin: 'Mandarin only',
  cantonese: 'Cantonese only',
};

const DESCRIPTIONS: Record<LanguageAvailability, string> = {
  mandarin: 'Only CC-CEDICT has an entry for this word; CC-Canto gives no Cantonese reading for it.',
  cantonese: 'Only CC-Canto has an entry for this word. Often colloquial Cantonese, though ' +
    'CC-CEDICT also leaves out compounds that mean no more than their characters.',
};

/**
 * Which dictionary alone holds the word, if only one does. A Cantonese entry
 * with no senses is a bare reading — it says how the characters are said, not
 * that the word is Cantonese — so it is not enough to call a word Cantonese
 * only.
 */
export function languageAvailability(definition: DefinitionResult): LanguageAvailability | null {
  const mandarin = definition.mandarin?.entries ?? [];
  const cantonese = definition.cantonese?.entries ?? [];

  if (mandarin.length > 0 && cantonese.length === 0) return 'mandarin';
  if (mandarin.length === 0 && cantonese.some(entry => entry.definitions.length > 0)) {
    return 'cantonese';
  }
  return null;
}

/**
 * A chip saying the word belongs to one language's dictionary. A learner of
 * both needs to know that 唔該 will not be understood in Beijing before
 * drilling it, and the empty column alone reads as a gap in the data.
 */
export function createAvailabilityBadge(definition: DefinitionResult): HTMLElement | null {
  const availability = languageAvailability(definition);
  if (!availability) return null;

  return createElement({
    tag: 'span',
    className: `availability-badge availability-badge--${availability}`,
    textContent: LABELS[availability],
    attributes: { title: DESCRIPTIONS[availability] },
  });
}
