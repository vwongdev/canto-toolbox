import { registerHandlers } from '../shared/message-router.js';
import { offscreenRequest } from '../shared/offscreen-document.js';
import { mutateStatistics } from '../shared/statistics-store.js';
import { recordReview } from '../shared/review-log.js';
import { isLeech, reviewCard } from '../shared/scheduler.js';
import { DIRECTION_FIELD, applyWordStatus, progressFor, withConfusion } from '../shared/statistics-utils.js';
import type { FlashcardProgress, WordStatistics } from '../shared/types.js';

/**
 * A word buries itself once one of its cards becomes a leech. Burying is the
 * same state as the reader retiring a word by hand, so the stats page offers
 * one control to undo either: the deck stops spending slots on it, and nothing
 * about its progress is thrown away.
 */
function withLeechBuried(stat: WordStatistics, progress: FlashcardProgress): WordStatistics {
  return isLeech(progress) ? applyWordStatus(stat, { suppressed: true }) : stat;
}

export function register(): void {
  registerHandlers({
    update_flashcard: async (msg) => {
      // A rating that predates the other card directions is a recognition one.
      const direction = msg.direction ?? 'recognition';

      let reviewed = false;

      await mutateStatistics((existing) => {
        const stats = { ...existing };
        const stat = stats[msg.word];
        if (!stat) return stats;

        const progress = reviewCard(progressFor(stat, direction), msg.rating);
        stats[msg.word] = {
          ...withLeechBuried(stat, progress),
          [DIRECTION_FIELD[direction]]: progress,
        };
        reviewed = true;
        return stats;
      });

      // The review itself is already saved, so a log that fails to write costs
      // a square on the calendar rather than the rating the reader just gave.
      if (reviewed) {
        await recordReview().catch((error: unknown) => {
          console.warn('[Flashcards] Failed to log review:', error);
        });
      }
      return { success: true, type: 'update_flashcard' };
    },

    /**
     * A mix-up goes both ways — taking 清 for 晴 says the reader cannot yet
     * tell the two apart — so it is kept on each word the record holds.
     */
    record_confusion: async (msg) => {
      if (msg.word === msg.other) return { success: true, type: 'record_confusion' };

      await mutateStatistics((existing) => {
        const stats = { ...existing };
        for (const [word, other] of [[msg.word, msg.other], [msg.other, msg.word]] as const) {
          const stat = stats[word];
          if (stat) stats[word] = withConfusion(stat, other);
        }
        return stats;
      });
      return { success: true, type: 'record_confusion' };
    },

    find_confusables: async (msg) => {
      const { confusables } = await offscreenRequest({ type: 'dict_confusables', words: msg.words });
      return { success: true, type: 'find_confusables', confusables };
    },

    set_word_status: async (msg) => {
      await mutateStatistics((existing) => {
        const stats = { ...existing };
        const stat = stats[msg.word];
        if (!stat) return stats;

        stats[msg.word] = applyWordStatus(stat, msg);
        return stats;
      });
      return { success: true, type: 'set_word_status' };
    },
  });
}
