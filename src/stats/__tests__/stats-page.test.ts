// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { StatsManager } from '../stats.js';
import type { StatsClient } from '../stats-client.js';
import type { StatsStorage } from '../stats-storage.js';
import { SORT_LABELS } from '../ordering.js';
import type { Statistics } from '../../shared/types.js';

// The real page markup, minus the asset references happy-dom would try to fetch.
const HTML = readFileSync('src/stats/stats.html', 'utf-8')
  .replace(/<link\b[^>]*>/g, '')
  .replace(/<script\b[\s\S]*?<\/script>/g, '');

const NOW = Date.now();
const HOUR_MS = 3_600_000;

const STATISTICS: Statistics = {
  常見: { count: 9, firstSeen: 1, lastSeen: 100, rank: 40 },
  少見: { count: 2, firstSeen: 1, lastSeen: 300, rank: 7000 },
  退休: { count: 5, firstSeen: 1, lastSeen: 200, rank: 500, suppressed: true },
  到期: {
    count: 1,
    firstSeen: 1,
    lastSeen: 50,
    rank: 2500,
    flashcard: {
      reviews: 2,
      correct: 1,
      consecutiveCorrect: 0,
      srs: {
        due: NOW - HOUR_MS,
        stability: 2,
        difficulty: 5,
        scheduledDays: 2,
        learningSteps: 0,
        lapses: 1,
        state: 2,
      },
    },
  },
};

function createClient(): StatsClient {
  return {
    getStatistics: vi.fn(cb =>
      cb({ success: true, type: 'get_statistics', statistics: STATISTICS })
    ),
    lookupWord: vi.fn(),
    setWordStatus: vi.fn((_word, _status, cb) => cb({ success: true, type: 'set_word_status' })),
  };
}

const storage: StatsStorage = {
  getStatistics: vi.fn(async () => STATISTICS),
  clearStatistics: vi.fn(async () => {}),
  restoreStatistics: vi.fn(),
};

describe('StatsManager overview', () => {
  let document: Document;
  let client: StatsClient;

  function text(id: string): string | null {
    return document.getElementById(id)!.textContent;
  }

  function listedWords(): string[] {
    return Array.from(
      document.getElementById('stats-list')!.querySelectorAll('.stat-word'),
      el => el.textContent ?? ''
    );
  }

  function retiredTab(): HTMLElement {
    return document.querySelector('[data-status="retired"]') as HTMLElement;
  }

  function clickRetired(): void {
    retiredTab().dispatchEvent(new Event('click', { bubbles: true }));
  }

  beforeEach(() => {
    document = new DOMParser().parseFromString(HTML, 'text/html');
    client = createClient();
    new StatsManager(document, client, storage).init();
  });

  it('reports what the scheduler already owes', () => {
    expect(text('overview-due-now')).toBe('1');
  });

  it('reports accuracy across the reviews that counted answers', () => {
    expect(text('overview-accuracy')).toBe('50%');
  });

  it('reports how many words are retired', () => {
    expect(text('overview-retired')).toBe('1');
  });

  it('lists the words most studied first by default', () => {
    expect(listedWords()[0]).toBe('常見');
  });

  it('offers exactly the sorts the comparators implement', () => {
    const select = document.getElementById('sort-select') as HTMLSelectElement;
    const offered = Array.from(select.options, option => [option.value, option.text]);

    expect(offered).toEqual(Object.entries(SORT_LABELS));
  });

  it('reorders the list when a different sort is chosen', () => {
    const select = document.getElementById('sort-select') as HTMLSelectElement;
    select.value = 'recent';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(listedWords()[0]).toBe('少見');
  });

  it('narrows the list to a frequency band', () => {
    document
      .querySelector('[data-band="core"]')!
      .dispatchEvent(new Event('click', { bubbles: true }));

    expect(listedWords()).toEqual(['常見']);
  });

  it('counts the words in each band', () => {
    expect(text('count-core')).toBe('1');
    expect(text('count-frequent')).toBe('1');
  });

  // A retired word was taken out of the deck on purpose; leaving it in the
  // list pads the very list the reader uses to pick what to study next.
  it('leaves retired words out of the list', () => {
    expect(listedWords()).not.toContain('退休');
  });

  it('shows retired words once the pill is pressed', () => {
    clickRetired();

    expect(listedWords()).toContain('退休');
    expect(retiredTab().getAttribute('aria-pressed')).toBe('true');
  });

  it('hides them again on a second press', () => {
    clickRetired();
    clickRetired();

    expect(listedWords()).not.toContain('退休');
    expect(retiredTab().getAttribute('aria-pressed')).toBe('false');
  });

  // The pill says what pressing it would reveal, so its own count is the one
  // tally the filter does not narrow.
  it('counts every retired word whether or not they are shown', () => {
    expect(text('count-retired')).toBe('1');

    clickRetired();

    expect(text('count-retired')).toBe('1');
  });

  it('counts a retired word towards a band only while retired words are shown', () => {
    clickRetired();

    expect(text('count-core')).toBe('2');
  });
});

