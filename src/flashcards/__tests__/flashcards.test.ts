// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';

/**
 * The stroke quiz mounts an SVG and grades pointer paths, neither of which
 * happy-dom does. The fake records what it was asked to quiz and hands the
 * test the completion callback, so these cases are about the card's lifecycle
 * rather than about stroke matching.
 */
const writer = vi.hoisted(() => {
  const quizzes: Array<{
    character: string;
    onComplete: ((summary: { character: string; totalMistakes: number }) => void) | undefined;
    cancelQuiz: () => void;
  }> = [];

  return { quizzes };
});

vi.mock('hanzi-writer', () => ({
  default: {
    create: (_target: HTMLElement, character: string) => {
      const entry = { character, cancelQuiz: vi.fn() };
      const instance = {
        quiz: (options: { onComplete?: (s: { character: string; totalMistakes: number }) => void }) => {
          writer.quizzes.push({ ...entry, onComplete: options.onComplete });
          return Promise.resolve();
        },
        cancelQuiz: entry.cancelQuiz,
      };
      return instance;
    },
  },
}));

import { FlashcardManager } from '../flashcards.js';
import type { FlashcardClient } from '../flashcard-client.js';
import type { DefinitionResult, Statistics } from '../../shared/types.js';

// The real page markup, minus the asset references happy-dom would try to fetch.
const HTML = readFileSync('src/flashcards/flashcards.html', 'utf-8')
  .replace(/<link\b[^>]*>/g, '')
  .replace(/<script\b[\s\S]*?<\/script>/g, '');

const DEFINITION: DefinitionResult = {
  word: '你好',
  mandarin: {
    entries: [
      { traditional: '你好', simplified: '你好', romanisation: 'ni3 hao3', definitions: ['hello'] }
    ]
  },
  cantonese: {
    entries: [
      { traditional: '你好', simplified: '你好', romanisation: 'nei5 hou2', definitions: ['hello'] }
    ]
  }
};

function createClient(overrides: Partial<FlashcardClient> = {}): FlashcardClient {
  return {
    getStatistics: vi.fn(cb =>
      cb({
        success: true,
        type: 'get_statistics',
        statistics: {
          你好: { count: 5, firstSeen: 1, lastSeen: 2, context: '你好嗎' },
          再见: { count: 5, firstSeen: 1, lastSeen: 2 }
        }
      })
    ),
    lookupWord: vi.fn((_word, cb) =>
      cb({ success: true, type: 'lookup_word', definition: DEFINITION })
    ),
    updateFlashcard: vi.fn((_word, _rating, _direction, cb) =>
      cb({ success: true, type: 'update_flashcard' })
    ),
    setWordStatus: vi.fn((_word, _status, cb) => cb({ success: true, type: 'set_word_status' })),
    ...overrides
  };
}

