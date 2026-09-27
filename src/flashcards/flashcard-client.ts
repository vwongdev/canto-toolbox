import { request } from '../shared/message-manager.js';
import type {
  Confusables,
  DefinitionResult,
  FlashcardRating,
  ReviewDirection,
  Statistics,
  WordStatus,
} from '../shared/types.js';

export interface FlashcardClient {
  getStatistics(): Promise<Statistics>;
  findConfusables(words: string[]): Promise<Confusables>;
  lookupWord(word: string): Promise<DefinitionResult>;
  updateFlashcard(word: string, rating: FlashcardRating, direction: ReviewDirection): Promise<void>;
  recordConfusion(word: string, other: string): Promise<void>;
  setWordStatus(word: string, status: WordStatus): Promise<void>;
}

export const flashcardClient: FlashcardClient = {
  getStatistics: async () => (await request({ type: 'get_statistics' })).statistics,
  findConfusables: async (words) => (await request({ type: 'find_confusables', words })).confusables,
  lookupWord: async (word) => (await request({ type: 'lookup_word', word })).definition,
  recordConfusion: async (word, other) => {
    await request({ type: 'record_confusion', word, other });
  },
  updateFlashcard: async (word, rating, direction) => {
    await request({ type: 'update_flashcard', word, rating, direction });
  },
  setWordStatus: async (word, status) => {
    await request({ type: 'set_word_status', word, ...status });
  },
};
