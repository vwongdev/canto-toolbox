import type {
  DefinitionResult,
  FlashcardRating,
  Statistics,
} from '../shared/types.js';
import { flashcardClient, type FlashcardClient } from './flashcard-client.js';
import {
  cardKey,
  nextReviewAt,
  selectSession,
  type DeckCapabilities,
  type ReviewCard,
} from './session.js';
import {
  ELEMENT_IDS,
  SCREEN_IDS,
  setScreen,
  renderEmptyState,
  renderFinished,
  updateProgress,
  getCurrentWord,
  getCurrentDirection,
  renderFront,
  renderFrontLoading,
  renderWritingFront,
  renderListeningFront,
  renderWritingBack,
  renderBack,
  renderBackLoading,
  renderBackError,
  isScreenVisible,
  isAnswerVisible,
  isWritingAnswerVisible,
  isAnswerRevealable,
  renderRatingIntervals,
  showRetiredNotice,
  hideRetiredNotice,
  STATS_LINK_SELECTOR
} from './flashcards-view.js';
import { previewSchedule } from '../shared/scheduler.js';
import { progressFor } from '../shared/statistics-utils.js';
import { ratingForMistakes, startQuiz, type WritingQuiz } from './writing.js';
import { listeningReading } from './listening.js';
import { speak, whenVoicesReady, type Reading } from '../shared/speech.js';
import { DEFAULT_SETTINGS, watchSettings, type Settings } from '../shared/settings.js';

const NOTHING_TRACKED =
  'No words to review yet.\nPress + Study in the popup to add a word, ' +
  'or keep reading — a word you look up often enough joins the deck on its own.';

const RATING_KEYS: Readonly<Record<string, FlashcardRating>> = {
  '1': 'again',
  '2': 'hard',
  '3': 'good',
  '4': 'easy'
};

const ADVANCE_KEYS = [' ', 'Enter'];
const DEFAULT_RATING: FlashcardRating = 'good';

const STATS_PAGE = 'src/stats/stats.html';

/** Everything a retirement took out of the session, so undoing puts it back. */
interface RetiredWord {
  word: string;
  /** The card that was on screen when the word was retired. */
  card: ReviewCard;
  /** Its other queued appearances — a card requeued by an earlier "Again". */
  queued: ReviewCard[];
  session: ReviewCard[];
  totalCount: number;
}

function fisherYatesShuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

function formatRelative(deltaMs: number): string {
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const minutes = Math.round(deltaMs / 60_000);
  if (Math.abs(minutes) < 60) return format.format(minutes, 'minute');

  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return format.format(hours, 'hour');

  return format.format(Math.round(hours / 24), 'day');
}

function emptyStateMessage(
  statistics: Statistics,
  now: number,
  capabilities: DeckCapabilities,
): string {
  const next = nextReviewAt(statistics, capabilities);
  if (next === undefined) return NOTHING_TRACKED;

  return `All caught up.\nYour next review is due ${formatRelative(next - now)}.`;
}

export class FlashcardManager {
  private readonly document: Document;
  private readonly client: FlashcardClient;
  private reviewQueue: ReviewCard[] = [];
  private sessionCards: ReviewCard[] = [];
  /** The record the session was built from, so a card can price its own ratings. */
  private statistics: Statistics = {};
  private correctCount = 0;
  private totalCount = 0;
  /** Definitions already fetched this session, keyed by word. */
  private readonly definitions = new Map<string, DefinitionResult>();
  /**
   * Cards whose answer has already reached the scheduler this session. A
   * requeued "Again" and a "Review again" round are drills, not new evidence
   * about memory: sending them would have FSRS reschedule against an interval
   * of roughly zero and rewrite a stability that was never really tested.
   */
  private readonly scheduled = new Set<string>();
  /** The quiz on screen, so a card left behind stops listening for strokes. */
  private quiz: WritingQuiz | undefined;
  /** The grade a finished quiz measured, waiting on the reader to move on. */
  private pendingRating: FlashcardRating | undefined;
  /** What the last retirement took out of the session, in case it was a slip. */
  private retired: RetiredWord | undefined;
  /** The reading listening cards play in, or null when no voice can say one. */
  private listening: Reading | null = null;
  private settings: Settings = DEFAULT_SETTINGS;

