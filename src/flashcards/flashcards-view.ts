import type { DefinitionResult, FlashcardRating, ReviewDirection } from '../shared/types.js';
import { createElement, setMultilineText } from '../shared/dom-element.js';
import { createDefinitionElement } from '../shared/definition-section.js';
import { createContextSentence } from '../shared/context-sentence.js';
import { primaryGloss } from '../shared/gloss.js';
import { SPEAKER_SVG, createIcon } from '../shared/icons.js';
import type { Reading } from '../shared/speech.js';
import { DEFAULT_SETTINGS, type DisplaySettings } from '../shared/settings.js';
import type { ReviewCard } from './session.js';

export const ELEMENT_IDS = {
  progress: 'progress',
  counter: 'counter',
  cardFront: 'card-front',
  cardBack: 'card-back',
  showAnswerContainer: 'show-answer-btn-container',
  ratingBtns: 'rating-btns',
  card: 'card',
  showAnswerBtn: 'show-answer-btn',
  writingNext: 'writing-next',
  writingNextBtn: 'writing-next-btn',
  reviewAgainBtn: 'review-again-btn',
  knowBtn: 'know-btn',
  resultSummary: 'result-summary',
  retiredNotice: 'retired-notice',
  retiredMessage: 'retired-message',
  undoRetireBtn: 'undo-retire-btn'
} as const;

/** Every control that leaves the deck for the statistics page. */
export const STATS_LINK_SELECTOR = '.stats-link';

export const SCREEN_IDS = {
  loading: 'loading',
  emptyState: 'empty-state',
  review: 'review',
  finished: 'finished'
} as const;

export type ScreenId = (typeof SCREEN_IDS)[keyof typeof SCREEN_IDS];

export function setScreen(document: Document, id: ScreenId): void {
  Object.values(SCREEN_IDS).forEach(screenId => {
    const el = document.getElementById(screenId);
    if (el) el.style.display = screenId === id ? '' : 'none';
  });
}

/**
 * The empty screen covers two different situations — nothing tracked yet, and
 * a deck with nothing due — so its copy is set by the caller. Newlines become
 * line breaks to match the markup's original two-line shape.
 */
export function renderEmptyState(document: Document, message: string): void {
  setScreen(document, SCREEN_IDS.emptyState);

  const paragraph = document.getElementById(SCREEN_IDS.emptyState)?.querySelector('p');
  if (paragraph) setMultilineText(paragraph, message);
}

export function renderFinished(document: Document, correctCount: number, totalCount: number): void {
  setScreen(document, SCREEN_IDS.finished);
  const summaryEl = document.getElementById(ELEMENT_IDS.resultSummary);
  if (summaryEl) {
    summaryEl.textContent = `${correctCount} / ${totalCount} correct`;
  }
}

/**
 * Retiring buries every card a word owns and cannot be guessed at from the
 * session that carries on without it, so it is said out loud and taken back
 * with one press.
 */
export function showRetiredNotice(document: Document, word: string): void {
  const notice = document.getElementById(ELEMENT_IDS.retiredNotice);
  const message = document.getElementById(ELEMENT_IDS.retiredMessage);
  if (message) message.textContent = `Retired ${word}.`;
  if (notice) notice.style.display = '';
}

export function hideRetiredNotice(document: Document): void {
  const notice = document.getElementById(ELEMENT_IDS.retiredNotice);
  if (notice) notice.style.display = 'none';
}

export function updateProgress(document: Document, done: number, total: number): void {
  const progressEl = document.getElementById(ELEMENT_IDS.progress);
  const counterEl = document.getElementById(ELEMENT_IDS.counter);
  if (progressEl) {
    progressEl.style.width = total > 0 ? `${(done / total) * 100}%` : '0%';
  }
  if (counterEl) {
    counterEl.textContent = `Card ${done + 1} of ${total}`;
  }
}

export function getCurrentWord(document: Document): string | undefined {
  return document.getElementById(ELEMENT_IDS.card)?.dataset.currentWord;
}

export function getCurrentDirection(document: Document): ReviewDirection | undefined {
  return document.getElementById(ELEMENT_IDS.card)?.dataset.currentDirection as
    | ReviewDirection
    | undefined;
}

function isVisible(document: Document, id: string): boolean {
  const el = document.getElementById(id);
  return el !== null && el.style.display !== 'none';
}

