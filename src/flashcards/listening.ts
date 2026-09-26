import { findVoice, type Reading } from '../shared/speech.js';

/**
 * Which reading the listening card plays in, decided once a session from the
 * voices on offer: Cantonese when a voice can say it, Mandarin otherwise, and
 * null when neither can — in which case the card is not offered at all. The
 * choice is the browser's rather than the word's, so it is made here instead
 * of being recorded.
 */
export function listeningReading(voices: SpeechSynthesisVoice[]): Reading | null {
  if (findVoice(voices, 'jyutping')) return 'jyutping';
  if (findVoice(voices, 'pinyin')) return 'pinyin';
  return null;
}
