// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HIGHLIGHT_NAME,
  MIN_WORDS_FOR_FIGURE,
  PageCoverageManager,
  SLICE_CHARS,
  formatCoverage,
  summariseCoverage,
  type SegmentClient,
} from '../page-coverage.js';
import type { PageWord } from '../../shared/types.js';

/** Matches the wait the manager gives a changing page. */
const RESCAN_DELAY_MS = 1000;

// happy-dom delivers mutation records on a timer of its own that fake timers do
// not reach, so a test waits for them in real time.
const realSetTimeout = globalThis.setTimeout;
const mutationsDelivered = () => new Promise(resolve => realSetTimeout(resolve, 10));

// happy-dom has no Custom Highlight API; these stand in for Chrome's.
class FakeHighlight extends Set<Range> {}

type StorageListener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;

/**
 * A stand-in for the worker: every character is a word, known when the
 * reader's set holds it. The segmentation itself is tested in the dictionary.
 */
function createClient(known: Set<string>): SegmentClient & { segment: ReturnType<typeof vi.fn> } {
  return {
    segment: vi.fn(async (runs: string[]): Promise<PageWord[][]> =>
      runs.map(run => [...run].map((char, i) => ({ start: i, end: i + 1, known: known.has(char) })))),
  };
}

function markedText(): string[] {
  const highlight = CSS.highlights.get(HIGHLIGHT_NAME) as unknown as FakeHighlight | undefined;
  return [...(highlight ?? [])].map(range => range.toString());
}

// Twenty characters, so the page has enough words for a figure.
const PARAGRAPH = '我们今天学习中文我们今天学习中文我们今天';

describe('summariseCoverage', () => {
  it('weights each word by how often it occurs', () => {
    const summary = summariseCoverage([
      { text: '我', known: true },
      { text: '我', known: true },
      { text: '我', known: true },
      { text: '學習', known: false },
    ]);

    expect(summary.known / summary.words).toBe(0.75);
  });

  it('counts each unknown word once however often it occurs', () => {
    const summary = summariseCoverage([
      { text: '學習', known: false },
      { text: '學習', known: false },
      { text: '中文', known: false },
    ]);

    expect(summary.unknownWords).toBe(2);
  });
});

describe('formatCoverage', () => {
  it('rounds down, so a page is never called fully known with a word left', () => {
    expect(formatCoverage({ words: 200, known: 199, unknownWords: 1 })).toBe('99% known · 1 new word');
  });
});

