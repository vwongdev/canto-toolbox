import { sendMessage } from '../shared/message-manager.js';
import type {
  StatisticsResponse,
  LookupResponse,
  ErrorResponse,
  ReviewLogResponse,
  SetWordStatusResponse,
  WordStatus,
} from '../shared/types.js';

export interface StatsClient {
  getStatistics(callback: (r: StatisticsResponse | ErrorResponse) => void): void;
  getReviewLog(callback: (r: ReviewLogResponse | ErrorResponse) => void): void;
  lookupWord(word: string, callback: (r: LookupResponse | ErrorResponse) => void): void;
  setWordStatus(
    word: string,
    status: WordStatus,
    callback: (r: SetWordStatusResponse | ErrorResponse) => void,
  ): void;
}

class StatsMessageClient implements StatsClient {
  getStatistics(callback: (r: StatisticsResponse | ErrorResponse) => void): void {
    sendMessage({ type: 'get_statistics' }, callback);
  }

  getReviewLog(callback: (r: ReviewLogResponse | ErrorResponse) => void): void {
    sendMessage({ type: 'get_review_log' }, callback);
  }

  lookupWord(word: string, callback: (r: LookupResponse | ErrorResponse) => void): void {
    sendMessage({ type: 'lookup_word', word }, callback);
  }

  setWordStatus(
    word: string,
    status: WordStatus,
    callback: (r: SetWordStatusResponse | ErrorResponse) => void,
  ): void {
    sendMessage({ type: 'set_word_status', word, ...status }, callback);
  }
}

export const statsClient = new StatsMessageClient();