  constructor(document: Document, client: FlashcardClient) {
    this.document = document;
    this.client = client;
  }

  /**
   * A change lands on the next card drawn. The session already chosen stays as
   * it is: resizing it mid-review would drop cards the reader was promised.
   */
  applySettings(settings: Settings): void {
    this.settings = settings;
  }

  init(): void {
    this.setupRatingButtons();
    this.setupShowAnswerButton();
    this.setupWritingNextButton();
    this.setupReviewAgainButton();
    this.setupKnowButton();
    this.setupUndoRetireButton();
    this.setupStatsLinks();
    this.setupKeyboardShortcuts();

    void this.client.getStatistics().then(
      statistics => {
        // Whether listening cards can be offered is only known once the voices
        // have loaded, and the session is built around the answer.
        whenVoicesReady(voices => {
          this.listening = listeningReading(voices);
          this.startSession(statistics);
        });
      },
      () => renderEmptyState(this.document, NOTHING_TRACKED),
    );
  }

  private startSession(statistics: Statistics): void {
    const now = Date.now();
    const capabilities: DeckCapabilities = { listening: this.listening !== null };
    const session = selectSession(statistics, now, capabilities, this.settings);

    if (session.length === 0) {
      renderEmptyState(this.document, emptyStateMessage(statistics, now, capabilities));
      return;
    }

    this.statistics = statistics;
    this.sessionCards = session;
    this.reviewQueue = [...session];
    this.correctCount = 0;
    this.totalCount = session.length;
    setScreen(this.document, SCREEN_IDS.review);
    this.showNextCard();
  }

  showNextCard(): void {
    this.endQuiz();

    const card = this.reviewQueue.shift();
    if (card === undefined) {
      renderFinished(this.document, this.correctCount, this.totalCount);
      return;
    }

    const queued = this.reviewQueue.length;
    const done = this.totalCount - queued - 1;
    updateProgress(this.document, done, this.totalCount);

    // Only the production card needs the dictionary to pose its question; the
    // others are drawn from the word alone and must not wait on a lookup.
    if (card.direction === 'production') {
      renderFrontLoading(this.document, card);
      this.withDefinition(card, definition => renderFront(this.document, card, definition));
      return;
    }

    if (card.direction === 'writing') {
      this.startWriting(card);
      return;
    }

    if (card.direction === 'listening') {
      renderListeningFront(this.document, card, () => this.replay());
      this.replay();
      return;
    }

    renderFront(this.document, card);
  }

  /**
   * Say the listening card's word. Chrome refuses speech before the page has
   * seen a click or a key, so the first card of a freshly opened tab may play
   * nothing on its own — which is what the replay button and `R` are for.
   */
  private replay(): void {
    const card = this.currentCard();
    if (card?.direction !== 'listening' || !this.listening) return;

    speak(card.word, this.listening);
  }

  /**
   * The writing card grades itself, so the quiz stands in for both the
   * question and the rating: the reader draws, and the mistakes decide what
   * FSRS hears. The definition is only fetched once the drawing is done —
   * showing it beforehand would answer a different card's question.
   */
  private startWriting(card: ReviewCard): void {
    const pane = renderWritingFront(this.document, card);
    if (!pane) return;

    const quiz = startQuiz(pane, card.word);
    this.quiz = quiz;

    void quiz.completed.then(mistakes => {
      if (this.quiz !== quiz || !this.isCurrent(card)) return;

      const rating = ratingForMistakes(mistakes);
      this.pendingRating = rating;
      renderBackLoading(this.document);

      this.withDefinition(card, definition => {
        renderWritingBack(this.document, card, definition, { mistakes, rating }, this.settings);
      });
    });
  }

  /** Stop a quiz whose card is no longer on screen. */
  private endQuiz(): void {
    this.quiz?.cancel();
    this.quiz = undefined;
    this.pendingRating = undefined;
  }

  /** Fetch the word's definition, or hand back the copy this session already has. */
  private withDefinition(
    card: ReviewCard,
    render: (definition: DefinitionResult | undefined) => void,
  ): void {
    const cached = this.definitions.get(card.word);
    if (cached) {
      render(cached);
      return;
    }

    void this.client.lookupWord(card.word).then(
      definition => {
        if (!this.isCurrent(card)) return;

        this.definitions.set(card.word, definition);
        render(definition);
      },
      () => {
        if (this.isCurrent(card)) render(undefined);
      },
    );
  }