export function isScreenVisible(document: Document, id: ScreenId): boolean {
  return isVisible(document, id);
}

/** True once the answer is revealed and the rating buttons are actionable. */
export function isAnswerVisible(document: Document): boolean {
  return isVisible(document, ELEMENT_IDS.ratingBtns);
}

/**
 * True once a writing quiz is done. Its rating is already decided by the
 * mistake count, so the card offers one way on rather than four.
 */
export function isWritingAnswerVisible(document: Document): boolean {
  return isVisible(document, ELEMENT_IDS.writingNext);
}

/** False while a lookup is in flight, so a reveal cannot be requested twice. */
export function isAnswerRevealable(document: Document): boolean {
  return isVisible(document, ELEMENT_IDS.showAnswerContainer);
}

/** What each card asks for, named on the card so the prompt is never ambiguous. */
const PROMPTS: Readonly<Record<ReviewDirection, string>> = {
  recognition: 'What does it mean?',
  production: 'Which word is it?',
  listening: 'What did you hear?',
  components: 'What is it made of?',
  writing: 'In what stroke order?',
};

const DIRECTION_LABELS: Readonly<Record<ReviewDirection, string>> = {
  recognition: 'Recognise',
  production: 'Produce',
  listening: 'Listen',
  components: 'Parts',
  writing: 'Write',
};

function createPrompt(direction: ReviewDirection): HTMLElement {
  return createElement({
    className: 'card-prompt',
    children: [
      createElement({
        tag: 'span',
        className: `card-kind card-kind--${direction}`,
        textContent: DIRECTION_LABELS[direction],
      }),
      createElement({ tag: 'span', className: 'card-ask', textContent: PROMPTS[direction] }),
    ],
  });
}

/**
 * The production front: the meaning, and the sentence with the word cut out of
 * it. The word itself is what the reader has to supply, so it appears nowhere.
 */
function createProductionFront(card: ReviewCard, definition: DefinitionResult | undefined): HTMLElement[] {
  const gloss = definition ? primaryGloss(definition) : '';

  const children: HTMLElement[] = [
    createElement({
      className: gloss ? 'card-gloss' : 'card-gloss card-gloss--missing',
      textContent: gloss || 'Definition unavailable',
    }),
  ];

  if (card.context) {
    children.push(createContextSentence(card.word, card.context.text, { blank: true, label: 'In context' }));
  }

  return children;
}

/**
 * Put the card into one of its states: what the front holds, and whether the
 * answer can be asked for. Every render of a front is this plus its content,
 * so the element juggling lives in one place and the callers stay about the
 * card rather than about which of four elements is showing.
 */
function showFront(
  document: Document,
  card: ReviewCard,
  content: HTMLElement[],
  { revealable }: { revealable: boolean },
): void {
  const cardFront = document.getElementById(ELEMENT_IDS.cardFront);
  const cardBack = document.getElementById(ELEMENT_IDS.cardBack);
  const showAnswerContainer = document.getElementById(ELEMENT_IDS.showAnswerContainer);
  const ratingBtns = document.getElementById(ELEMENT_IDS.ratingBtns);

  if (cardFront) {
    cardFront.replaceChildren(...content);
    cardFront.style.display = '';
  }
  if (cardBack) {
    cardBack.replaceChildren();
    cardBack.style.display = 'none';
  }
  if (showAnswerContainer) showAnswerContainer.style.display = revealable ? '' : 'none';
  if (ratingBtns) ratingBtns.style.display = 'none';

  const writingNext = document.getElementById(ELEMENT_IDS.writingNext);
  if (writingNext) writingNext.style.display = 'none';

  const cardEl = document.getElementById(ELEMENT_IDS.card);
  if (cardEl) {
    cardEl.dataset.currentWord = card.word;
    cardEl.dataset.currentDirection = card.direction;
  }
}

export function renderFront(
  document: Document,
  card: ReviewCard,
  definition?: DefinitionResult,
): void {
  const question = card.direction === 'production'
    ? createProductionFront(card, definition)
    : [createElement({ className: 'card-characters', textContent: card.word, attributes: { lang: 'zh' } })];

  showFront(document, card, [createPrompt(card.direction), ...question], { revealable: true });
}

