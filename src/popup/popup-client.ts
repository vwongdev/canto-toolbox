import { sendMessage } from '../shared/message-manager.js';
import type {
  ContextSource,
  HoverSegment,
  LookupResponse,
  MarkKnownResponse,
  TrackWordResponse,
  ErrorResponse,
} from '../shared/types.js';

export interface PopupClient {
  lookupWord(
    word: string,
    callback: (r: LookupResponse | ErrorResponse) => void,
    segment?: HoverSegment,
  ): void;
  trackWord(
    word: string,
    callback: (r: TrackWordResponse | ErrorResponse) => void,
    context?: string,
  ): void;
  /** Track the word and add it to the deck outright, skipping the exposure gate. */
  pinWord(
    word: string,
    callback: (r: TrackWordResponse | ErrorResponse) => void,
    context?: string,
  ): void;
  /** Retire the word, or put it back, without counting it as a sighting. */
  markKnown(
    word: string,
    known: boolean,
    callback: (r: MarkKnownResponse | ErrorResponse) => void,
    context?: string,
  ): void;
}

class PopupMessageClient implements PopupClient {
  lookupWord(
    word: string,
    callback: (r: LookupResponse | ErrorResponse) => void,
    segment?: HoverSegment,
  ): void {
    sendMessage({ type: 'lookup_word', word, withStatus: true, ...(segment && { segment }) }, callback);
  }

  trackWord(
    word: string,
    callback: (r: TrackWordResponse | ErrorResponse) => void,
    context?: string,
  ): void {
    sendMessage({ type: 'track_word', word, ...sentence(context) }, callback);
  }

  pinWord(
    word: string,
    callback: (r: TrackWordResponse | ErrorResponse) => void,
    context?: string,
  ): void {
    sendMessage({ type: 'track_word', word, pin: true, ...sentence(context) }, callback);
  }

  markKnown(
    word: string,
    known: boolean,
    callback: (r: MarkKnownResponse | ErrorResponse) => void,
    context?: string,
  ): void {
    sendMessage({ type: 'mark_known', word, known, ...sentence(context) }, callback);
  }
}

/**
 * A sentence travels with the page it was read on. The address is sent whole
 * and filtered where it is stored, so what is kept is decided in one place.
 */
function sentence(context: string | undefined): { context?: string; source?: ContextSource } {
  if (!context) return {};
  return { context, source: { url: location.href, title: document.title } };
}

export const popupClient = new PopupMessageClient();