describe('FlashcardManager keyboard shortcuts', () => {
  let document: Document;
  let client: FlashcardClient;

  function start(overrides: Partial<FlashcardClient> = {}): void {
    client = createClient(overrides);
    new FlashcardManager(document, client).init();
  }

  function press(key: string, init: KeyboardEventInit = {}): void {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
  }

  function isVisible(id: string): boolean {
    return document.getElementById(id)!.style.display !== 'none';
  }

  function currentWord(): string | undefined {
    return document.getElementById('card')!.dataset.currentWord;
  }

  beforeEach(() => {
    document = new DOMParser().parseFromString(HTML, 'text/html');
  });

  it('reveals the answer on Space', () => {
    start();
    const word = currentWord();

    press(' ');

    expect(client.lookupWord).toHaveBeenCalledWith(word, expect.any(Function));
    expect(isVisible('rating-btns')).toBe(true);
  });

  it('ignores a second reveal while the lookup is in flight', () => {
    start({ lookupWord: vi.fn() });

    press(' ');
    press(' ');

    expect(client.lookupWord).toHaveBeenCalledTimes(1);
  });

  it('rates with the number keys once the answer is visible', () => {
    start();
    const word = currentWord();

    press(' ');
    press('4');

    expect(client.updateFlashcard).toHaveBeenCalledWith(
      word,
      'easy',
      'recognition',
      expect.any(Function)
    );
  });

  it('rates Good on Space once the answer is visible', () => {
    start();
    const word = currentWord();

    press(' ');
    press(' ');

    expect(client.updateFlashcard).toHaveBeenCalledWith(
      word,
      'good',
      'recognition',
      expect.any(Function)
    );
  });

  // Four buttons asking the reader to grade themselves mean nothing until they
  // say what each one costs.
  it('writes on each rating button when it would bring the card back', () => {
    start();
    press(' ');

    const intervals = Array.from(
      document.getElementById('rating-btns')!.querySelectorAll('.btn-interval'),
      el => el.textContent ?? ''
    );

    expect(intervals).toHaveLength(4);
    expect(intervals.every(text => /^\d+(m|h|d|mo)$/.test(text))).toBe(true);
  });

  it('reprices the buttons rather than stacking a second reading on them', () => {
    start();
    press(' ');
    press('3');
    press(' ');

    expect(
      document.getElementById('rating-btns')!.querySelectorAll('.btn-interval')
    ).toHaveLength(4);
  });

  it('does not rate before the answer is revealed', () => {
    start();

    press('3');

    expect(client.updateFlashcard).not.toHaveBeenCalled();
  });

  it('ignores shortcuts when a modifier is held', () => {
    start();

    press(' ', { metaKey: true });

    expect(client.lookupWord).not.toHaveBeenCalled();
  });

  it('requeues a card rated Again with the 1 key', () => {
    start();
    const first = currentWord();

    press(' ');
    press('1');
    expect(currentWord()).not.toBe(first);

    press(' ');
    press('3');
    expect(isVisible('review')).toBe(true);
    expect(currentWord()).toBe(first);

    press(' ');
    press('3');
    expect(isVisible('finished')).toBe(true);
    expect(document.getElementById('result-summary')!.textContent).toBe('2 / 2 correct');
  });

  it('shows the sentence the word was met in on the answer', () => {
    start();
    press(' ');

    const context = document.getElementById('card-back')!.querySelector('.context');
    expect(context?.querySelector('.context-sentence')?.textContent).toBe('你好嗎');
  });

  it('places the sentence above the character breakdown', () => {
    start({
      lookupWord: vi.fn((_word, cb) =>
        cb({
          success: true,
          type: 'lookup_word',
          definition: {
            ...DEFINITION,
            etymology: [{ character: '你', definition: 'you', decomposition: '⿰亻尔', radical: '亻' }],
          },
        })
      ),
    });
    press(' ');

    const order = Array.from(
      document.getElementById('card-back')!.querySelector('.definition-container')!.children,
      child => child.className,
    );

    expect(order.indexOf('context')).toBeLessThan(
      order.findIndex(name => name.includes('popup-etymology-section')),
    );
  });

  it('omits the sentence for a word that has none', () => {
    start();
    press(' ');
    press('3');
    press(' ');

    expect(document.getElementById('card-back')!.querySelector('.context')).toBeNull();
  });

  it('sends a requeued card to the scheduler only on its first answer', () => {
    start();
    const first = currentWord();

    press(' ');
    press('1');
    press(' ');
    press('3');

    const rated = (client.updateFlashcard as ReturnType<typeof vi.fn>).mock.calls
      .filter(call => call[0] === first);
    expect(rated).toHaveLength(1);
    expect(rated[0]![1]).toBe('again');
  });

  it('does not re-rate the same cards when the session is restarted', () => {
    start();
    for (let i = 0; i < 2; i++) {
      press(' ');
      press('3');
    }
    expect(client.updateFlashcard).toHaveBeenCalledTimes(2);

    press('Enter');
    for (let i = 0; i < 2; i++) {
      press(' ');
      press('3');
    }

    expect(client.updateFlashcard).toHaveBeenCalledTimes(2);
  });

  it('restarts the session on Enter from the finished screen', () => {
    start();
    for (let i = 0; i < 2; i++) {
      press(' ');
      press('3');
    }
    expect(isVisible('finished')).toBe(true);

    press('Enter');

    expect(isVisible('review')).toBe(true);
    expect(document.getElementById('counter')!.textContent).toBe('Card 1 of 2');
  });
});

