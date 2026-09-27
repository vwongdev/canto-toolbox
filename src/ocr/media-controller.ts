import { createElement } from '../shared/dom-element.js';
import { createOverlay } from './overlay.js';
import { captureFrame, type MediaElement } from './capture.js';
import { ocrClient, type OcrClient } from './ocr-client.js';
import type { OcrResult } from '../shared/types.js';
import ocrStyles from './ocr.scss?inline';

/**
 * Below this a picture cannot be holding text a reader wants looked up — it is
 * an icon, an avatar or a tracking pixel. Checking keeps the badge off the
 * furniture of every page.
 */
const MIN_MEDIA_SIDE_PX = 96;

/**
 * A page-scoped `blob:` URL has to be read here and forwarded as bytes, since
 * the offscreen document that runs the model cannot resolve it. This caps what
 * is worth inlining into a message to do so.
 */
const MAX_INLINED_BYTES = 8 * 1024 * 1024;

const IMAGE_BADGE_TITLE = 'Read the Chinese in this image';
const VIDEO_BADGE_TITLE = 'Read the Chinese in this frame';

type BadgeState = 'idle' | 'reading' | 'empty' | 'failed';

/** What the badge says it is doing, or what came of it. */
const BADGE_TITLES: Readonly<Record<Exclude<BadgeState, 'idle'>, string>> = {
  reading: 'Reading…',
  empty: 'No Chinese text found here',
  failed: 'Could not read this — click to try again',
};

interface Attached {
  overlay: HTMLElement;
  /** Kept so a resize can re-lay the text rather than read the frame again. */
  result: OcrResult;
  width: number;
  height: number;
  /** Which frame this was read from, so the same pause is not read twice. */
  readAt?: number;
  /** Torn down with the overlay, since they are bound to this element. */
  detachListeners?: () => void;
}

function isVideo(media: MediaElement): media is HTMLVideoElement {
  return media instanceof HTMLVideoElement;
}

/**
 * Adds the text inside pictures to what the hover popup can read — an image, or
 * the frame a video is paused on.
 *
 * Nothing here looks anything up. It turns a picture into positioned, invisible
 * text nodes and stops; from that point the popup's own hover handling finds
 * them exactly as it finds text the page wrote itself, which is why studying a
 * word off a subtitle records the same statistics and builds the same
 * flashcards as one met in an article.
 */
export class MediaOcrManager {
  private readonly document: Document;
  private readonly client: OcrClient;
  private readonly attached = new Map<MediaElement, Attached>();
  private badge: HTMLElement | null = null;
  private badgeTarget: MediaElement | null = null;
  /**
   * What the cursor is over, offerable or not. A video is normally paused with
   * the cursor already on it — space, `k`, or a click on the picture — and none
   * of those move the pointer, so what is on offer has to be reconsidered when
   * playback changes rather than only when the cursor arrives.
   */
  private hovered: MediaElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private repositionFrame: number | null = null;
  private readonly boundMouseOver: (e: MouseEvent) => void;
  private readonly boundReposition: () => void;
  private readonly boundPlayback: (e: Event) => void;

  constructor(document: Document, client: OcrClient) {
    this.document = document;
    this.client = client;
    this.boundMouseOver = (e) => this.handleMouseOver(e);
    this.boundReposition = () => this.scheduleReposition();
    this.boundPlayback = (e) => this.handlePlayback(e);
  }

  /**
   * Scrolling fires far faster than the page repaints, and each reposition
   * measures every overlaid picture. A frame is the finest resolution any of
   * this can be seen at, so coalesce to one.
   */
  private scheduleReposition(): void {
    if (this.repositionFrame !== null) return;

    this.repositionFrame = requestAnimationFrame(() => {
      this.repositionFrame = null;
      this.repositionAll();
    });
  }

  init(): void {
    this.injectStyles();
    this.document.addEventListener('mouseover', this.boundMouseOver, true);
    this.document.addEventListener('play', this.boundPlayback, true);
    this.document.addEventListener('pause', this.boundPlayback, true);
    window.addEventListener('scroll', this.boundReposition, true);
    window.addEventListener('resize', this.boundReposition);
    this.resizeObserver = new ResizeObserver(() => this.scheduleReposition());
  }

  destroy(): void {
    this.document.removeEventListener('mouseover', this.boundMouseOver, true);
    this.document.removeEventListener('play', this.boundPlayback, true);
    this.document.removeEventListener('pause', this.boundPlayback, true);
    window.removeEventListener('scroll', this.boundReposition, true);
    window.removeEventListener('resize', this.boundReposition);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.repositionFrame !== null) {
      cancelAnimationFrame(this.repositionFrame);
      this.repositionFrame = null;
    }

