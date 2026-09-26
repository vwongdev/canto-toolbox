import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../shared/statistics-store.js', () => ({
  mutateStatistics: vi.fn(),
}));

vi.mock('../../shared/review-log.js', () => ({
  recordReview: vi.fn(async () => {}),
}));

import { register } from '../background-handler.js';
import { mutateStatistics } from '../../shared/statistics-store.js';
import { recordReview } from '../../shared/review-log.js';
import { LEECH_LAPSES } from '../../shared/scheduler.js';
import type { BackgroundMessage, BackgroundResponse, Statistics } from '../../shared/types.js';

type Listener = (
  message: BackgroundMessage,
  sender: unknown,
  sendResponse: (response: BackgroundResponse) => void,
) => boolean;

function registerAndGetListener(): Listener {
  register();
  const calls = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls;
  return calls[calls.length - 1]![0] as unknown as Listener;
}

/** Run a message through the handler and return the record it wrote. */
async function applied(message: BackgroundMessage, existing: Statistics): Promise<Statistics> {
  let written: Statistics = {};
  vi.mocked(mutateStatistics).mockImplementation(async (transform) => {
    written = transform(existing);
  });

  const listener = registerAndGetListener();
  const sendResponse = vi.fn();
  listener(message, {}, sendResponse);
  await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

  return written;
}

const TRACKED: Statistics = { 你好: { count: 5, firstSeen: 1, lastSeen: 2 } };

describe('flashcard background-handler update_flashcard', () => {
  beforeEach(() => {
    vi.mocked(chrome.runtime.onMessage.addListener).mockClear();
    vi.mocked(mutateStatistics).mockReset();
  });

  it('writes a recognition rating to the original flashcard field', async () => {
    const stats = await applied(
      { type: 'update_flashcard', word: '你好', rating: 'good', direction: 'recognition' },
      TRACKED,
    );

    expect(stats['你好']!.flashcard?.reviews).toBe(1);
    expect(stats['你好']!.production).toBeUndefined();
  });

  it('treats a rating with no direction as a recognition one', async () => {
    const stats = await applied({ type: 'update_flashcard', word: '你好', rating: 'good' }, TRACKED);
    expect(stats['你好']!.flashcard?.reviews).toBe(1);
  });

  it('keeps each direction on its own schedule', async () => {
    const stats = await applied(
      { type: 'update_flashcard', word: '你好', rating: 'good', direction: 'production' },
      TRACKED,
    );

    expect(stats['你好']!.production?.reviews).toBe(1);
    expect(stats['你好']!.flashcard).toBeUndefined();
  });

  it('counts correct answers for the accuracy the stats page reports', async () => {
    const stats = await applied({ type: 'update_flashcard', word: '你好', rating: 'again' }, TRACKED);
    expect(stats['你好']!.flashcard?.correct).toBe(0);
  });

  it('buries a card that has lapsed too many times', async () => {
    const leech: Statistics = {
      你好: {
        count: 5,
        firstSeen: 1,
        lastSeen: 2,
        flashcard: {
          reviews: 20,
          consecutiveCorrect: 0,
          srs: {
            due: 0,
            stability: 1,
            difficulty: 9,
            scheduledDays: 1,
            learningSteps: 0,
            lapses: LEECH_LAPSES - 1,
            state: 2,
          },
        },
      },
    };

    const stats = await applied({ type: 'update_flashcard', word: '你好', rating: 'again' }, leech);

    expect(stats['你好']!.flashcard?.srs?.lapses).toBe(LEECH_LAPSES);
    expect(stats['你好']!.suppressed).toBe(true);
  });

  it('leaves a word that still lapses rarely in the deck', async () => {
    const stats = await applied({ type: 'update_flashcard', word: '你好', rating: 'again' }, TRACKED);
    expect(stats['你好']!.suppressed).toBeUndefined();
  });

  it('ignores a rating for a word that is not tracked', async () => {
    const stats = await applied({ type: 'update_flashcard', word: '沒有', rating: 'good' }, TRACKED);
    expect(stats['沒有']).toBeUndefined();
  });
});

describe('flashcard background-handler set_word_status', () => {
  beforeEach(() => {
    vi.mocked(chrome.runtime.onMessage.addListener).mockClear();
    vi.mocked(mutateStatistics).mockReset();
  });

  it('retires a word', async () => {
    const stats = await applied(
      { type: 'set_word_status', word: '你好', suppressed: true },
      TRACKED,
    );
    expect(stats['你好']!.suppressed).toBe(true);
  });

  it('puts a retired word back', async () => {
    const stats = await applied({ type: 'set_word_status', word: '你好', suppressed: false }, {
      你好: { ...TRACKED['你好']!, suppressed: true },
    });
    expect(stats['你好']!.suppressed).toBeUndefined();
  });

  it('takes a word out of retirement when it is chosen', async () => {
    const stats = await applied({ type: 'set_word_status', word: '你好', pinned: true }, {
      你好: { ...TRACKED['你好']!, suppressed: true },
    });

    expect(stats['你好']!.pinned).toBe(true);
    expect(stats['你好']!.suppressed).toBeUndefined();
  });

  it('drops the pin when a chosen word is retired', async () => {
    const stats = await applied({ type: 'set_word_status', word: '你好', suppressed: true }, {
      你好: { ...TRACKED['你好']!, pinned: true },
    });

    expect(stats['你好']!.suppressed).toBe(true);
    expect(stats['你好']!.pinned).toBeUndefined();
  });

  it('keeps the progress a word has made when its status changes', async () => {
    const stats = await applied({ type: 'set_word_status', word: '你好', suppressed: true }, {
      你好: { ...TRACKED['你好']!, flashcard: { reviews: 4, consecutiveCorrect: 2 } },
    });

    expect(stats['你好']!.flashcard?.reviews).toBe(4);
  });
});

describe('flashcard background-handler review log', () => {
  beforeEach(() => {
    vi.mocked(chrome.runtime.onMessage.addListener).mockClear();
    vi.mocked(mutateStatistics).mockReset();
    vi.mocked(recordReview).mockClear();
  });

  it('logs a review against the day it was given', async () => {
    await applied({ type: 'update_flashcard', word: '你好', rating: 'good' }, TRACKED);
    expect(recordReview).toHaveBeenCalledTimes(1);
  });

  it('logs nothing for a word that is not tracked', async () => {
    await applied({ type: 'update_flashcard', word: '沒有', rating: 'good' }, TRACKED);
    expect(recordReview).not.toHaveBeenCalled();
  });

  it('still reports the rating saved when the log cannot be written', async () => {
    vi.mocked(recordReview).mockRejectedValueOnce(new Error('quota'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const listener = registerAndGetListener();
    vi.mocked(mutateStatistics).mockImplementation(async (transform) => {
      transform(TRACKED);
    });
    const sendResponse = vi.fn();
    listener({ type: 'update_flashcard', word: '你好', rating: 'good' }, {}, sendResponse);

    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({ success: true, type: 'update_flashcard' }),
    );
  });
});
