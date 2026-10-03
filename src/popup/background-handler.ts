import { popupStorage, type WordDetails } from './popup-storage.js';
import { registerHandlers } from '../shared/message-router.js';
import { ensureOffscreenDocument, offscreenRequest } from '../shared/offscreen-document.js';
import { hasStrokes } from '../shared/strokes.js';
import { confusionsOf } from '../shared/statistics-utils.js';
import type { DefinitionResult, HoverSegment, Statistics } from '../shared/types.js';
import { KnownWordsCache, classifyWords } from './known-words.js';

/**
 * Whether the word can carry a components card: one character, and an
 * etymology entry that actually names the parts it is built from.
 */
function isDecomposable(word: string, definition: DefinitionResult): boolean {
  if ([...word].length !== 1) return false;

  const etymology = definition.etymology?.[0];
  if (!etymology) return false;

  return Object.keys(etymology.componentDefinitions ?? {}).length > 0;
}

/**
 * Whether the word can carry a writing card: one character the packaged stroke
 * data covers. Decomposability is not a stand-in — a character can have
 * strokes without its etymology naming any parts it is built from.
 */
function isWritable(word: string): Promise<boolean> {
  if ([...word].length !== 1) return Promise.resolve(false);
  return hasStrokes(word);
}

/**
 * The popup has room for a few lookalikes, and the ones the reader has met
 * are the ones they could have mistaken this word for. The dictionary cannot
 * see the record, so the order is settled here.
 */
function withStudiedLookalikesFirst(definition: DefinitionResult, statistics: Statistics): DefinitionResult {
  if (!definition.etymology?.some(entry => entry.lookalikes)) return definition;

  const studied = (character: string): number => (statistics[character] ? 0 : 1);
  return {
    ...definition,
    etymology: definition.etymology.map(entry =>
      entry.lookalikes
        ? { ...entry, lookalikes: [...entry.lookalikes].sort((a, b) => studied(a.character) - studied(b.character)) }
        : entry,
    ),
  };
}

async function lookupInOffscreen(
  word: string,
  options: { segment?: HoverSegment; allowMissing?: boolean } = {},
): Promise<DefinitionResult> {
  const { definition } = await offscreenRequest({
    type: 'dict_lookup',
    word,
    ...(options.segment && { segment: options.segment }),
    ...(options.allowMissing && { allowMissing: true }),
  });
  return definition;
}

export function register(): void {
  const knownWords = new KnownWordsCache(() => popupStorage.read());

  // Start the host that holds the maps as soon as the worker boots, so a
  // hover shortly after idle is not also paying for document creation.
  void ensureOffscreenDocument();

  /**
   * What the dictionary knows about a word at the moment it is studied. The
   * corpus rank is recorded here rather than looked up when a session is built,
   * because the pages that build sessions have no dictionary of their own.
   */
  async function describe(word: string): Promise<WordDetails> {
    try {
      const definition = await lookupInOffscreen(word, { allowMissing: true });
      const rank = definition.frequency?.rank;

      return {
        ...(rank !== undefined && { rank }),
        // Only a single character has parts worth asking about: the components
        // of a compound word are its own characters, which the card back shows
        // anyway.
        ...(isDecomposable(word, definition) && { decomposable: true }),
        ...((await isWritable(word)) && { writable: true }),
      };
    } catch (error) {
      console.error('[Background] Could not describe tracked word:', error);
      return {};
    }
  }

  registerHandlers({
    /**
     * Showing a definition is not studying it — the popup follows the cursor,
     * so a lookup can be an accident of scrolling past. Statistics are written
     * only once the content script confirms the word was dwelled on.
     */
    lookup_word: async (msg) => {
      // Read alongside the lookup rather than after it, so the popup waits on
      // whichever is slower instead of the two in turn. A record that cannot be
      // read costs the popup its Known state, not its definition.
      const statistics = msg.withStatus
        ? popupStorage.read().catch((error: unknown): Statistics => {
            console.error('[Background] Could not read word status:', error);
            return {};
          })
        : null;

      const definition = await lookupInOffscreen(msg.word, {
        ...(msg.segment && { segment: msg.segment }),
      });

      if (!statistics) return { success: true, type: 'lookup_word', definition };

      const record = await statistics;
      const matched = definition.word || msg.word;
      const status = popupStorage.statusOf(matched, record);
      const confusedWith = confusionsOf(record[matched]);

      return {
        success: true,
        type: 'lookup_word',
        definition: withStudiedLookalikesFirst(definition, record),
        status,
        ...(confusedWith.length > 0 && { confusedWith }),
      };
    },
    track_word: async (msg) => {
      popupStorage.updateStatistics(msg.word, {
        ...(await describe(msg.word)),
        ...(msg.context && { context: msg.context }),
        ...(msg.source && { source: msg.source }),
        ...(msg.pin && { pinned: true }),
      });
      return { success: true, type: 'track_word' };
    },
    /**
     * Knowing a word is not studying it, so this records no sighting. Only a
     * word being retired is described: putting one back needs nothing new
     * recorded about it.
     */
    mark_known: async (msg) => {
      popupStorage.setStatus(msg.word, { suppressed: msg.known }, {
        ...(msg.known && (await describe(msg.word))),
        ...(msg.context && { context: msg.context }),
        ...(msg.source && { source: msg.source }),
      });
      return { success: true, type: 'mark_known' };
    },
    /**
     * The join happens here rather than in the tab: the worker already reads
     * the record for the popup's Known state, and a page is then sent one
     * verdict per word instead of every word the reader has ever met.
     */
    segment_text: async (msg) => {
      const known = knownWords.get();
      const { words: segmented } = await offscreenRequest({ type: 'dict_segment', runs: msg.runs });

      return { success: true, type: 'segment_text', words: classifyWords(msg.runs, segmented, await known) };
    },
  });
}