    for (const media of [...this.attached.keys()]) this.detach(media);
    this.hovered = null;
    this.hideBadge();
  }

  private handleMouseOver(event: MouseEvent): void {
    const target = event.target;

    if (!isMedia(target)) {
      // Moving onto the badge itself must not dismiss it.
      const overBadge = target instanceof Element && target.closest('.canto-ocr-badge');
      if (!overBadge) {
        this.hovered = null;
        this.hideBadge();
      }
      return;
    }

    this.hovered = target;
    this.refreshBadge();
  }

  /**
   * `play` and `pause` do not bubble, so they are caught on the way down. Only
   * the picture under the cursor can change what is being offered there.
   */
  private handlePlayback(event: Event): void {
    if (event.target === this.hovered) this.refreshBadge();
  }

  /** Offers the hovered picture, or withdraws an offer that no longer holds. */
  private refreshBadge(): void {
    if (this.hovered && this.isOfferable(this.hovered)) this.showBadge(this.hovered);
    else this.hideBadge();
  }

  /**
   * A video is only offered while it is paused. Reading a frame the reader is
   * still watching is a frame they have already left, and the badge would be
   * fighting the player's own controls for the same corner.
   */
  private isOfferable(media: MediaElement): boolean {
    if (this.attached.has(media)) return false;
    if (isVideo(media) && !media.paused) return false;

    const rect = media.getBoundingClientRect();
    return rect.width >= MIN_MEDIA_SIDE_PX && rect.height >= MIN_MEDIA_SIDE_PX;
  }

  private showBadge(media: MediaElement): void {
    if (this.badgeTarget === media) return;

    this.hideBadge();
    this.badgeTarget = media;
    const title = isVideo(media) ? VIDEO_BADGE_TITLE : IMAGE_BADGE_TITLE;
    // The badge is drawn in CSS and carries no text of its own. A Chinese
    // label here would be Chinese on the page: the popup would find it with
    // caretRangeFromPoint, look it up, and cover the picture with a definition
    // of the button that was offering to read it.
    this.badge = createElement({
      tag: 'button',
      className: 'canto-ocr-badge',
      dataset: { state: 'idle' },
      attributes: { type: 'button', title, 'aria-label': title },
      listeners: {
        click: (event: Event) => {
          event.preventDefault();
          event.stopPropagation();
          void this.read(media);
        },
      },
    });

    this.document.body.appendChild(this.badge);
    this.positionBadge();
  }

  private hideBadge(): void {
    this.badge?.remove();
    this.badge = null;
    this.badgeTarget = null;
  }

  /**
   * The badge is the only thing the reader can see the model through, so every
   * outcome has to land on it. Its title carries the words, since the badge
   * itself cannot: a label legible enough to say "nothing here" would be
   * Chinese on the page, which the popup would stop and look up.
   */
  private setBadgeState(state: BadgeState): void {
    if (!this.badge) return;
    this.badge.dataset.state = state;
    this.badge.toggleAttribute('disabled', state === 'reading');

    const title = state === 'idle' ? this.badgeTitle() : BADGE_TITLES[state];
    this.badge.setAttribute('title', title);
    this.badge.setAttribute('aria-label', title);
  }

  private badgeTitle(): string {
    return this.badgeTarget && isVideo(this.badgeTarget) ? VIDEO_BADGE_TITLE : IMAGE_BADGE_TITLE;
  }

  private async read(media: MediaElement): Promise<void> {
    this.setBadgeState('reading');

    try {
      const source = isVideo(media)
        ? (await captureFrame(media, () => this.client.captureTab())).src
        : await resolveImageSource(media);

      const result = await this.client.readImage(source);

      // Nothing found is an answer, not a no-op. The reader clicked, waited
      // out a model load, and without this the badge simply vanished.
      if (result.items.length === 0) {
        this.setBadgeState('empty');
        return;
      }

      this.hideBadge();
      this.attach(media, result);
    } catch (error) {
      console.error('[OCR] Could not read the media:', error);
      this.setBadgeState('failed');
    }
  }

  /**
   * Reads the frame again after the reader moves through the video, so
   * stepping from one subtitle to the next does not mean clicking the badge
   * each time. A pause on the frame already read is ignored.
   */
  private async reread(video: HTMLVideoElement): Promise<void> {
    const entry = this.attached.get(video);
    if (!entry || entry.readAt === video.currentTime) return;

    try {
      const { src } = await captureFrame(video, () => this.client.captureTab());
      const result = await this.client.readImage(src);

      // The reader may have played on, or left, while the model was busy.
      if (!this.attached.has(video) || !video.isConnected) return;

      this.replaceOverlay(video, result);
      const current = this.attached.get(video);
      if (current) current.readAt = video.currentTime;
    } catch (error) {
      console.error('[OCR] Could not read the frame:', error);
    }
  }

  private attach(media: MediaElement, result: OcrResult): void {
    const { width, height } = media.getBoundingClientRect();
    const overlay = createOverlay(result, { width, height });

    this.document.body.appendChild(overlay);
    this.attached.set(media, {
      overlay,
      result,
      width,
      height,
      ...(isVideo(media) && { readAt: media.currentTime }),
    });
    this.resizeObserver?.observe(media);
    if (isVideo(media)) this.followPlayback(media);
    this.position(media);
  }

  /**
   * Text read off one frame is wrong for every later one, so playing clears it.
   * Pausing and seeking read the new frame instead.
   */
  private followPlayback(video: HTMLVideoElement): void {
    const onPlay = (): void => this.detach(video);
    const onSettled = (): void => void this.reread(video);

    video.addEventListener('play', onPlay);
    video.addEventListener('seeked', onSettled);
    video.addEventListener('pause', onSettled);

    const entry = this.attached.get(video);
    if (entry) {
      entry.detachListeners = () => {
        video.removeEventListener('play', onPlay);
        video.removeEventListener('seeked', onSettled);
        video.removeEventListener('pause', onSettled);
      };
    }
  }

  private detach(media: MediaElement): void {
    const entry = this.attached.get(media);
    if (!entry) return;

    entry.detachListeners?.();
    entry.overlay.remove();
    this.attached.delete(media);
    this.resizeObserver?.unobserve(media);
  }

  private replaceOverlay(media: MediaElement, result: OcrResult): void {
    const entry = this.attached.get(media);
    if (!entry) return;

    entry.result = result;
    this.redraw(entry, media.getBoundingClientRect());
    this.position(media);
  }

  /**
   * Lay the held result out again at the size the picture is drawn now. Always
   * from `entry.result` — the boxes are in the frame's own pixels, so a new
   * size is a new layout rather than a reason to read the picture again.
   */
  private redraw(entry: Attached, rendered: { width: number; height: number }): void {
    const replacement = createOverlay(entry.result, rendered);
    entry.overlay.replaceWith(replacement);
    entry.overlay = replacement;
    entry.width = rendered.width;
    entry.height = rendered.height;
  }

  /**
   * Overlays sit in the body rather than beside each picture, so that an
   * ancestor's `overflow: hidden` or stacking context cannot clip or bury
   * them. The cost is that they have to be told where their picture went.
   */
  private repositionAll(): void {
    for (const media of [...this.attached.keys()]) {
      if (!media.isConnected) {
        this.detach(media);
        continue;
      }
      this.position(media);
    }
    this.positionBadge();
  }

  private position(media: MediaElement): void {
    const entry = this.attached.get(media);
    if (!entry) return;

    const rect = media.getBoundingClientRect();

    // What the boxes are worth on screen changes whenever a responsive page
    // redraws the picture at a new size. Then and only then is the text laid
    // out again.
    if (rect.width !== entry.width || rect.height !== entry.height) {
      this.redraw(entry, rect);
    }

    entry.overlay.style.left = `${rect.left + window.scrollX}px`;
    entry.overlay.style.top = `${rect.top + window.scrollY}px`;
    entry.overlay.style.width = `${rect.width}px`;
    entry.overlay.style.height = `${rect.height}px`;
  }

  private positionBadge(): void {
    if (!this.badge || !this.badgeTarget) return;

    if (!this.badgeTarget.isConnected) {
      this.hideBadge();
      return;
    }

    const rect = this.badgeTarget.getBoundingClientRect();
    this.badge.style.left = `${rect.right + window.scrollX}px`;
    this.badge.style.top = `${rect.top + window.scrollY}px`;
  }

  private injectStyles(): void {
    if (this.document.getElementById('canto-ocr-styles')) return;

    const style = createElement<HTMLStyleElement>({ tag: 'style', id: 'canto-ocr-styles' });
    style.textContent = ocrStyles;
    this.document.head.appendChild(style);
  }
}

function isMedia(target: EventTarget | null): target is MediaElement {
  return target instanceof HTMLImageElement || target instanceof HTMLVideoElement;
}

/**
 * What to hand the offscreen document for an image. An ordinary URL it can
 * fetch itself; a `blob:` one belongs to this page alone, so those bytes
 * travel inline.
 */
async function resolveImageSource(image: HTMLImageElement): Promise<string> {
  const src = image.currentSrc || image.src;
  if (!src.startsWith('blob:')) return src;

  const blob = await (await fetch(src)).blob();
  if (blob.size > MAX_INLINED_BYTES) {
    throw new Error('Image is too large to read');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read the image data'));
    reader.readAsDataURL(blob);
  });
}

export const mediaOcrManager = new MediaOcrManager(document, ocrClient);
