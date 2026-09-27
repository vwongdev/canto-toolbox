import {
  findConfusables,
  lookupWordAt,
  lookupWordInDictionaries,
  initDictionaries,
  segmentRun,
} from './dictionary.js';
import { registerHandlers } from '../shared/message-router.js';

/**
 * Dictionary lookups run here, in the offscreen document, so the parsed maps
 * survive the service worker being torn down on idle. The worker's
 * `lookup_word` / `track_word` handlers only forward.
 */
export function register(): void {
  const dictionariesReady = initDictionaries();

  async function ready(): Promise<void> {
    try {
      await dictionariesReady;
    } catch (error) {
      console.error('[Offscreen] Dictionary init failed:', error);
      throw new Error('Dictionary failed to load', { cause: error });
    }
  }

  registerHandlers({
    dict_lookup: async (msg) => {
      await ready();

      const definition = msg.allowMissing
        ? lookupWordInDictionaries(msg.word)
        : lookupWordAt(msg.segment?.run ?? msg.word, msg.segment?.offset);

      return { success: true, type: 'dict_lookup', definition };
    },
    /**
     * This document has one thread, and a hover waits behind whatever it is
     * doing. The page sends its text a slice at a time and waits for each
     * reply, so a lookup is never queued behind more than one slice.
     */
    dict_segment: async (msg) => {
      await ready();
      return { success: true, type: 'dict_segment', words: msg.runs.map(segmentRun) };
    },
    dict_confusables: async (msg) => {
      await ready();
      return { success: true, type: 'dict_confusables', confusables: findConfusables(msg.words) };
    },
  });
}