describe('PageCoverageManager', () => {
  let client: ReturnType<typeof createClient>;
  let manager: PageCoverageManager;

  function start(known: Set<string> = new Set()): void {
    client = createClient(known);
    manager = new PageCoverageManager(document, client, callback => callback());
    manager.applySettings({ markUnknownWords: true });
  }

  function storageListener(): StorageListener {
    const calls = vi.mocked(chrome.storage.onChanged.addListener).mock.calls;
    return calls[calls.length - 1]![0] as unknown as StorageListener;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(globalThis, { Highlight: FakeHighlight, CSS: { highlights: new Map() } });
    vi.mocked(chrome.storage.onChanged.addListener).mockClear();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  afterEach(() => {
    manager?.applySettings({ markUnknownWords: false });
    vi.useRealTimers();
    Reflect.deleteProperty(globalThis, 'Highlight');
    Reflect.deleteProperty(globalThis, 'CSS');
  });

  it('reads nothing while the setting is off', async () => {
    document.body.innerHTML = `<p>${PARAGRAPH}</p>`;
    client = createClient(new Set());
    manager = new PageCoverageManager(document, client, callback => callback());

    await vi.runAllTimersAsync();

    expect(client.segment).not.toHaveBeenCalled();
    expect(CSS.highlights.get(HIGHLIGHT_NAME)).toBeUndefined();
  });

  it('marks the unknown words without touching the page', async () => {
    document.body.innerHTML = '<p>我學<b>中文</b></p>';
    const before = document.body.innerHTML;

    start(new Set(['我', '中']));
    await vi.runAllTimersAsync();

    expect(markedText().sort()).toEqual(['學', '文']);
    expect(document.body.innerHTML.startsWith(before)).toBe(true);
  });

  it('leaves editable fields, scripts and read-off pictures alone', async () => {
    document.body.innerHTML = [
      '<p>我</p>',
      '<div contenteditable="true">學</div>',
      '<textarea>習</textarea>',
      '<script>// 中</script>',
      '<div class="canto-ocr-overlay"><div class="canto-ocr-line">文</div></div>',
    ].join('');

    start();
    await vi.runAllTimersAsync();

    expect(client.segment).toHaveBeenCalledWith(['我']);
  });

  it('sends a long page a slice at a time', async () => {
    const paragraphs = Math.ceil((SLICE_CHARS * 2) / PARAGRAPH.length);
    document.body.innerHTML = Array.from({ length: paragraphs }, () => `<p>${PARAGRAPH}</p>`).join('');

    start();
    await vi.runAllTimersAsync();

    expect(client.segment.mock.calls.length).toBeGreaterThan(1);
    for (const [runs] of client.segment.mock.calls as [string[]][]) {
      expect(runs.join('').length).toBeLessThanOrEqual(SLICE_CHARS);
    }
  });

  it('shows the share known in a corner chip once there are enough words', async () => {
    document.body.innerHTML = `<p>${PARAGRAPH}</p>`;

    start(new Set(['我', '们', '今', '天']));
    await vi.runAllTimersAsync();

    const chip = document.querySelector('.canto-coverage-chip');
    expect(chip?.textContent).toContain('60% known · 4 new words');
  });

  it('shows no figure for a page with a handful of words', async () => {
    document.body.innerHTML = `<p>${PARAGRAPH.slice(0, MIN_WORDS_FOR_FIGURE - 1)}</p>`;

    start();
    await vi.runAllTimersAsync();

    expect(document.querySelector('.canto-coverage-chip')).toBeNull();
  });

  it('hides the chip for the page once dismissed', async () => {
    document.body.innerHTML = `<p>${PARAGRAPH}</p>`;
    start();
    await vi.runAllTimersAsync();

    (document.querySelector('.canto-coverage-close') as HTMLButtonElement).click();

    expect(document.querySelector('.canto-coverage-chip')).toBeNull();
    expect(markedText()).not.toHaveLength(0);
  });

  it('reads only the text a change to the page added', async () => {
    document.body.innerHTML = '<p>我</p>';
    start();
    await vi.runAllTimersAsync();

    const added = document.createElement('p');
    added.textContent = '學習';
    document.body.appendChild(added);
    await mutationsDelivered();
    await vi.advanceTimersByTimeAsync(RESCAN_DELAY_MS);
    await vi.runAllTimersAsync();

    expect(client.segment).toHaveBeenLastCalledWith(['學習']);
    expect(markedText().sort()).toEqual(['學', '我', '習'].sort());
  });

  it('does not read the page again when the popup opens over it', async () => {
    document.body.innerHTML = '<p>我</p>';
    start();
    await vi.runAllTimersAsync();
    client.segment.mockClear();

    const popup = document.createElement('div');
    popup.className = 'chinese-hover-popup';
    popup.textContent = '學習';
    document.body.appendChild(popup);
    await mutationsDelivered();
    await vi.runAllTimersAsync();

    expect(client.segment).not.toHaveBeenCalled();
  });

  it('asks again when a word becomes known', async () => {
    document.body.innerHTML = '<p>我學</p>';
    const known = new Set<string>();
    start(known);
    await vi.runAllTimersAsync();
    expect(markedText().sort()).toEqual(['學', '我'].sort());

    known.add('我');
    storageListener()({
      'word:我': {
        oldValue: { count: 1, firstSeen: 1, lastSeen: 1 },
        newValue: { count: 1, firstSeen: 1, lastSeen: 1, suppressed: true },
      },
    }, 'local');
    await vi.advanceTimersByTimeAsync(RESCAN_DELAY_MS);
    await vi.runAllTimersAsync();

    expect(markedText()).toEqual(['學']);
  });

  it('ignores a sighting, which cannot change what is known', async () => {
    document.body.innerHTML = '<p>我學</p>';
    start();
    await vi.runAllTimersAsync();
    client.segment.mockClear();

    storageListener()({
      'word:我': {
        oldValue: { count: 1, firstSeen: 1, lastSeen: 1 },
        newValue: { count: 2, firstSeen: 1, lastSeen: 2 },
      },
    }, 'local');
    await vi.runAllTimersAsync();

    expect(client.segment).not.toHaveBeenCalled();
  });

  it('clears the marks and the chip when switched off', async () => {
    document.body.innerHTML = `<p>${PARAGRAPH}</p>`;
    start();
    await vi.runAllTimersAsync();

    manager.applySettings({ markUnknownWords: false });

    expect(CSS.highlights.get(HIGHLIGHT_NAME)).toBeUndefined();
    expect(document.querySelector('.canto-coverage-chip')).toBeNull();
  });
});