/**
 * The writing front: an empty grid for the quiz to draw into. There is nothing
 * to reveal — the quiz *is* the question, and it ends itself — so the Show
 * Answer row stays hidden and the caller gets the pane to mount into.
 */
export function renderWritingFront(document: Document, card: ReviewCard): HTMLElement | undefined {
  const pane = createElement({ className: 'card-writing' });

  showFront(document, card, [createPrompt(card.direction), pane], { revealable: false });

  return pane;
}

/**
 * The listening front: nothing to read, only a way to hear the word again.
 * The word stays off the card until the answer, since seeing it would turn the
 * card back into recognition.
 */
export function renderListeningFront(
  document: Document,
  card: ReviewCard,
  onReplay: () => void,
): void {
  const replay = createIcon(SPEAKER_SVG, {
    tag: 'button',
    className: 'btn btn-secondary card-listen',
    attributes: { type: 'button', 'aria-label': 'Play the word again', title: 'Play again' },
    listeners: { click: onReplay },
  });
  replay.appendChild(createElement({ tag: 'kbd', className: 'key-hint', textContent: 'R' }));

  showFront(document, card, [createPrompt(card.direction), replay], { revealable: true });
}

/** Placeholder for the one front that cannot be drawn until a lookup returns. */
export function renderFrontLoading(document: Document, card: ReviewCard): void {
  // Nothing has been asked yet, so there is nothing to reveal.
  showFront(
    document,
    card,
    [createElement({ className: 'card-gloss', textContent: 'Loading…' })],
    { revealable: false },
  );
}

/** Loading placeholder shown on the card back while a lookup is in flight. */
export function renderBackLoading(document: Document): void {
  const cardBack = document.getElementById(ELEMENT_IDS.cardBack);
  if (cardBack) {
    cardBack.textContent = 'Loading…';
    cardBack.style.display = '';
  }
  const showAnswerContainer = document.getElementById(ELEMENT_IDS.showAnswerContainer);
  if (showAnswerContainer) showAnswerContainer.style.display = 'none';
}