describe('FlashcardManager retiring a word', () => {
  let document: Document;
  let client: FlashcardClient;

  function press(key: string): void {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  }

  beforeEach(() => {
    document = new DOMParser().parseFromString(HTML, 'text/html');
    client = createClient();
    new FlashcardManager(document, client).init();
  });

  it('retires the word on screen and moves on', () => {
    const first = document.getElementById('card')!.dataset.currentWord;

    press('k');

    expect(client.setWordStatus).toHaveBeenCalledWith(
      first,
      { suppressed: true },
      expect.any(Function)
    );
    expect(document.getElementById('card')!.dataset.currentWord).not.toBe(first);
  });

  it('shrinks the session rather than leaving a card unanswered', () => {
    press('k');
    expect(document.getElementById('counter')!.textContent).toBe('Card 1 of 1');
  });

  it('does not bring a retired word back when the session restarts', () => {
    const first = document.getElementById('card')!.dataset.currentWord;
    press('k');
    press(' ');
    press('3');

    expect(document.getElementById('finished')!.style.display).not.toBe('none');
    press('Enter');

    expect(document.getElementById('card')!.dataset.currentWord).not.toBe(first);
  });

  it('does not send the retired card to the scheduler', () => {
    press('k');
    expect(client.updateFlashcard).not.toHaveBeenCalled();
  });
});