describe('StatsManager keyboard reachability', () => {
  let document: Document;

  function firstRowHeader(): HTMLButtonElement {
    return document.getElementById('stats-list')!.querySelector('.stat-header') as HTMLButtonElement;
  }

  beforeEach(() => {
    document = new DOMParser().parseFromString(HTML, 'text/html');
    new StatsManager(document, createClient(), storage).init();
  });

  // The row is the page's main control; as a div it answered neither Tab nor
  // Enter, which between them is every way to use the page without a mouse.
  it('makes each row a button that says whether it is open', () => {
    const header = firstRowHeader();
    expect(header.tagName).toBe('BUTTON');
    expect(header.getAttribute('aria-expanded')).toBe('false');

    header.dispatchEvent(new Event('click', { bubbles: true }));
    expect(header.getAttribute('aria-expanded')).toBe('true');

    header.dispatchEvent(new Event('click', { bubbles: true }));
    expect(header.getAttribute('aria-expanded')).toBe('false');
  });

  it('points each row at the panel it opens', () => {
    const header = firstRowHeader();
    const panel = header.parentElement!.querySelector('.stat-expanded')!;

    expect(panel.id).toBeTruthy();
    expect(header.getAttribute('aria-controls')).toBe(panel.id);
  });

  it('says which filters are on', () => {
    const core = document.querySelector('[data-band="core"]')!;
    expect(core.getAttribute('aria-pressed')).toBe('false');

    core.dispatchEvent(new Event('click', { bubbles: true }));
    expect(core.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('StatsManager clearing', () => {
  let document: Document;
  let clearBtn: HTMLButtonElement;

  beforeEach(() => {
    vi.clearAllMocks();
    document = new DOMParser().parseFromString(HTML, 'text/html');
    new StatsManager(document, createClient(), storage).init();
    clearBtn = document.getElementById('clear-btn') as HTMLButtonElement;
  });

  function click(): void {
    clearBtn.dispatchEvent(new Event('click', { bubbles: true }));
  }

  it('asks before clearing rather than clearing on the first press', () => {
    click();

    expect(storage.clearStatistics).not.toHaveBeenCalled();
    expect(clearBtn.textContent).toBe('Clear everything?');
    expect(clearBtn.classList.contains('is-armed')).toBe(true);
  });

  it('clears on the second press', () => {
    click();
    click();

    expect(storage.clearStatistics).toHaveBeenCalledTimes(1);
    expect(clearBtn.textContent).toBe('Clear Statistics');
  });

  it('stands down when the button loses focus', () => {
    click();
    clearBtn.dispatchEvent(new Event('blur', { bubbles: true }));
    click();

    expect(storage.clearStatistics).not.toHaveBeenCalled();
    expect(clearBtn.textContent).toBe('Clear everything?');
  });
});

describe('StatsManager empty list', () => {
  let document: Document;

  function emptyText(): string {
    return document.getElementById('empty-state')!.querySelector('p')!.textContent ?? '';
  }

  function clickTab(selector: string): void {
    document.querySelector(selector)!.dispatchEvent(new Event('click', { bubbles: true }));
  }

  beforeEach(() => {
    document = new DOMParser().parseFromString(HTML, 'text/html');
    new StatsManager(document, createClient(), storage).init();
  });

  // The two rows narrow the list together, so naming them with one "or"
  // described a filter the page never applies.
  it('names the stage and the band as the one filter they are', () => {
    clickTab('[data-stage="mastered"]');
    expect(emptyText()).toBe('No Mastered words yet.');

    clickTab('[data-band="rare"]');
    expect(emptyText()).toBe('No Mastered words in Rare yet.');
  });

  it('puts its own copy back when the filter is lifted', () => {
    clickTab('[data-stage="mastered"]');
    clickTab('[data-stage="mastered"]');
    clickTab('[data-band="uncommon"]');

    expect(emptyText()).toBe('No Uncommon words yet.');
  });

  it('offers the way back out of a filter that hides everything', () => {
    clickTab('[data-stage="mastered"]');
    const reset = document.querySelector('.empty-state-reset') as HTMLButtonElement;
    expect(reset).toBeTruthy();

    reset.dispatchEvent(new Event('click', { bubbles: true }));

    expect(document.getElementById('stats-list')!.style.display).toBe('flex');
    expect(document.querySelector('.empty-state-reset')).toBeNull();
  });

  // Seen but not enrolled is the state the reader acts on: the pill is how a
  // word gets from "looked up a couple of times" into the deck.
  it('narrows to words seen too rarely to have enrolled themselves', () => {
    clickTab('[data-stage="candidate"]');

    const words = Array.from(document.querySelectorAll('.stat-word'), el => el.textContent);
    expect(words).toEqual(['少見']);
  });

  it('offers Study this on a candidate row', () => {
    clickTab('[data-stage="candidate"]');

    const actions = Array.from(document.querySelectorAll('.stat-action'), el => el.textContent);
    expect(actions).toContain('Study this');
  });

  // Without this the page reports "No statistics yet" over a record full of
  // words, and the only filter hiding them is the one that is on by default.
  it('names the retired filter when it is what emptied the list', () => {
    const retiredOnly = new DOMParser().parseFromString(HTML, 'text/html');
    const client: StatsClient = {
      ...createClient(),
      getStatistics: vi.fn(cb =>
        cb({
          success: true,
          type: 'get_statistics',
          statistics: { 退休: { count: 5, firstSeen: 1, lastSeen: 200, suppressed: true } },
        })
      ),
    };
    new StatsManager(retiredOnly, client, storage).init();

    const emptyState = retiredOnly.getElementById('empty-state')!;
    expect(emptyState.querySelector('p')!.textContent).toBe('Every word tracked so far is retired.');

    (emptyState.querySelector('.empty-state-reset') as HTMLButtonElement)
      .dispatchEvent(new Event('click', { bubbles: true }));

    expect(retiredOnly.getElementById('stats-list')!.style.display).toBe('flex');
  });

  it('dims a pill that holds no words', () => {
    expect(document.querySelector('[data-stage="mastered"]')!.classList.contains('is-empty'))
      .toBe(true);
    expect(document.querySelector('[data-stage="new"]')!.classList.contains('is-empty'))
      .toBe(false);
  });

  // Statistics are loaded again after a clear; a second listener on each row
  // would toggle a filter on and straight back off.
  it('wires each row of pills once however often the record is loaded', () => {
    const reloaded = new DOMParser().parseFromString(HTML, 'text/html');
    const manager = new StatsManager(reloaded, createClient(), storage);
    manager.init();
    manager.init();

    reloaded
      .querySelector('[data-band="core"]')!
      .dispatchEvent(new Event('click', { bubbles: true }));

    expect(reloaded.querySelector('[data-band="core"]')!.classList.contains('active')).toBe(true);
  });
});

describe('StatsManager row status', () => {
  let document: Document;
  let client: StatsClient;

  function row(word: string): HTMLElement {
    return document
      .getElementById('stats-list')!
      .querySelector(`.stat-item[data-word="${word}"]`) as HTMLElement;
  }

  function openRow(word: string): HTMLElement {
    const item = row(word);
    (item.querySelector('.stat-header') as HTMLButtonElement)
      .dispatchEvent(new Event('click', { bubbles: true }));
    return item;
  }

  function press(item: HTMLElement, action: string): void {
    (item.querySelector(`[data-action="${action}"]`) as HTMLButtonElement)
      .dispatchEvent(new Event('click', { bubbles: true }));
  }

  /** Retired words are filtered out by default, which would take the row away. */
  function showRetired(): void {
    document.querySelector('[data-status="retired"]')!
      .dispatchEvent(new Event('click', { bubbles: true }));
  }

  beforeEach(() => {
    document = new DOMParser().parseFromString(HTML, 'text/html');
    client = createClient();
    new StatsManager(document, client, storage).init();
  });

  // The buttons live inside the row's own panel, so rebuilding the list took
  // the panel down with it — the reader lost the definition they had open to
  // the press they made while reading it.
  it('leaves the row open when a word is retired', () => {
    showRetired();
    const item = openRow('常見');
    press(item, 'retire');

    const header = item.querySelector('.stat-header')!;
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(item.querySelector<HTMLElement>('.stat-expanded')!.style.display).toBe('block');
    expect(item.querySelector('[data-action="retire"]')!.textContent).toBe('Retired');
  });

  // The badge is what a reader scrolling the list has to go on; the button
  // saying "Retired" is two clicks away inside the row.
  it('marks a retired word on its collapsed row', () => {
    showRetired();

    expect(row('退休').querySelector('.stage-badge--retired')!.textContent).toBe('Retired');
    expect(row('常見').querySelector('.stage-badge--retired')).toBeNull();

    press(openRow('常見'), 'retire');
    expect(row('常見').querySelector('.stage-badge--retired')!.textContent).toBe('Retired');
  });

  it('takes the retired badge off a word put back in the deck', () => {
    showRetired();
    const item = openRow('退休');
    press(item, 'retire');

    expect(row('退休').querySelector('.stage-badge--retired')).toBeNull();
    expect(row('退休').querySelector('.stage-badge')!.textContent).toBe('New');
  });

  it('asks for the opposite on the next press', () => {
    showRetired();
    const item = openRow('常見');
    press(item, 'retire');
    press(item, 'retire');

    expect(vi.mocked(client.setWordStatus).mock.calls.map(call => call[1])).toEqual([
      { suppressed: true },
      { suppressed: false },
    ]);
    expect(item.querySelector('[data-action="retire"]')!.textContent).toBe('I know this');
  });

  it('redraws the stage the word now counts towards', () => {
    const item = openRow('少見');
    expect(item.querySelector('.stage-badge')!.textContent).toBe('Candidate');

    press(item, 'study');
    expect(row('少見').querySelector('.stage-badge')!.textContent).toBe('New');
    expect(document.getElementById('overview-retired')!.textContent).toBe('1');
  });

  // The pills promise the list holds that stage and nothing else, so a word the
  // press moves out of one is rebuilt away, open panel or not.
  it('rebuilds the list when the press moves the word out of the filter', () => {
    document.querySelector('[data-stage="candidate"]')!
      .dispatchEvent(new Event('click', { bubbles: true }));

    press(openRow('少見'), 'study');

    expect(document.getElementById('stats-list')!.style.display).toBe('none');
    expect(document.getElementById('empty-state')!.style.display).toBe('block');
  });

  // Retiring is the one press that always moves a word out of the default
  // filter, so the row cannot be kept in place the way the others are.
  it('takes the row away when retiring hides the word', () => {
    press(openRow('常見'), 'retire');

    expect(row('常見')).toBeNull();
  });
});
