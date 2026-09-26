import { createElement } from '../shared/dom-element.js';
import { sendMessage } from '../shared/message-manager.js';
import type { Settings } from '../shared/settings.js';
import type { PageWord } from '../shared/types.js';
import { changesKnown } from './known-words.js';
import coverageStyles from './page-coverage.scss?inline';

/**
 * Marks the words on a page the reader does not know yet, and says what share
 * of the page they do — so a learner can tell at a glance whether a text is
 * at their level.
 *
 * The marks are a CSS Custom Highlight over `Range`s, not wrapped text: the
 * page's DOM is never touched, so neither its own scripts nor the popup's
 * `caretRangeFromPoint` can tell the difference. The content script runs in
 * the top frame only, so text inside an iframe is neither marked nor counted.
 */

// The set and map halves of these live in TypeScript's `DOM.Iterable` lib,
// which the project does not load; this file is the only one that needs them.
declare global {
  interface Highlight {
    add(range: AbstractRange): this;
    delete(range: AbstractRange): boolean;
    clear(): void;
    readonly size: number;
  }
  interface HighlightRegistry {
    set(name: string, highlight: Highlight): this;
    delete(name: string): boolean;
    get(name: string): Highlight | undefined;
  }
}

export const HIGHLIGHT_NAME = 'canto-unknown';

const CHINESE_RUN = /[一-鿿]+/g;
const HAS_CHINESE = /[一-鿿]/;

/**
 * Characters sent per round trip. The offscreen document has one thread and a
 * hover waits behind whatever it is doing, so the page's text goes a slice at
 * a time — each one a few milliseconds of work — and a lookup never queues
 * behind more than one.
 */
export const SLICE_CHARS = 2000;

/**
 * Characters read per page at most. A long page is sampled from the part
 * being read outwards; past this the figure would not move, and an endless
 * feed would otherwise be segmented for as long as it scrolls.
 */
export const MAX_PAGE_CHARS = 100_000;

/** Fewer words than this say nothing about a page's level, so no figure is shown. */
export const MIN_WORDS_FOR_FIGURE = 20;

/** How long a change to the page waits, gathering others, before it is looked at. */
const RESCAN_DELAY_MS = 1000;
const IDLE_TIMEOUT_MS = 2000;

/**
 * Text that is not the page's prose — or not the page's at all. The popup and
 * the OCR overlay are the extension's own; the overlay's text is read out of a
 * picture, and a guess at a subtitle is not a word on the page.
 */
const OWN_UI = '.chinese-hover-popup, .canto-ocr-overlay, .canto-ocr-badge, .canto-coverage-chip';

const SKIPPED = [
  'script', 'style', 'noscript', 'template', 'textarea', 'select', 'option',
  '[contenteditable=""]', '[contenteditable="true"]', '[contenteditable="plaintext-only"]',
  OWN_UI,
].join(', ');

export interface CoverageSummary {
  /** Word tokens counted, each occurrence once. */
  words: number;
  known: number;
  /** Distinct words not known, which is what a reader would have to learn. */
  unknownWords: number;
}

/** Share of the page's words the reader knows, weighted by how often each occurs. */
export function summariseCoverage(words: Iterable<{ text: string; known: boolean }>): CoverageSummary {
  let total = 0;
  let known = 0;
  const unknown = new Set<string>();

  for (const word of words) {
    total++;
    if (word.known) known++;
    else unknown.add(word.text);
  }

  return { words: total, known, unknownWords: unknown.size };
}

export function formatCoverage(summary: CoverageSummary): string {
  const percent = Math.floor((summary.known / summary.words) * 100);
  const noun = summary.unknownWords === 1 ? 'new word' : 'new words';
  return `${percent}% known · ${summary.unknownWords} ${noun}`;
}

export interface SegmentClient {
  segment(runs: string[]): Promise<PageWord[][]>;
}

export const segmentClient: SegmentClient = {
  segment: (runs) => new Promise((resolve, reject) => {
    sendMessage({ type: 'segment_text', runs }, (response) => {
      if (response.success) resolve(response.words);
      else reject(new Error(response.error));
    });
  }),
};