describe('FlashcardManager undoing a retirement', () => {
  let document: Document;
  let client: FlashcardClient;

  function start(): void {
    client = createClient();
    new FlashcardManager(document, client).init();
  }

  function retire(): void {
    document.getElementById('know-btn')!.dispatchEvent(new Event('click', { bubbles: true }));
  }

  function undo(): void {
    document.getElementById('undo-retire-btn')!.dispatchEvent(new Event('click', { bubbles: true }));
  }

  function isVisible(id: string): boolean {
    return document.getElementById(id)!.style.display !== 'none';
  }

  beforeEach(() => {
    document = new DOMParser().parseFromString(HTML, 'text/html');
  });

  // One keystroke buries every card the word owns, which is a lot to lose to a
  // mistyped rating.
  it('says which word was retired', () => {
    start();
    const word = document.getElementById('card')!.dataset.currentWord;

    retire();

    expect(isVisible('retired-notice')).toBe(true);
    expect(document.getElementById('retired-message')!.textContent).toBe(`Retired ${word}.`);
  });

  it('puts the word back, on screen and in the record', () => {
    start();
    const word = document.getElementById('card')!.dataset.currentWord;

    retire();
    undo();

    expect(client.setWordStatus).toHaveBeenLastCalledWith(
      word,
      { suppressed: false },
      expect.any(Function)
    );
    expect(document.getElementById('card')!.dataset.currentWord).toBe(word);
    expect(document.getElementById('counter')!.textContent).toBe('Card 1 of 2');
    expect(isVisible('retired-notice')).toBe(false);
  });

  // Retiring the last card ends the session; undoing has to bring the review
  // screen back rather than leaving the word restored behind a finished one.
  it('returns to the review from a session the retirement finished', () => {
    start();
    document.getElementById('show-answer-btn')!.dispatchEvent(new Event('click', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
    const last = document.getElementById('card')!.dataset.currentWord;

    retire();
    expect(isVisible('finished')).toBe(true);

    undo();

    expect(isVisible('review')).toBe(true);
    expect(document.getElementById('card')!.dataset.currentWord).toBe(last);
  });

  it('takes the offer away once another card is answered', () => {
    start();
    retire();

    document.getElementById('show-answer-btn')!.dispatchEvent(new Event('click', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));

    expect(isVisible('retired-notice')).toBe(false);
  });
});

describe('FlashcardManager production cards', () => {
  let document: Document;
  let client: FlashcardClient;

  /** A word whose recognition card has graduated, so production is what is owed. */
  const GRADUATED: Statistics = {
    你好: {
      count: 5,
      firstSeen: 1,
      lastSeen: 2,
      context: '你好嗎',
      flashcard: {
        reviews: 3,
        consecutiveCorrect: 3,
        lastReviewed: 1,
        srs: {
          due: Date.now() + 86_400_000,
          stability: 10,
          difficulty: 5,
          scheduledDays: 10,
          learningSteps: 0,
          lapses: 0,
          state: 2,
        },
      },
    },
  };

  function start(): void {
    client = createClient({
      getStatistics: vi.fn(cb =>
        cb({ success: true, type: 'get_statistics', statistics: GRADUATED })
      ),
    });
    new FlashcardManager(document, client).init();
  }

  beforeEach(() => {
    document = new DOMParser().parseFromString(HTML, 'text/html');
  });

  it('asks for the word from its meaning', () => {
    start();
    const front = document.getElementById('card-front')!;

    expect(document.getElementById('card')!.dataset.currentDirection).toBe('production');
    expect(front.querySelector('.card-gloss')?.textContent).toBe('hello');
  });

  it('keeps the word itself off the production front', () => {
    start();
    expect(document.getElementById('card-front')!.textContent).not.toContain('你好');
  });

  it('prompts with the context sentence blanked out', () => {
    start();
    const blank = document.getElementById('card-front')!.querySelector('.context-blank');

    expect(blank?.textContent).toHaveLength(2);
  });

  it('reveals the word on the answer', () => {
    start();
    document.getElementById('show-answer-btn')!.dispatchEvent(new Event('click', { bubbles: true }));

    const back = document.getElementById('card-back')!;
    expect(back.querySelector('.definition-word')?.textContent).toBe('你好');
  });

  it('rates the production card rather than the recognition one', () => {
    start();
    document.getElementById('show-answer-btn')!.dispatchEvent(new Event('click', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));

    expect(client.updateFlashcard).toHaveBeenCalledWith(
      '你好',
      'good',
      'production',
      expect.any(Function)
    );
  });

  it('looks the word up once for both the question and the answer', () => {
    start();
    document.getElementById('show-answer-btn')!.dispatchEvent(new Event('click', { bubbles: true }));

    expect(client.lookupWord).toHaveBeenCalledTimes(1);
  });
});

describe('FlashcardManager writing cards', () => {
  let document: Document;
  let client: FlashcardClient;

  function graduated(due: number) {
    return {
      reviews: 3,
      consecutiveCorrect: 3,
      lastReviewed: 1,
      srs: {
        due,
        stability: 10,
        difficulty: 5,
        scheduledDays: 10,
        learningSteps: 0,
        lapses: 0,
        state: 2,
      },
    };
  }

  /**
   * A character whose recognition and production cards are both scheduled
   * ahead, so writing is the only direction left to introduce.
   */
  const READY: Statistics = {
    好: {
      count: 5,
      firstSeen: 1,
      lastSeen: 2,
      writable: true,
      flashcard: graduated(Date.now() + 86_400_000),
      production: graduated(Date.now() + 86_400_000),
    },
  };

  const HAO: DefinitionResult = {
    word: '好',
    mandarin: {
      entries: [
        { traditional: '好', simplified: '好', romanisation: 'hao3', definitions: ['good'] },
      ],
    },
    cantonese: {
      entries: [
        { traditional: '好', simplified: '好', romanisation: 'hou2', definitions: ['good'] },
      ],
    },
  };

  function start(): void {
    client = createClient({
      getStatistics: vi.fn(cb =>
        cb({ success: true, type: 'get_statistics', statistics: READY })
      ),
      lookupWord: vi.fn((_word, cb) =>
        cb({ success: true, type: 'lookup_word', definition: HAO })
      ),
    });
    new FlashcardManager(document, client).init();
  }

  /** Finish the quiz on screen with the given mistake count. */
  async function finishQuiz(mistakes: number): Promise<void> {
    const quiz = writer.quizzes.at(-1)!;
    quiz.onComplete?.({ character: quiz.character, totalMistakes: mistakes });
    await vi.waitFor(() =>
      expect(document.getElementById('writing-next')!.style.display).not.toBe('none')
    );
  }

  beforeEach(() => {
    writer.quizzes.length = 0;
    document = new DOMParser().parseFromString(HTML, 'text/html');
  });

  it('quizzes the character it is asking about', () => {
    start();

    expect(document.getElementById('card')!.dataset.currentDirection).toBe('writing');
    expect(writer.quizzes).toHaveLength(1);
    expect(writer.quizzes[0]!.character).toBe('好');
  });

  it('offers nothing to reveal while the quiz is unanswered', () => {
    start();

    // The quiz is the question and ends itself, so there is no Show Answer.
    expect(document.getElementById('show-answer-btn-container')!.style.display).toBe('none');
    expect(document.getElementById('writing-next')!.style.display).toBe('none');
  });

  it('does not ask the reader to rate a quiz it already graded', async () => {
    start();
    await finishQuiz(0);

    expect(document.getElementById('rating-btns')!.style.display).toBe('none');
  });

  it('shows what the quiz measured alongside the definition', async () => {
    start();
    await finishQuiz(2);

    const back = document.getElementById('card-back')!;
    expect(back.querySelector('.card-tally')?.textContent).toBe('2 mistakes · Hard');
    expect(back.querySelector('.definition-word')?.textContent).toBe('好');
  });

  it('rates a clean quiz Good', async () => {
    start();
    await finishQuiz(0);
    document.getElementById('writing-next-btn')!.dispatchEvent(new Event('click', { bubbles: true }));

    expect(client.updateFlashcard).toHaveBeenCalledWith(
      '好',
      'good',
      'writing',
      expect.any(Function)
    );
  });

  it('rates a quiz with two mistakes Hard', async () => {
    start();
    await finishQuiz(2);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

    expect(client.updateFlashcard).toHaveBeenCalledWith(
      '好',
      'hard',
      'writing',
      expect.any(Function)
    );
  });

  it('ignores the rating keys the other cards use', async () => {
    start();
    await finishQuiz(0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '4', bubbles: true }));

    expect(client.updateFlashcard).not.toHaveBeenCalled();
  });

  it('abandons the quiz when the word is retired', () => {
    start();
    const quiz = writer.quizzes[0]!;

    document.getElementById('know-btn')!.dispatchEvent(new Event('click', { bubbles: true }));

    expect(quiz.cancelQuiz).toHaveBeenCalled();
  });
});

