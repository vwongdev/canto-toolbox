import { statsStorage } from './stats-storage.js';
import { registerHandlers } from '../shared/message-router.js';
import { readReviewLog } from '../shared/review-log.js';

export function register(): void {
  registerHandlers({
    get_statistics: async () => {
      const statistics = await statsStorage.getStatistics();
      return { success: true, type: 'get_statistics', statistics };
    },

    get_review_log: async () => {
      const log = await readReviewLog();
      return { success: true, type: 'get_review_log', log };
    },
  });
}