  /** A lookup that returns after the reader has moved on must not redraw the card. */
  private isCurrent(card: ReviewCard): boolean {
    return (
      getCurrentWord(this.document) === card.word &&
      getCurrentDirection(this.document) === card.direction
    );
  }

  private setupShowAnswerButton(): void {
    const btn = this.document.getElementById(ELEMENT_IDS.showAnswerBtn);
    if (!btn) return;

    btn.addEventListener('click', () => this.showAnswer());
  }

  private showAnswer(): void {
    const card = this.currentCard();
    if (!card) return;

    renderBackLoading(this.document);

    const listening = card.direction === 'listening';
    const heard = listening && this.listening ? { heard: this.listening } : {};

    this.withDefinition(card, definition => {
      if (definition) renderBack(this.document, card, definition, { ...heard, display: this.settings });
      else renderBackError(this.document, listening ? card.word : undefined);
      this.priceRatings(card);
    });
  }

  /** Write on each rating button when it would bring this card back. */
  private priceRatings(card: ReviewCard): void {
    const now = Date.now();
    const stat = this.statistics[card.word];
    const progress = stat ? progressFor(stat, card.direction) : undefined;

    renderRatingIntervals(this.document, previewSchedule(progress, new Date(now)), now);
  }

  /** The card on screen, rebuilt from the session so its context travels with it. */
  private currentCard(): ReviewCard | undefined {
    const word = getCurrentWord(this.document);
    const direction = getCurrentDirection(this.document);
    if (!word || !direction) return undefined;

    return this.sessionCards.find(card => card.word === word && card.direction === direction);
  }

  private setupWritingNextButton(): void {
    const btn = this.document.getElementById(ELEMENT_IDS.writingNextBtn);
    if (!btn) return;

    btn.addEventListener('click', () => this.advanceWriting());
  }

  /** Submit the grade the quiz measured. The reader has no say in it. */
  private advanceWriting(): void {
    const rating = this.pendingRating;
    if (!rating) return;

    this.rate(rating);
  }

  private setupRatingButtons(): void {
    const ratingBtns = this.document.getElementById(ELEMENT_IDS.ratingBtns);
    if (!ratingBtns) return;

    ratingBtns.addEventListener('click', (e: Event) => {
      if (!(e.target instanceof HTMLElement)) return;
      const rating = e.target.closest<HTMLElement>('[data-rating]')?.dataset.rating as
        | FlashcardRating
        | undefined;
      if (!rating) return;
      this.rate(rating);
    });
  }

