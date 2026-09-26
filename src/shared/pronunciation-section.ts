import type { DefinitionResult } from './types.js';
import { createElement } from './dom-element.js';
import { SPEAKER_SVG, createIcon } from './icons.js';
import { createDefinitionTextElement } from './definition-list.js';
import { toSyllables } from './pinyin.js';
import { canSpeak, speak, type Reading } from './speech.js';

export interface PronunciationSectionOptions {
  /**
   * Render the "Not found" placeholder for a reading that has no senses,
   * instead of omitting the list entirely. The stats and flashcard surfaces
   * use it on the Mandarin section so the two columns stay aligned; the popup
   * simply shows nothing.
   */
  showPlaceholderWhenEmpty?: boolean;
  /** The word to pronounce. Without it the section renders no audio button. */
  word?: string;
  /**
   * Put each reading behind a press, so a reader practising the sound can try
   * it before being told.
   */
  hideRomanisation?: boolean;
}

const READING_NAMES: Readonly<Record<Reading, string>> = {
  pinyin: 'Pinyin',
  jyutping: 'Jyutping',
};

/**
 * The reading withheld until asked for. A button in its place rather than a
 * blur over it: blurred Jyutping still gives away its length and tone digits.
 */
function concealRomanisation(romanisation: HTMLElement, reading: Reading): HTMLElement {
  const name = READING_NAMES[reading];

  return createElement<HTMLButtonElement>({
    tag: 'button',
    className: 'romanisation-reveal',
    textContent: `Show ${name}`,
    attributes: { type: 'button', title: `Show the ${name} reading` },
    listeners: {
      click: (event: Event) => {
        // The stats row this sits in toggles on a click of its own.
        event.stopPropagation();
        event.preventDefault();
        (event.currentTarget as HTMLElement).replaceWith(romanisation);
      },
    },
  });
}

function createSpeakButton(word: string, reading: Reading, label: string): HTMLElement {
  return createIcon(SPEAKER_SVG, {
    tag: 'button',
    className: 'pronunciation-speak',
    attributes: {
      type: 'button',
      'aria-label': `Play ${label} pronunciation of ${word}`,
      title: `Play ${label} pronunciation`,
    },
    listeners: {
      click: (event: Event) => {
        // Surfaces wrap this in clickable rows; playing audio must not also
        // collapse the entry it sits in.
        event.stopPropagation();
        event.preventDefault();
        speak(word, reading);
      },
    },
  });
}

/** Each syllable is coloured by tone; the mark or digit still carries it too. */
function createRomanisationElement(
  romanisation: string,
  reading: Reading,
): HTMLElement {
  const children = toSyllables(romanisation, reading).map(syllable =>
    createElement({
      tag: 'span',
      className: syllable.tone
        ? `romanisation-syllable tone-${reading}-${syllable.tone}`
        : 'romanisation-syllable',
      textContent: syllable.text,
    })
  );

  return createElement({
    className: `definition-${reading}`,
    children,
  });
}

export function createPronunciationSection(
  data: DefinitionResult['mandarin'] | DefinitionResult['cantonese'],
  label: string,
  pronunciationKey: Reading,
  { showPlaceholderWhenEmpty = false, word, hideRomanisation = false }: PronunciationSectionOptions = {}
): HTMLElement {
  const grouped = groupEntriesByRomanisation(data?.entries || []);

  const pronunciationGroups = Object.entries(grouped).map(([pronunciation, defs]) => {
    const romanisation = createRomanisationElement(pronunciation, pronunciationKey);
    // An entry with no reading has nothing to withhold.
    const groupChildren: HTMLElement[] = [
      hideRomanisation && pronunciation
        ? concealRomanisation(romanisation, pronunciationKey)
        : romanisation,
    ];

    if (defs.length > 0 || showPlaceholderWhenEmpty) {
      groupChildren.push(createDefinitionTextElement(defs));
    }

    return createElement({ className: 'pronunciation-group', children: groupChildren });
  });

  const heading: HTMLElement[] = [
    createElement({ className: 'definition-label', textContent: label }),
  ];

  // No audio for a reading this browser has no voice for — a Mandarin voice
  // reading Jyutping would teach the wrong pronunciation.
  if (word && pronunciationGroups.length > 0 && canSpeak(pronunciationKey)) {
    heading.push(createSpeakButton(word, pronunciationKey, label));
  }

  return createElement({
    className: 'definition-section',
    children: [
      createElement({ className: 'definition-heading', children: heading }),
      ...pronunciationGroups
    ]
  });
}

function groupEntriesByRomanisation(entries: Array<{ romanisation?: string; definitions?: string[] }>): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const entry of entries) {
    const romanisation = entry.romanisation || '';
    if (!grouped[romanisation]) {
      grouped[romanisation] = [];
    }
    const defs = entry.definitions || [];
    grouped[romanisation].push(...defs.filter(d => d && String(d).trim().length > 0));
  }
  return grouped;
}