describe('FlashcardManager components cards', () => {
  let document: Document;

  const DECOMPOSED: DefinitionResult = {
    ...DEFINITION,
    word: '好',
    etymology: [{ character: '好', definition: 'good', decomposition: '⿰女子', radical: '女' }],
  };

  function srs(state = 2) {
    return {
      reviews: 3,
      consecutiveCorrect: 3,
      lastReviewed: 1,
      srs: {
        due: Date.now() + 86_400_000,
        stability: 10,
        difficulty: 5,
        scheduledDays: 10,
        learningSteps: 0,
        lapses: 0,
        state,
      },
    };
  }

  /** Recognition and production are both introduced, so components is next. */
  const READY: Statistics = {
    好: {
      count: 5,
      firstSeen: 1,
      lastSeen: 2,
      decomposable: true,
      flashcard: srs(),
      production: srs(),
    },
  };

  function start(): void {
    const client = createClient({
      getStatistics: vi.fn(cb => cb({ success: true, type: 'get_statistics', statistics: READY })),
      lookupWord: vi.fn((_word, cb) =>
        cb({ success: true, type: 'lookup_word', definition: DECOMPOSED })
      ),
    });
    new FlashcardManager(document, client).init();
  }

  beforeEach(() => {
    document = new DOMParser().parseFromString(HTML, 'text/html');
  });

  // Every other surface keeps the breakdown closed, but here it is the answer
  // the card asked for, so it has to be on screen without a second click.
  it('opens the breakdown on the answer', () => {
    start();
    expect(document.getElementById('card')!.dataset.currentDirection).toBe('components');

    document.getElementById('show-answer-btn')!.dispatchEvent(new Event('click', { bubbles: true }));

    const section = document.getElementById('card-back')!.querySelector('.popup-etymology-section');
    expect(section?.classList.contains('is-collapsed')).toBe(false);
    expect(section?.querySelectorAll('.popup-etymology-component-glyph')).toHaveLength(2);
  });
});

