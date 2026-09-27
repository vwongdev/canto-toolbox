import { createElement } from './dom-element.js';
import { isLinkable } from './word-contexts.js';
import type { ContextSighting, ContextSource } from './types.js';

/**
 * The sentences a word was met in, shared by the stats list and the review
 * cards. Recall is anchored to where a word was seen, so the snippets captured
 * at track time are worth showing wherever the word is studied — and blanking
 * the word out turns one of them into the prompt for a production card.
 */

/** Stands in for the hidden word on a cloze prompt. */
export const CLOZE_BLANK = '⬚';

/**
 * Longest snippet kept per word. The content script windows the sentence to
 * this before sending it and the write path clamps it again on the way in, so
 * the number lives here — beside the component that has to render it — rather
 * than once per side of the message.
 */
export const MAX_CONTEXT_CHARS = 60;

export interface ContextOptions {
  /** Hide the word itself, leaving the sentence as a gap to fill. */
  blank?: boolean;
  label?: string;
}

function createMarker(word: string, blank: boolean): HTMLElement {
  return blank
    ? createElement({
        tag: 'span',
        className: 'context-blank',
        textContent: CLOZE_BLANK.repeat([...word].length),
      })
    : createElement({ tag: 'strong', className: 'context-word', textContent: word });
}

function createSentence(word: string, text: string, blank: boolean): HTMLElement {
  const sentence = createElement({ tag: 'p', className: 'context-sentence', attributes: { lang: 'zh' } });

  text.split(word).forEach((part, index) => {
    if (index > 0) sentence.appendChild(createMarker(word, blank));
    if (part) sentence.appendChild(document.createTextNode(part));
  });

  return sentence;
}

/**
 * Where the sentence was read, opening in a new tab so the page studying it
 * stays put. Named by its title, or its host when the page had none.
 */
function createSourceLink({ url, title }: ContextSource): HTMLElement | null {
  if (!isLinkable(url)) return null;
  return createElement({
    tag: 'a',
    className: 'context-source',
    textContent: title || new URL(url).hostname,
    attributes: { href: url, target: '_blank', rel: 'noopener', title: url },
  });
}

/**
 * Every sentence the word was met in, each under the page it came from, as
 * one block. The label is written once: the sentences are a list, not a stack
 * of separate notes.
 */
export function createContextList(
  word: string,
  contexts: readonly Pick<ContextSighting, 'text' | 'source'>[],
  { blank = false, label = 'Seen in' }: ContextOptions = {},
): HTMLElement {
  const children: HTMLElement[] = [
    createElement({ tag: 'span', className: 'context-label', textContent: label }),
  ];

  for (const { text, source } of contexts) {
    const link = source ? createSourceLink(source) : null;
    children.push(
      createElement({
        className: 'context-entry',
        children: [createSentence(word, text, blank), ...(link ? [link] : [])],
      }),
    );
  }

  return createElement({ className: 'context', children });
}

export function createContextSentence(
  word: string,
  context: string,
  options: ContextOptions = {},
): HTMLElement {
  return createContextList(word, [{ text: context }], options);
}
