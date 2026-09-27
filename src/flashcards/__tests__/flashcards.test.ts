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
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings.js';

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
    getStatistics: vi.fn(async () => ({
      你好: { count: 5, firstSeen: 1, lastSeen: 2, context: '你好嗎' },
      再见: { count: 5, firstSeen: 1, lastSeen: 2 }
    })),
    findConfusables: vi.fn(async () => ({})),
    lookupWord: vi.fn(async () => DEFINITION),
    updateFlashcard: vi.fn(async () => {}),
    recordConfusion: vi.fn(async () => {}),
    setWordStatus: vi.fn(async () => {}),
    ...overrides
  };
}

/** Let the client's replies land before the test looks at the page. */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('FlashcardManager keyboard shortcuts', () => {
  let document: Document;
  let client: FlashcardClient;

  async function start(overrides: Partial<FlashcardClient> = {}): Promise<void> {
    client = createClient(overrides);
    new FlashcardManager(document, client).init();
    await flush();
  }

  async function press(key: string, init: KeyboardEventInit = {}): Promise<void> {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
    await flush();
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

  it('reveals the answer on Space', async () => {
    await start();
    const word = currentWord();

    await press(' ');

    expect(client.lookupWord).toHaveBeenCalledWith(word);
    expect(isVisible('rating-btns')).toBe(true);
  });

  it('ignores a second reveal while the lookup is in flight', async () => {
    await start({ lookupWord: vi.fn(() => new Promise<never>(() => {})) });

    await press(' ');
    await press(' ');

    expect(client.lookupWord).toHaveBeenCalledTimes(1);
  });

  it('rates with the number keys once the answer is visible', async () => {
    await start();
    const word = currentWord();

    await press(' ');
    await press('4');

    expect(client.updateFlashcard).toHaveBeenCalledWith(
      word,
      'easy',
      'recognition',
    );
  });

  it('rates Good on Space once the answer is visible', async () => {
    await start();
    const word = currentWord();

    await press(' ');
    await press(' ');

    expect(client.updateFlashcard).toHaveBeenCalledWith(
      word,
      'good',
      'recognition',
    );
  });

  // Four buttons asking the reader to grade themselves mean nothing until they
  // say what each one costs.
  it('writes on each rating button when it would bring the card back', async () => {
    await start();
    await press(' ');

    const intervals = Array.from(
      document.getElementById('rating-btns')!.querySelectorAll('.btn-interval'),
      el => el.textContent ?? ''
    );

    expect(intervals).toHaveLength(4);
    expect(intervals.every(text => /^\d+(m|h|d|mo)$/.test(text))).toBe(true);
  });

  it('reprices the buttons rather than stacking a second reading on them', async () => {
    await start();
    await press(' ');
    await press('3');
    await press(' ');

    expect(
      document.getElementById('rating-btns')!.querySelectorAll('.btn-interval')
    ).toHaveLength(4);
  });

  it('does not rate before the answer is revealed', async () => {
    await start();

    await press('3');

    expect(client.updateFlashcard).not.toHaveBeenCalled();
  });

  it('ignores shortcuts when a modifier is held', async () => {
    await start();

    await press(' ', { metaKey: true });

    expect(client.lookupWord).not.toHaveBeenCalled();
  });

  it('requeues a card rated Again with the 1 key', async () => {
    await start();
    const first = currentWord();

    await press(' ');
    await press('1');
    expect(currentWord()).not.toBe(first);

    await press(' ');
    await press('3');
    expect(isVisible('review')).toBe(true);
    expect(currentWord()).toBe(first);

    await press(' ');
    await press('3');
    expect(isVisible('finished')).toBe(true);
    expect(document.getElementById('result-summary')!.textContent).toBe('2 / 2 correct');
  });

  it('shows the sentence the word was met in on the answer', async () => {
    await start();
    await press(' ');

    const context = document.getElementById('card-back')!.querySelector('.context');
    expect(context?.querySelector('.context-sentence')?.textContent).toBe('你好嗎');
  });

  it('links the sentence on the answer to the page it was read on', async () => {
    await start({
      getStatistics: vi.fn(async () => ({
        你好: {
          count: 5, firstSeen: 1, lastSeen: 2,
          contexts: [{ text: '你好嗎', source: { url: 'https://example.com/chat', title: '傾偈' }, seen: 1 }],
        },
      })),
    });
    await press(' ');

    const link = document.getElementById('card-back')!.querySelector<HTMLAnchorElement>('.context-source');
    expect(link?.getAttribute('href')).toBe('https://example.com/chat');
    expect(link?.textContent).toBe('傾偈');
  });

  it('places the sentence above the character breakdown', async () => {
    await start({
      lookupWord: vi.fn(async () => ({
        ...DEFINITION,
        etymology: [{ character: '你', definition: 'you', decomposition: '⿰亻尔', radical: '亻' }],
      })),
    });
    await press(' ');

    const order = Array.from(
      document.getElementById('card-back')!.querySelector('.definition-container')!.children,
      child => child.className,
    );

    expect(order.indexOf('context')).toBeLessThan(
      order.findIndex(name => name.includes('popup-etymology-section')),
    );
  });

  it('omits the sentence for a word that has none', async () => {
    await start();
    await press(' ');
    await press('3');
    await press(' ');

    expect(document.getElementById('card-back')!.querySelector('.context')).toBeNull();
  });

  it('sends a requeued card to the scheduler only on its first answer', async () => {
    await start();
    const first = currentWord();

    await press(' ');
    await press('1');
    await press(' ');
    await press('3');

    const rated = (client.updateFlashcard as ReturnType<typeof vi.fn>).mock.calls
      .filter(call => call[0] === first);
    expect(rated).toHaveLength(1);
    expect(rated[0]![1]).toBe('again');
  });

  it('does not re-rate the same cards when the session is restarted', async () => {
    await start();
    for (let i = 0; i < 2; i++) {
      await press(' ');
      await press('3');
    }
    expect(client.updateFlashcard).toHaveBeenCalledTimes(2);

    await press('Enter');
    for (let i = 0; i < 2; i++) {
      await press(' ');
      await press('3');
    }

    expect(client.updateFlashcard).toHaveBeenCalledTimes(2);
  });

  it('restarts the session on Enter from the finished screen', async () => {
    await start();
    for (let i = 0; i < 2; i++) {
      await press(' ');
      await press('3');
    }
    expect(isVisible('finished')).toBe(true);

    await press('Enter');

    expect(isVisible('review')).toBe(true);
    expect(document.getElementById('counter')!.textContent).toBe('Card 1 of 2');
  });
});

describe('FlashcardManager retiring a word', () => {
  let document: Document;
  let client: FlashcardClient;

  async function press(key: string): Promise<void> {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    await flush();
  }

  beforeEach(async () => {
    document = new DOMParser().parseFromString(HTML, 'text/html');
    client = createClient();
    new FlashcardManager(document, client).init();
    await flush();
  });

  it('retires the word on screen and moves on', async () => {
    const first = document.getElementById('card')!.dataset.currentWord;

    await press('k');

    expect(client.setWordStatus).toHaveBeenCalledWith(
      first,
      { suppressed: true });
    expect(document.getElementById('card')!.dataset.currentWord).not.toBe(first);
  });

  it('shrinks the session rather than leaving a card unanswered', async () => {
    await press('k');
    expect(document.getElementById('counter')!.textContent).toBe('Card 1 of 1');
  });

  it('does not bring a retired word back when the session restarts', async () => {
    const first = document.getElementById('card')!.dataset.currentWord;
    await press('k');
    await press(' ');
    await press('3');

    expect(document.getElementById('finished')!.style.display).not.toBe('none');
    await press('Enter');

    expect(document.getElementById('card')!.dataset.currentWord).not.toBe(first);
  });

  it('does not send the retired card to the scheduler', async () => {
    await press('k');
    expect(client.updateFlashcard).not.toHaveBeenCalled();
  });
});

describe('FlashcardManager undoing a retirement', () => {
  let document: Document;
  let client: FlashcardClient;

  async function start(): Promise<void> {
    client = createClient();
    new FlashcardManager(document, client).init();
    await flush();
  }

  async function retire(): Promise<void> {
    document.getElementById('know-btn')!.dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
  }

  async function undo(): Promise<void> {
    document.getElementById('undo-retire-btn')!.dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
  }

  function isVisible(id: string): boolean {
    return document.getElementById(id)!.style.display !== 'none';
  }

  beforeEach(() => {
    document = new DOMParser().parseFromString(HTML, 'text/html');
  });

  // One keystroke buries every card the word owns, which is a lot to lose to a
  // mistyped rating.
  it('says which word was retired', async () => {
    await start();
    const word = document.getElementById('card')!.dataset.currentWord;

    await retire();

    expect(isVisible('retired-notice')).toBe(true);
    expect(document.getElementById('retired-message')!.textContent).toBe(`Retired ${word}.`);
  });

  it('puts the word back, on screen and in the record', async () => {
    await start();
    const word = document.getElementById('card')!.dataset.currentWord;

    await retire();
    await undo();

    expect(client.setWordStatus).toHaveBeenLastCalledWith(
      word,
      { suppressed: false });
    expect(document.getElementById('card')!.dataset.currentWord).toBe(word);
    expect(document.getElementById('counter')!.textContent).toBe('Card 1 of 2');
    expect(isVisible('retired-notice')).toBe(false);
  });

  // Retiring the last card ends the session; undoing has to bring the review
  // screen back rather than leaving the word restored behind a finished one.
  it('returns to the review from a session the retirement finished', async () => {
    await start();
    document.getElementById('show-answer-btn')!.dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
    await flush();
    const last = document.getElementById('card')!.dataset.currentWord;

    await retire();
    expect(isVisible('finished')).toBe(true);

    await undo();

    expect(isVisible('review')).toBe(true);
    expect(document.getElementById('card')!.dataset.currentWord).toBe(last);
  });

  it('takes the offer away once another card is answered', async () => {
    await start();
    await retire();

    document.getElementById('show-answer-btn')!.dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
    await flush();

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

  async function start(): Promise<void> {
    client = createClient({
      getStatistics: vi.fn(async () => GRADUATED),
    });
    new FlashcardManager(document, client).init();
    await flush();
  }

  beforeEach(() => {
    document = new DOMParser().parseFromString(HTML, 'text/html');
  });

  it('asks for the word from its meaning', async () => {
    await start();
    const front = document.getElementById('card-front')!;

    expect(document.getElementById('card')!.dataset.currentDirection).toBe('production');
    expect(front.querySelector('.card-gloss')?.textContent).toBe('hello');
  });

  it('keeps the word itself off the production front', async () => {
    await start();
    expect(document.getElementById('card-front')!.textContent).not.toContain('你好');
  });

  it('prompts with the context sentence blanked out', async () => {
    await start();
    const blank = document.getElementById('card-front')!.querySelector('.context-blank');

    expect(blank?.textContent).toHaveLength(2);
  });

  // A page title can name the very word the reader is asked for.
  it('keeps the source page off the production front', async () => {
    const statistics: Statistics = {
      你好: {
        ...GRADUATED['你好']!,
        contexts: [{ text: '你好嗎', source: { url: 'https://example.com/', title: '你好' }, seen: 1 }],
      },
    };
    client = createClient({
      getStatistics: vi.fn(async () => statistics),
    });
    new FlashcardManager(document, client).init();
    await flush();

    expect(document.getElementById('card-front')!.querySelector('.context-blank')).not.toBeNull();
    expect(document.getElementById('card-front')!.querySelector('.context-source')).toBeNull();
  });

  it('reveals the word on the answer', async () => {
    await start();
    document.getElementById('show-answer-btn')!.dispatchEvent(new Event('click', { bubbles: true }));
    await flush();

    const back = document.getElementById('card-back')!;
    expect(back.querySelector('.definition-word')?.textContent).toBe('你好');
  });

  it('rates the production card rather than the recognition one', async () => {
    await start();
    document.getElementById('show-answer-btn')!.dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
    await flush();

    expect(client.updateFlashcard).toHaveBeenCalledWith(
      '你好',
      'good',
      'production',
    );
  });

  it('looks the word up once for both the question and the answer', async () => {
    await start();
    document.getElementById('show-answer-btn')!.dispatchEvent(new Event('click', { bubbles: true }));
    await flush();

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

  async function start(): Promise<void> {
    client = createClient({
      getStatistics: vi.fn(async () => READY),
      lookupWord: vi.fn(async () => HAO),
    });
    new FlashcardManager(document, client).init();
    await flush();
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

  it('quizzes the character it is asking about', async () => {
    await start();

    expect(document.getElementById('card')!.dataset.currentDirection).toBe('writing');
    expect(writer.quizzes).toHaveLength(1);
    expect(writer.quizzes[0]!.character).toBe('好');
  });

  it('offers nothing to reveal while the quiz is unanswered', async () => {
    await start();

    // The quiz is the question and ends itself, so there is no Show Answer.
    expect(document.getElementById('show-answer-btn-container')!.style.display).toBe('none');
    expect(document.getElementById('writing-next')!.style.display).toBe('none');
  });

  it('does not ask the reader to rate a quiz it already graded', async () => {
    await start();
    await finishQuiz(0);

    expect(document.getElementById('rating-btns')!.style.display).toBe('none');
  });

  it('shows what the quiz measured alongside the definition', async () => {
    await start();
    await finishQuiz(2);

    const back = document.getElementById('card-back')!;
    expect(back.querySelector('.card-tally')?.textContent).toBe('2 mistakes · Hard');
    expect(back.querySelector('.definition-word')?.textContent).toBe('好');
  });

  it('rates a clean quiz Good', async () => {
    await start();
    await finishQuiz(0);
    document.getElementById('writing-next-btn')!.dispatchEvent(new Event('click', { bubbles: true }));
    await flush();

    expect(client.updateFlashcard).toHaveBeenCalledWith(
      '好',
      'good',
      'writing',
    );
  });

  it('rates a quiz with two mistakes Hard', async () => {
    await start();
    await finishQuiz(2);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    await flush();

    expect(client.updateFlashcard).toHaveBeenCalledWith(
      '好',
      'hard',
      'writing',
    );
  });

  it('ignores the rating keys the other cards use', async () => {
    await start();
    await finishQuiz(0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '4', bubbles: true }));
    await flush();

    expect(client.updateFlashcard).not.toHaveBeenCalled();
  });

  it('abandons the quiz when the word is retired', async () => {
    await start();
    const quiz = writer.quizzes[0]!;

    document.getElementById('know-btn')!.dispatchEvent(new Event('click', { bubbles: true }));
    await flush();

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

  async function start(): Promise<void> {
    const client = createClient({
      getStatistics: vi.fn(async () => READY),
      lookupWord: vi.fn(async () => DECOMPOSED),
    });
    new FlashcardManager(document, client).init();
    await flush();
  }

  beforeEach(() => {
    document = new DOMParser().parseFromString(HTML, 'text/html');
  });

  // Every other surface keeps the breakdown closed, but here it is the answer
  // the card asked for, so it has to be on screen without a second click.
  it('opens the breakdown on the answer', async () => {
    await start();
    expect(document.getElementById('card')!.dataset.currentDirection).toBe('components');

    document.getElementById('show-answer-btn')!.dispatchEvent(new Event('click', { bubbles: true }));
    await flush();

    const section = document.getElementById('card-back')!.querySelector('.popup-etymology-section');
    expect(section?.classList.contains('is-collapsed')).toBe(false);
    expect(section?.querySelectorAll('.popup-etymology-component-glyph')).toHaveLength(2);
  });
});

describe('FlashcardManager contrast cards', () => {
  let document: Document;
  let client: FlashcardClient;

  const GRADUATED = {
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

  /** 清 has passed recognition and production, so telling it apart is next. */
  const READY: Statistics = {
    清: { count: 5, firstSeen: 1, lastSeen: 2, flashcard: GRADUATED, production: GRADUATED },
    晴: { count: 5, firstSeen: 1, lastSeen: 2, suppressed: true },
    情: { count: 5, firstSeen: 1, lastSeen: 2, suppressed: true },
  };

  const definitionOf = (word: string): DefinitionResult => ({
    word,
    mandarin: { entries: [{ traditional: word, simplified: word, romanisation: 'qing2', definitions: [`meaning of ${word}`] }] },
    cantonese: { entries: [] },
  });

  async function start(statistics: Statistics = READY): Promise<void> {
    client = createClient({
      getStatistics: vi.fn(async () => statistics),
      findConfusables: vi.fn(async () => ({ 清: ['晴', '情'] })),
      lookupWord: vi.fn(async (word: string) => definitionOf(word)),
    });
    new FlashcardManager(document, client).init();
    await flush();
  }

  function options(): string[] {
    return Array.from(document.querySelectorAll<HTMLElement>('.card-option')).map(o => o.dataset.option!);
  }

  async function pick(word: string): Promise<void> {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: String(options().indexOf(word) + 1), bubbles: true }));
    await vi.waitFor(() => expect(document.getElementById('writing-next')!.style.display).not.toBe('none'));
  }

  async function next(): Promise<void> {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    await flush();
  }

  beforeEach(() => {
    document = new DOMParser().parseFromString(HTML, 'text/html');
  });

  // The partners are retired, which keeps them out of the session; they must
  // then count as known, not as options.
  it('offers nothing to contrast with once every lookalike is retired', async () => {
    await start();
    expect(document.getElementById('card')!.dataset.currentDirection).not.toBe('contrast');
  });

  describe('with lookalikes in the deck', () => {
    const DECK: Statistics = {
      ...READY,
      晴: { count: 1, firstSeen: 1, lastSeen: 2 },
      情: { count: 1, firstSeen: 1, lastSeen: 2 },
    };

    it('asks for the word among the ones it looks like', async () => {
      await start(DECK);

      expect(document.getElementById('card')!.dataset.currentDirection).toBe('contrast');
      expect(options().sort()).toEqual(['情', '晴', '清'].sort());
      expect(document.getElementById('card-front')!.textContent).toContain('meaning of 清');
    });

    it('grades the right pick Good and records no mix-up', async () => {
      await start(DECK);
      await pick('清');
      await next();

      expect(client.updateFlashcard).toHaveBeenCalledWith('清', 'good', 'contrast');
      expect(client.recordConfusion).not.toHaveBeenCalled();
    });

    it('grades a wrong pick Again, records it and shows both words', async () => {
      await start(DECK);
      await pick('晴');

      const back = document.getElementById('card-back')!;
      expect(back.querySelector('.card-tally')?.textContent).toBe('Not 晴 · Again');
      expect(back.textContent).toContain('meaning of 清');
      expect(back.textContent).toContain('meaning of 晴');
      expect(client.recordConfusion).toHaveBeenCalledWith('清', '晴');

      await next();
      expect(client.updateFlashcard).toHaveBeenCalledWith('清', 'again', 'contrast');
    });
  });
});

describe('FlashcardManager mix-ups on the answer', () => {
  let document: Document;

  beforeEach(() => {
    document = new DOMParser().parseFromString(HTML, 'text/html');
  });

  it('records the word it was taken for and rates the card Again', async () => {
    const client = createClient({ findConfusables: vi.fn(async () => ({ 你好: ['再见'], 再见: ['你好'] })) });
    new FlashcardManager(document, client).init();
    await flush();

    const word = document.getElementById('card')!.dataset.currentWord!;
    const other = word === '你好' ? '再见' : '你好';
    document.getElementById('show-answer-btn')!.dispatchEvent(new Event('click', { bubbles: true }));
    await flush();

    const chip = document.querySelector<HTMLButtonElement>('.card-mixup')!;
    expect(chip.textContent).toBe(other);
    chip.click();
    await flush();

    expect(client.recordConfusion).toHaveBeenCalledWith(word, other);
    expect(client.updateFlashcard).toHaveBeenCalledWith(word, 'again', 'recognition');
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

  async function start(): Promise<void> {
    client = createClient({
      getStatistics: vi.fn(async () => READY),
    });
    new FlashcardManager(document, client).init();
    await flush();
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

  it('plays the word in Cantonese as the card appears', async () => {
    stubVoices(['zh-CN', 'zh-HK']);
    await start();

    expect(direction()).toBe('listening');
    expect(spoken()).toEqual([expect.objectContaining({ text: '你好', lang: 'zh-HK' })]);
  });

  it('keeps the word itself off the listening front', async () => {
    stubVoices(['zh-HK']);
    await start();

    expect(document.getElementById('card-front')!.textContent).not.toContain('你好');
  });

  it('plays it again on R', async () => {
    stubVoices(['zh-HK']);
    await start();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
    await flush();

    expect(spoken()).toHaveLength(2);
  });

  it('reveals the word and says which reading was played', async () => {
    stubVoices(['zh-CN']);
    await start();

    document.getElementById('show-answer-btn')!.dispatchEvent(new Event('click', { bubbles: true }));
    await flush();

    const back = document.getElementById('card-back')!;
    expect(back.querySelector('.definition-word')?.textContent).toBe('你好');
    expect(back.querySelector('.card-heard')?.textContent).toBe('Heard in Mandarin');
  });

  it('rates the listening card rather than the recognition one', async () => {
    stubVoices(['zh-HK']);
    await start();

    document.getElementById('show-answer-btn')!.dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
    await flush();

    expect(client.updateFlashcard).toHaveBeenCalledWith('你好', 'good', 'listening');
  });

  it('offers no listening card without a Chinese voice', async () => {
    stubVoices(['en-US']);
    await start();

    expect(direction()).toBeUndefined();
    expect(document.getElementById('empty-state')!.style.display).not.toBe('none');
  });

  it('builds the session once voices that were still loading arrive', async () => {
    const voices = stubVoices(['zh-HK'], { loadLater: true });
    await start();
    expect(direction()).toBeUndefined();

    voices.load();

    expect(direction()).toBe('listening');
  });
});

describe('FlashcardManager with the reader\'s settings', () => {
  let document: Document;

  async function start(settings: Partial<Settings>): Promise<void> {
    const manager = new FlashcardManager(document, createClient());
    manager.applySettings({ ...DEFAULT_SETTINGS, ...settings });
    manager.init();
    await flush();
  }

  beforeEach(() => {
    document = new DOMParser().parseFromString(HTML, 'text/html');
  });

  it('sizes the session by the reader\'s new-card limit', async () => {
    await start({ maxNewCards: 1 });
    expect(document.getElementById('counter')!.textContent).toBe('Card 1 of 1');
  });

  it('enrols words at the reader\'s threshold', async () => {
    await start({ minCount: 6 });
    expect(document.getElementById('empty-state')!.style.display).toBe('');
  });

  it('withholds the reading on the answer when the reader hides it', async () => {
    await start({ hideRomanisation: true });

    document.getElementById('show-answer-btn')!.dispatchEvent(new Event('click', { bubbles: true }));
    await flush();

    const back = document.getElementById('card-back')!;
    expect(back.querySelector('.definition-pinyin')).toBeNull();
    expect(back.querySelectorAll('.romanisation-reveal')).toHaveLength(2);
  });
});