describe('FlashcardManager listening cards', () => {
  let document: Document;
  let client: FlashcardClient;
  let speak: ReturnType<typeof vi.fn>;

  function graduated() {
    return {
      reviews: 3,
      consecutiveCorrect: 3,
      lastReviewed: 1,
      srs: {
        due: Date.now() + 86_400_000,
        stability: 10,
        difficulty: 5,
        scheduledDays: 10,
        learningSteps: 0,
        lapses: 0,
        state: 2,
      },
    };
  }

  /** Recognition and production both scheduled ahead, so listening is next. */
  const READY: Statistics = {
    你好: { count: 5, firstSeen: 1, lastSeen: 2, flashcard: graduated(), production: graduated() },
  };

  /** Voices as the browser reports them; with `loadLater`, empty until `load`. */
  function stubVoices(langs: string[], { loadLater = false } = {}) {
    const target = new EventTarget();
    const all = langs.map(lang => ({ lang, name: lang }) as SpeechSynthesisVoice);
    let voices = loadLater ? [] : all;
    speak = vi.fn();

    vi.stubGlobal('speechSynthesis', {
      getVoices: () => voices,
      speak,
      cancel: vi.fn(),
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
    });
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      lang = '';
      voice: SpeechSynthesisVoice | null = null;
      constructor(public text: string) {}
    });

    return {
      load() {
        voices = all;
        target.dispatchEvent(new Event('voiceschanged'));
      },
    };
  }

  function start(): void {
    client = createClient({
      getStatistics: vi.fn(cb => cb({ success: true, type: 'get_statistics', statistics: READY })),
    });
    new FlashcardManager(document, client).init();
  }

  function spoken(): Array<{ text: string; lang: string }> {
    return speak.mock.calls.map(([utterance]) => utterance as { text: string; lang: string });
  }

  function direction(): string | undefined {
    return document.getElementById('card')!.dataset.currentDirection;
  }

  beforeEach(() => {
    document = new DOMParser().parseFromString(HTML, 'text/html');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('plays the word in Cantonese as the card appears', () => {
    stubVoices(['zh-CN', 'zh-HK']);
    start();

    expect(direction()).toBe('listening');
    expect(spoken()).toEqual([expect.objectContaining({ text: '你好', lang: 'zh-HK' })]);
  });

  it('keeps the word itself off the listening front', () => {
    stubVoices(['zh-HK']);
    start();

    expect(document.getElementById('card-front')!.textContent).not.toContain('你好');
  });

  it('plays it again on R', () => {
    stubVoices(['zh-HK']);
    start();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));

    expect(spoken()).toHaveLength(2);
  });

  it('reveals the word and says which reading was played', () => {
    stubVoices(['zh-CN']);
    start();

    document.getElementById('show-answer-btn')!.dispatchEvent(new Event('click', { bubbles: true }));

    const back = document.getElementById('card-back')!;
    expect(back.querySelector('.definition-word')?.textContent).toBe('你好');
    expect(back.querySelector('.card-heard')?.textContent).toBe('Heard in Mandarin');
  });

  it('rates the listening card rather than the recognition one', () => {
    stubVoices(['zh-HK']);
    start();

    document.getElementById('show-answer-btn')!.dispatchEvent(new Event('click', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));

    expect(client.updateFlashcard).toHaveBeenCalledWith('你好', 'good', 'listening', expect.any(Function));
  });

  it('offers no listening card without a Chinese voice', () => {
    stubVoices(['en-US']);
    start();

    expect(direction()).toBeUndefined();
    expect(document.getElementById('empty-state')!.style.display).not.toBe('none');
  });

  it('builds the session once voices that were still loading arrive', () => {
    const voices = stubVoices(['zh-HK'], { loadLater: true });
    start();
    expect(direction()).toBeUndefined();

    voices.load();

    expect(direction()).toBe('listening');
  });
});