interface MarkedWord {
  text: string;
  known: boolean;
  range?: Range;
}

/** What a text node was found to hold, and the text it held at the time. */
interface NodeWords {
  data: string;
  words: MarkedWord[];
}

type Schedule = (callback: () => void) => void;

function whenIdle(callback: () => void): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => callback(), { timeout: IDLE_TIMEOUT_MS });
  } else {
    setTimeout(callback, 0);
  }
}

function highlightsSupported(): boolean {
  return typeof Highlight === 'function' && typeof CSS !== 'undefined' && 'highlights' in CSS;
}

export class PageCoverageManager {
  private enabled = false;
  private readonly nodes = new Map<Text, NodeWords>();
  private highlight: Highlight | null = null;
  private chip: HTMLElement | null = null;
  private dismissed = false;
  private url = '';
  private observer: MutationObserver | null = null;
  private rescanTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped whenever a pass should stop: switched off, or its results are stale. */
  private generation = 0;
  private running = false;
  private rescanRequested = false;
  /** Every node's verdicts are out of date, not only the nodes that changed. */
  private stale = false;
  private readonly boundStorageChange: (changes: Record<string, chrome.storage.StorageChange>) => void;
  private readonly boundNavigation: () => void;

  constructor(
    private readonly document: Document,
    private readonly client: SegmentClient,
    private readonly schedule: Schedule = whenIdle,
  ) {
    this.boundStorageChange = (changes) => {
      if (changesKnown(changes)) this.requestRescan({ reclassify: true });
    };
    this.boundNavigation = () => this.requestRescan();
  }

  applySettings(settings: Pick<Settings, 'markUnknownWords'>): void {
    if (settings.markUnknownWords === this.enabled) return;
    if (settings.markUnknownWords) this.enable();
    else this.disable();
  }

  private enable(): void {
    this.enabled = true;
    this.injectStyles();
    this.url = this.document.location?.href ?? '';

    if (highlightsSupported()) {
      this.highlight = new Highlight();
      CSS.highlights.set(HIGHLIGHT_NAME, this.highlight);
    }

    this.observer = new MutationObserver(mutations => {
      if (mutations.some(mutation => !this.isOwnMutation(mutation))) this.requestRescan();
    });
    this.observer.observe(this.document.body, { childList: true, subtree: true, characterData: true });

    chrome.storage.onChanged.addListener(this.boundStorageChange);
    // A single-page app changes its content without a load; the mutations it
    // makes reach the observer, and these catch history moves that make none.
    window.addEventListener('popstate', this.boundNavigation);
    window.addEventListener('hashchange', this.boundNavigation);

    void this.scan();
  }

  private disable(): void {
    this.enabled = false;
    this.generation++;
    this.observer?.disconnect();
    this.observer = null;
    chrome.storage.onChanged.removeListener(this.boundStorageChange);
    window.removeEventListener('popstate', this.boundNavigation);
    window.removeEventListener('hashchange', this.boundNavigation);
    if (this.rescanTimer !== null) clearTimeout(this.rescanTimer);
    this.rescanTimer = null;

    if (this.highlight) CSS.highlights.delete(HIGHLIGHT_NAME);
    this.highlight = null;
    this.nodes.clear();
    this.chip?.remove();
    this.chip = null;
  }