  private setupKeyboardShortcuts(): void {
    this.document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (this.handleKey(e.key)) e.preventDefault();
    });
  }

  /** Returns true when the key was consumed by a shortcut. */
  private handleKey(key: string): boolean {
    if (isScreenVisible(this.document, SCREEN_IDS.finished)) {
      if (!ADVANCE_KEYS.includes(key)) return false;
      this.restartSession();
      return true;
    }

    if (!isScreenVisible(this.document, SCREEN_IDS.review)) return false;

    if (key === 'k' || key === 'K') {
      this.retireCurrentWord();
      return true;
    }

    // Replaying is offered on both faces: the answer is easier to learn from
    // with the sound heard against the word it turned out to be.
    if ((key === 'r' || key === 'R') && getCurrentDirection(this.document) === 'listening') {
      this.replay();
      return true;
    }

    // A finished writing quiz has already been graded, so the only key it
    // takes is the one that moves on.
    if (isWritingAnswerVisible(this.document)) {
      if (!ADVANCE_KEYS.includes(key)) return false;
      this.advanceWriting();
      return true;
    }

    if (isAnswerVisible(this.document)) {
      const rating = RATING_KEYS[key] ?? (ADVANCE_KEYS.includes(key) ? DEFAULT_RATING : undefined);
      if (!rating) return false;
      this.rate(rating);
      return true;
    }

    if (!isAnswerRevealable(this.document) || !ADVANCE_KEYS.includes(key)) return false;
    this.showAnswer();
    return true;
  }

  private rate(rating: FlashcardRating): void {
    const card = this.currentCard();
    if (!card) return;

    // Answering another card is moving on; the offer to undo goes with it.
    this.dismissRetired();

    if (rating === 'again' || rating === 'hard') {
      this.reviewQueue.push(card);
    } else {
      this.correctCount++;
    }

    const key = cardKey(card);
    if (!this.scheduled.has(key)) {
      this.scheduled.add(key);
      void this.client.updateFlashcard(card.word, rating, card.direction).catch(() => {});
    }

    this.showNextCard();
  }

  private setupKnowButton(): void {
    const btn = this.document.getElementById(ELEMENT_IDS.knowBtn);
    if (!btn) return;

    btn.addEventListener('click', () => this.retireCurrentWord());
  }

  /**
   * Retire the word on screen. The commonest words are the ones hovered most,
   * so without this the deck fills with 的 and 是 and keeps asking about them;
   * a reader who already knows a word should be able to say so once.
   */
  private dismissRetired(): void {
    if (!this.retired) return;
    this.retired = undefined;
    hideRetiredNotice(this.document);
  }

  private retireCurrentWord(): void {
    const card = this.currentCard();
    if (!card) return;

    this.dismissRetired();
    void this.client.setWordStatus(card.word, { suppressed: true }).catch(() => {});

    // Its other cards are owed no answer either, and a retired word must not
    // come back through the restart the finished screen offers.
    this.retired = {
      word: card.word,
      queued: this.reviewQueue.filter(queued => queued.word === card.word),
      session: this.sessionCards.filter(queued => queued.word === card.word),
      totalCount: this.totalCount,
      card,
    };
    this.reviewQueue = this.reviewQueue.filter(queued => queued.word !== card.word);
    this.sessionCards = this.sessionCards.filter(queued => queued.word !== card.word);
    this.totalCount = Math.max(this.totalCount - 1, this.correctCount);

    showRetiredNotice(this.document, card.word);
    this.showNextCard();
  }

  private setupUndoRetireButton(): void {
    const btn = this.document.getElementById(ELEMENT_IDS.undoRetireBtn);
    if (!btn) return;

    btn.addEventListener('click', () => this.undoRetire());
  }

  /**
   * Put back the word the last press buried. Retiring is one keystroke and
   * takes every card the word owns with it, which is a lot to lose to a
   * mistyped rating.
   */
  private undoRetire(): void {
    const retired = this.retired;
    if (!retired) return;

    this.retired = undefined;
    hideRetiredNotice(this.document);
    void this.client.setWordStatus(retired.word, { suppressed: false }).catch(() => {});

    // Retiring moved the session on, so whatever it moved on to is owed its
    // turn back once the retired card has had the one it lost.
    const displaced = isScreenVisible(this.document, SCREEN_IDS.review)
      ? this.currentCard()
      : undefined;

    this.sessionCards = [...this.sessionCards, ...retired.session];
    this.totalCount = retired.totalCount;
    this.reviewQueue = [
      retired.card,
      ...retired.queued.filter(queued => queued !== retired.card),
      ...(displaced ? [displaced] : []),
      ...this.reviewQueue,
    ];

    setScreen(this.document, SCREEN_IDS.review);
    this.showNextCard();
  }

  /**
   * The deck opens in a tab of its own, so without these the only way on from
   * a finished or empty session is to close it.
   */
  private setupStatsLinks(): void {
    this.document.querySelectorAll(STATS_LINK_SELECTOR).forEach(link => {
      link.addEventListener('click', () => {
        this.document.location.href = chrome.runtime.getURL(STATS_PAGE);
      });
    });
  }

  private setupReviewAgainButton(): void {
    const btn = this.document.getElementById(ELEMENT_IDS.reviewAgainBtn);
    if (!btn) return;

    btn.addEventListener('click', () => this.restartSession());
  }

  private restartSession(): void {
    this.reviewQueue = fisherYatesShuffle(this.sessionCards);
    this.correctCount = 0;
    this.totalCount = this.sessionCards.length;
    setScreen(this.document, SCREEN_IDS.review);
    this.showNextCard();
  }
}

const flashcardManager = new FlashcardManager(document, flashcardClient);

// The session is sized by the settings, so it is not built until they are read.
const settingsRead = new Promise<void>(resolve => {
  watchSettings(settings => {
    flashcardManager.applySettings(settings);
    resolve();
  });
});

const start = (): void => void settingsRead.then(() => flashcardManager.init());

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