/** `word` names the answer for a card whose front never showed it. */
export function renderBackError(document: Document, word?: string): void {
  const cardBack = document.getElementById(ELEMENT_IDS.cardBack);
  if (cardBack) {
    cardBack.replaceChildren();
    if (word) cardBack.appendChild(createElement({ className: 'card-characters', textContent: word, attributes: { lang: 'zh' } }));
    cardBack.appendChild(
      createElement({ className: 'flashcard-error', textContent: 'Definition not found' })
    );
  }
  const ratingBtns = document.getElementById(ELEMENT_IDS.ratingBtns);
  if (ratingBtns) ratingBtns.style.display = '';
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30 * DAY_MS;

/**
 * How far off a review is, in the fewest characters that still say it. This
 * sits on a button between a word and a keyboard hint, so "10m" earns its
 * place where "in 10 minutes" would not.
 */
function formatInterval(ms: number): string {
  const ahead = Math.max(ms, 0);

  if (ahead < HOUR_MS) return `${Math.max(Math.round(ahead / MINUTE_MS), 1)}m`;
  if (ahead < DAY_MS) return `${Math.round(ahead / HOUR_MS)}h`;
  if (ahead < MONTH_MS) return `${Math.round(ahead / DAY_MS)}d`;
  return `${Math.round(ahead / MONTH_MS)}mo`;
}

/**
 * What each rating costs, written on the button that charges it. Without this
 * the four buttons are a self-assessment with no stated consequence, and
 * "Hard" and "Good" are indistinguishable until the word comes back.
 */
export function renderRatingIntervals(
  document: Document,
  due: Record<FlashcardRating, number>,
  now: number,
): void {
  const ratingBtns = document.getElementById(ELEMENT_IDS.ratingBtns);
  if (!ratingBtns) return;

  ratingBtns.querySelectorAll<HTMLElement>('[data-rating]').forEach(button => {
    const rating = button.dataset.rating as FlashcardRating | undefined;
    if (!rating || due[rating] === undefined) return;

    const existing = button.querySelector('.btn-interval');
    const interval = existing ?? createElement({ tag: 'span', className: 'btn-interval' });
    interval.textContent = formatInterval(due[rating] - now);
    if (!existing) button.appendChild(interval);
  });
}

const RATING_LABELS: Readonly<Record<FlashcardRating, string>> = {
  again: 'Again',
  hard: 'Hard',
  good: 'Good',
  easy: 'Easy',
};

/**
 * Whether the card's question is the word's sound. Its answer is then the
 * reading itself, and hiding the reading behind a press would hide the answer,
 * so the reader's "hide romanisation" setting does not apply to it. A record
 * rather than a list so a direction added later has to say which it is.
 */
const TESTS_READING: Readonly<Record<ReviewDirection, boolean>> = {
  recognition: false,
  production: false,
  // The front plays the sound and asks for the meaning; the reading on the
  // answer is information about what was heard, not the thing tested.
  listening: false,
  components: false,
  writing: false,
};

function displayFor(card: ReviewCard, display: DisplaySettings): DisplaySettings {
  return TESTS_READING[card.direction] ? { ...display, hideRomanisation: false } : display;
}

function countMistakes(mistakes: number): string {
  if (mistakes === 0) return 'No mistakes';
  return `${mistakes} ${mistakes === 1 ? 'mistake' : 'mistakes'}`;
}

/**
 * The writing back: what the character means, under the tally the quiz
 * produced. The tally is the whole explanation for the grade the reader never
 * chose, so it says the grade out loud rather than only the mistake count.
 */
export function renderWritingBack(
  document: Document,
  card: ReviewCard,
  definition: DefinitionResult | undefined,
  { mistakes, rating }: { mistakes: number; rating: FlashcardRating },
  display: DisplaySettings = DEFAULT_SETTINGS,
): void {
  const cardBack = document.getElementById(ELEMENT_IDS.cardBack);
  const showAnswerContainer = document.getElementById(ELEMENT_IDS.showAnswerContainer);
  const writingNext = document.getElementById(ELEMENT_IDS.writingNext);

  if (cardBack) {
    cardBack.replaceChildren(
      createElement({
        className: `card-tally card-tally--${rating}`,
        textContent: `${countMistakes(mistakes)} · ${RATING_LABELS[rating]}`,
      }),
    );

    // The front was an outline the reader traced, so the answer names the
    // character it turned out to be.
    if (definition) {
      cardBack.appendChild(
        createDefinitionElement(card.word, definition, true, { display: displayFor(card, display) }),
      );
    } else cardBack.appendChild(
      createElement({ className: 'flashcard-error', textContent: 'Definition not found' }),
    );

    cardBack.style.display = '';
  }

  if (showAnswerContainer) showAnswerContainer.style.display = 'none';
  if (writingNext) writingNext.style.display = '';
}

const READING_NAMES: Readonly<Record<Reading, string>> = {
  jyutping: 'Cantonese',
  pinyin: 'Mandarin',
};

export function renderBack(
  document: Document,
  card: ReviewCard,
  definition: DefinitionResult,
  { heard, display = DEFAULT_SETTINGS }: { heard?: Reading; display?: DisplaySettings } = {},
): void {
  const cardBack = document.getElementById(ELEMENT_IDS.cardBack);
  const showAnswerContainer = document.getElementById(ELEMENT_IDS.showAnswerContainer);
  const ratingBtns = document.getElementById(ELEMENT_IDS.ratingBtns);

  if (cardBack) {
    cardBack.replaceChildren();

    // The definition shows both readings, and the reader only heard one of
    // them; without this a Mandarin fallback would pass for Cantonese.
    if (heard) {
      cardBack.appendChild(
        createElement({ className: 'card-heard', textContent: `Heard in ${READING_NAMES[heard]}` }),
      );
    }

    // Only the production and listening cards withheld the word, so only
    // their answers lead with it; the others already have it on the front. The
    // components card is the one whose answer *is* the breakdown, so its
    // disclosure starts open. Context is handed to the definition so it lands
    // under the senses and above the breakdown, rather than after a disclosure
    // that hid it.
    const withheld = card.direction === 'production' || card.direction === 'listening';
    cardBack.appendChild(
      createDefinitionElement(card.word, definition, withheld, {
        expandEtymology: card.direction === 'components',
        display: displayFor(card, display),
        ...(card.context !== undefined && { context: card.context }),
      })
    );
    cardBack.style.display = '';
  }
  if (showAnswerContainer) showAnswerContainer.style.display = 'none';
  if (ratingBtns) ratingBtns.style.display = '';
}
