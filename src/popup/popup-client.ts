import { request } from '../shared/message-manager.js';
import type {
  ContextSource,
  DefinitionResult,
  HoverSegment,
  WordStatus,
} from '../shared/types.js';

export interface PopupClient {
  /** The matched word's definition, the reader's decisions about it, and their mix-ups. */
  lookupWord(
    word: string,
    segment?: HoverSegment,
  ): Promise<{ definition: DefinitionResult; status?: WordStatus; confusedWith?: string[] }>;
  trackWord(word: string, context?: string): Promise<void>;
  /** Track the word and add it to the deck outright, skipping the exposure gate. */
  pinWord(word: string, context?: string): Promise<void>;
  /** Retire the word, or put it back, without counting it as a sighting. */
  markKnown(word: string, known: boolean, context?: string): Promise<void>;
}

export const popupClient: PopupClient = {
  lookupWord: async (word, segment) => {
    const { definition, status, confusedWith } = await request({
      type: 'lookup_word',
      word,
      withStatus: true,
      ...(segment && { segment }),
    });
    return { definition, ...(status && { status }), ...(confusedWith && { confusedWith }) };
  },
  trackWord: async (word, context) => {
    await request({ type: 'track_word', word, ...sentence(context) });
  },
  pinWord: async (word, context) => {
    await request({ type: 'track_word', word, pin: true, ...sentence(context) });
  },
  markKnown: async (word, known, context) => {
    await request({ type: 'mark_known', word, known, ...sentence(context) });
  },
};

/**
 * A sentence travels with the page it was read on. The address is sent whole
 * and filtered where it is stored, so what is kept is decided in one place.
 */
function sentence(context: string | undefined): { context?: string; source?: ContextSource } {
  if (!context) return {};
  return { context, source: { url: location.href, title: document.title } };
}