  /**
   * The extension's own UI changing — the popup opening, the chip redrawing —
   * is not the page changing. Both are added straight to the body, so an
   * addition counts as ours when everything it added or removed is.
   */
  private isOwnMutation(mutation: MutationRecord): boolean {
    const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
    if (target?.closest(OWN_UI) != null) return true;

    const touched = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)];
    return touched.length > 0 && touched.every(node => node instanceof Element && node.matches(OWN_UI));
  }

  private requestRescan({ reclassify = false }: { reclassify?: boolean } = {}): void {
    if (!this.enabled) return;

    if (reclassify) {
      // Every verdict may have moved, so the words are asked about again. The
      // old marks stay until each node's new answer replaces them, so the page
      // and the figure do not blink empty in between.
      this.generation++;
      this.stale = true;
    }

    // Not pushed back by each new change: a page with a ticking clock or a live
    // feed changes more often than any quiet period would allow, and would
    // otherwise never be looked at again.
    if (this.rescanTimer !== null) return;
    this.rescanTimer = setTimeout(() => {
      this.rescanTimer = null;
      void this.scan();
    }, RESCAN_DELAY_MS);
  }

  private forgetAll(): void {
    this.highlight?.clear();
    this.nodes.clear();
  }

  private forget(node: Text): void {
    const entry = this.nodes.get(node);
    if (!entry) return;
    for (const word of entry.words) {
      if (word.range) this.highlight?.delete(word.range);
    }
    this.nodes.delete(node);
  }

  /**
   * One pass over the page: drop what has gone or changed, then segment what
   * is new, nearest the viewport first, a slice per idle period. A request
   * made while a pass runs is honoured when it ends rather than run alongside.
   */
  async scan(): Promise<void> {
    if (!this.enabled) return;
    if (this.running) {
      this.rescanRequested = true;
      return;
    }

    this.running = true;
    const generation = this.generation;

    try {
      this.followNavigation();
      const pending = this.collectPending();
      this.updateChip();

      for (const slice of slices(pending)) {
        await new Promise<void>(resolve => this.schedule(resolve));
        if (generation !== this.generation) return;

        const runs = slice.flatMap(({ runs }) => runs.map(run => run.text));
        const words = await this.client.segment(runs);
        if (generation !== this.generation) return;

        this.record(slice, words);
        this.updateChip();
      }
    } catch (error) {
      // An extension reloaded under the page cannot answer; the marks already
      // drawn stay, and the next change to the page tries again.
      console.warn('[Coverage] Could not segment the page:', error);
    } finally {
      this.running = false;
      if (this.rescanRequested && this.enabled) {
        this.rescanRequested = false;
        void this.scan();
      }
    }
  }

  private followNavigation(): void {
    const url = this.document.location?.href ?? '';
    if (url === this.url) return;

    this.url = url;
    // A new page deserves its own figure, even one the reader waved away on the last.
    this.dismissed = false;
    this.forgetAll();
  }

  private collectPending(): PendingNode[] {
    const found = new Set<Text>();
    const pending: PendingNode[] = [];
    let budget = MAX_PAGE_CHARS;
    const refresh = this.stale;
    this.stale = false;

    for (const node of this.textNodes()) {
      found.add(node);
      const entry = this.nodes.get(node);

      if (entry && entry.data === node.data) {
        if (!refresh) {
          budget -= entry.data.length;
          continue;
        }
      } else {
        this.forget(node);
      }

      pending.push({ node, data: node.data, runs: [], distance: 0 });
    }

    for (const node of [...this.nodes.keys()]) {
      if (!found.has(node)) this.forget(node);
    }

    // Nearest the viewport first, so what the reader is looking at is marked
    // before the rest of the page is read.
    const viewport = window.innerHeight || 0;
    for (const item of pending) {
      const rect = item.node.parentElement!.getBoundingClientRect();
      item.distance = rect.bottom < 0 ? -rect.bottom : Math.max(0, rect.top - viewport);
    }
    pending.sort((a, b) => a.distance - b.distance);

    const kept: PendingNode[] = [];
    for (const item of pending) {
      if (budget <= 0) break;
      item.runs = chineseRuns(item.data);
      budget -= item.data.length;
      kept.push(item);
    }
    return kept;
  }

  /**
   * The page's text nodes in document order. Walked by hand rather than with a
   * `TreeWalker` so a skipped element's whole subtree is passed over — a text
   * filter cannot prune, and would visit every node inside the popup or a
   * script only to reject it.
   */
  private *textNodes(): Generator<Text> {
    const stack: Node[] = [this.document.body];

    while (stack.length > 0) {
      const node = stack.pop()!;

      if (node.nodeType === Node.TEXT_NODE) {
        if (this.isReadable(node as Text)) yield node as Text;
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE || (node as Element).matches(SKIPPED)) continue;

      for (let child = node.lastChild; child; child = child.previousSibling) stack.push(child);
    }
  }

  private isReadable(node: Text): boolean {
    if (!HAS_CHINESE.test(node.data)) return false;

    const parent = node.parentElement;
    if (!parent || parent.isContentEditable) return false;

    // Text the reader cannot see is not part of what they are reading.
    return typeof parent.checkVisibility !== 'function' || parent.checkVisibility();
  }

  private record(slice: PendingNode[], words: PageWord[][]): void {
    let index = 0;

    for (const item of slice) {
      const runWords = words.slice(index, index + item.runs.length);
      index += item.runs.length;

      // Changed while the reply was on its way; the next pass reads it afresh.
      if (!item.node.isConnected || item.node.data !== item.data) continue;

      this.forget(item.node);
      const marked: MarkedWord[] = [];
      item.runs.forEach((run, i) => {
        for (const word of runWords[i] ?? []) {
          const start = run.offset + word.start;
          const end = run.offset + word.end;
          marked.push({
            text: item.data.slice(start, end),
            known: word.known,
            ...(!word.known && this.highlight && { range: this.markRange(item.node, start, end) }),
          });
        }
      });

      this.nodes.set(item.node, { data: item.data, words: marked });
    }
  }

  private markRange(node: Text, start: number, end: number): Range {
    const range = this.document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    this.highlight!.add(range);
    return range;
  }

  /** The words counted so far — the figure fills in as the page is read. */
  summary(): CoverageSummary {
    return summariseCoverage([...this.nodes.values()].flatMap(entry => entry.words));
  }

  private updateChip(): void {
    const summary = this.summary();
    if (this.dismissed || summary.words < MIN_WORDS_FOR_FIGURE) {
      this.chip?.remove();
      this.chip = null;
      return;
    }

    if (!this.chip) this.chip = this.createChip();
    const figure = this.chip.querySelector('.canto-coverage-figure')!;
    figure.textContent = formatCoverage(summary);
    if (!this.chip.isConnected) this.document.body.appendChild(this.chip);
  }

  private createChip(): HTMLElement {
    const close = createElement<HTMLButtonElement>({
      tag: 'button',
      className: 'canto-coverage-close',
      textContent: '×',
      attributes: { type: 'button', 'aria-label': 'Hide for this page' },
    });
    close.addEventListener('click', () => {
      this.dismissed = true;
      this.updateChip();
    });

    return createElement({
      className: 'canto-coverage-chip',
      attributes: { role: 'status', title: 'Share of the words on this page you know' },
      children: [createElement({ tag: 'span', className: 'canto-coverage-figure' }), close],
    });
  }

  private injectStyles(): void {
    if (this.document.getElementById('canto-coverage-styles')) return;

    const style = createElement<HTMLStyleElement>({ tag: 'style', id: 'canto-coverage-styles' });
    style.textContent = coverageStyles;
    this.document.head.appendChild(style);
  }
}

interface ChineseRun {
  text: string;
  offset: number;
}

interface PendingNode {
  node: Text;
  data: string;
  runs: ChineseRun[];
  distance: number;
}

function chineseRuns(data: string): ChineseRun[] {
  return [...data.matchAll(CHINESE_RUN)].map(match => ({ text: match[0], offset: match.index }));
}

/** Whole nodes per slice, so a node's words always arrive together. */
function* slices(pending: PendingNode[]): Generator<PendingNode[]> {
  let slice: PendingNode[] = [];
  let size = 0;

  for (const item of pending) {
    const length = item.runs.reduce((sum, run) => sum + run.text.length, 0);
    if (slice.length > 0 && size + length > SLICE_CHARS) {
      yield slice;
      slice = [];
      size = 0;
    }
    slice.push(item);
    size += length;
  }

  if (slice.length > 0) yield slice;
}

export const pageCoverageManager = new PageCoverageManager(document, segmentClient);
