import { request } from '../shared/message-manager.js';
import type { DefinitionResult, ReviewLog, SearchHit, Statistics, WordStatus } from '../shared/types.js';

export interface StatsClient {
  getStatistics(): Promise<Statistics>;
  getReviewLog(): Promise<ReviewLog>;
  lookupWord(word: string): Promise<DefinitionResult>;
  setWordStatus(word: string, status: WordStatus): Promise<void>;
  searchWords(query: string, seen: string[]): Promise<SearchHit[]>;
  /** Adds a word the record does not hold yet to the deck, as the popup's Study button does. */
  studyWord(word: string): Promise<void>;
}

export const statsClient: StatsClient = {
  getStatistics: async () => (await request({ type: 'get_statistics' })).statistics,
  getReviewLog: async () => (await request({ type: 'get_review_log' })).log,
  lookupWord: async (word) => (await request({ type: 'lookup_word', word })).definition,
  setWordStatus: async (word, status) => {
    await request({ type: 'set_word_status', word, ...status });
  },
  searchWords: async (query, seen) => (await request({ type: 'search_words', query, seen })).hits,
  studyWord: async (word) => {
    await request({ type: 'track_word', word, pin: true });
  },
};
