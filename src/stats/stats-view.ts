import type {
  ContextSighting,
  FlashcardStage,
  FrequencyBand,
  ReviewLog,
  WordStatistics,
  LookupResponse,
  ErrorResponse,
  Statistics,
  WordStatus,
} from '../shared/types.js';
import { getFlashcardStage } from '../shared/statistics-utils.js';
import { createElement, setMultilineText } from '../shared/dom-element.js';
import { CHEVRON_SVG, createIcon } from '../shared/icons.js';
import { createDefinitionElement } from '../shared/definition-section.js';
import { createContextList } from '../shared/context-sentence.js';
import { BAND_LABELS } from '../shared/frequency.js';
import { MAX_TRACKED_WORDS } from '../shared/statistics-store.js';
import { DEFAULT_SETTINGS, type DisplaySettings } from '../shared/settings.js';
import { bandOf, sortWords, SORT_LABELS, type SortKey } from './ordering.js';
import type { StudyOverview } from './overview.js';
import {
  activityDays,
  activityLevel,
  currentStreak,
  ACTIVITY_LEVELS,
  ACTIVITY_WEEKS,
  FORECAST_DAYS,
  type BandCoverage,
  type DirectionRetention,
  type ForecastDay,
} from './insights.js';

export const ELEMENT_IDS = {
  loading: 'loading',
  emptyState: 'empty-state',
  statsList: 'stats-list',
  wordCount: 'word-count',
  clearBtn: 'clear-btn',
  flashcardBtn: 'flashcard-btn',
  settingsBtn: 'settings-btn',
  filterTabs: 'filter-tabs',
  bandTabs: 'band-tabs',
  statusTabs: 'status-tabs',
  sortSelect: 'sort-select',
} as const;

const OVERVIEW_IDS = {
  dueNow: 'overview-due-now',
  dueToday: 'overview-due-today',
  accuracy: 'overview-accuracy',
  reviews: 'overview-reviews',
  retired: 'overview-retired',
} as const;

/** Gives each row's panel an id its header can point `aria-controls` at. */
let panelCount = 0;

const STAGE_LABELS: Record<FlashcardStage, string> = {
  candidate: 'Candidate',
  new: 'New',
  learning: 'Learning',
  familiar: 'Familiar',
  mastered: 'Mastered',
};

export interface StatsElements {
  loadingEl: HTMLElement;
  emptyStateEl: HTMLElement;
  statsListEl: HTMLElement;
  wordCountEl: HTMLElement;
  filterTabsEl: HTMLElement;
  bandTabsEl: HTMLElement;
  statusTabsEl: HTMLElement;
  sortSelectEl: HTMLSelectElement;
}

/** Every way the list can be narrowed or ordered, as the page currently has it. */
export interface ListView {
  stages: Set<FlashcardStage>;
  bands: Set<FrequencyBand>;
  /**
   * The one filter that is on by default. A retired word was removed from the
   * deck on purpose, so leaving it in the list pads the very list the reader
   * uses to decide what to study next.
   */
  showRetired: boolean;
  sort: SortKey;
  /**
   * The reader's enrolment threshold. It decides which words are Candidates,
   * so the pills and badges have to count with the value the deck uses.
   */
  minCount?: number;
}

function stageOf(stat: WordStatistics, view: ListView): FlashcardStage {
  return getFlashcardStage(stat, undefined, view.minCount);
}

/** Lazily loads and renders a word's definition into its expanded container. */
export type LoadDefinition = (word: string, container: HTMLElement) => void;

/** Records a decision the reader made about a word, then re-renders the list. */
export type SetWordStatus = (word: string, status: WordStatus) => void;

export function getRequiredElements(document: Document): StatsElements | null {
  const loadingEl = document.getElementById(ELEMENT_IDS.loading);
  const emptyStateEl = document.getElementById(ELEMENT_IDS.emptyState);
  const statsListEl = document.getElementById(ELEMENT_IDS.statsList);
  const wordCountEl = document.getElementById(ELEMENT_IDS.wordCount);
  const filterTabsEl = document.getElementById(ELEMENT_IDS.filterTabs);
  const bandTabsEl = document.getElementById(ELEMENT_IDS.bandTabs);
  const statusTabsEl = document.getElementById(ELEMENT_IDS.statusTabs);
  const sortSelectEl = document.getElementById(ELEMENT_IDS.sortSelect);

  if (
    !loadingEl ||
    !emptyStateEl ||
    !statsListEl ||
    !wordCountEl ||
    !filterTabsEl ||
    !bandTabsEl ||
    !statusTabsEl ||
    !(sortSelectEl instanceof HTMLSelectElement)
  ) {
    console.error('[Stats] Required DOM elements not found!');
    return null;
  }

  return {
    loadingEl,
    emptyStateEl,
    statsListEl,
    wordCountEl,
    filterTabsEl,
    bandTabsEl,
    statusTabsEl,
    sortSelectEl,
  };
}

/**
 * Fills the sort control from the comparators that back it, so a label can
 * never name an order the list does not actually sort by.
 */
export function renderSortOptions(sortSelectEl: HTMLSelectElement): void {
  sortSelectEl.replaceChildren();

  for (const [key, label] of Object.entries(SORT_LABELS)) {
    sortSelectEl.appendChild(
      createElement<HTMLOptionElement>({
        tag: 'option',
        attributes: { value: key },
        textContent: label,
      })
    );
  }
}

/**
 * The numbers that say what to do next, rather than what has been read. Drawn
 * from the whole record, so filtering the list below does not change them.
 */
export function renderOverview(document: Document, overview: StudyOverview): void {
  const values: Record<string, string> = {
    [OVERVIEW_IDS.dueNow]: String(overview.dueNow),
    [OVERVIEW_IDS.dueToday]: String(overview.dueToday),
    [OVERVIEW_IDS.accuracy]:
      overview.accuracy === undefined ? '—' : `${Math.round(overview.accuracy * 100)}%`,
    [OVERVIEW_IDS.reviews]: String(overview.reviews),
    [OVERVIEW_IDS.retired]: String(overview.retired),
  };

  for (const [id, value] of Object.entries(values)) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }
}

export function showError(loadingEl: HTMLElement, message: string): void {
  loadingEl.textContent = message;
  // A class rather than an inline hex: the hardcoded red stayed red on the
  // dark canvas, and nothing ever cleared it again.
  loadingEl.classList.add('is-error');
}

/**
 * Stage and band counts are tallied over the words the retired filter lets
 * through, so a pill never promises rows the list will not show. The retired
 * count is the exception: it says what pressing it would reveal.
 */
export function updateFilterCounts(
  elements: StatsElements,
  statistics: Statistics,
  view: ListView,
): void {
  const stages: Record<FlashcardStage, number> =
    { candidate: 0, new: 0, learning: 0, familiar: 0, mastered: 0 };
  const bands: Record<FrequencyBand, number> =
    { core: 0, common: 0, frequent: 0, uncommon: 0, rare: 0 };
  let retired = 0;

  for (const stat of Object.values(statistics)) {
    if (stat.suppressed) {
      retired++;
      if (!view.showRetired) continue;
    }

    stages[stageOf(stat, view)]++;
    bands[bandOf(stat)]++;
  }

  for (const [stage, count] of Object.entries(stages)) {
    setTabCount(elements.filterTabsEl, stage, count);
  }

  for (const [band, count] of Object.entries(bands)) {
    setTabCount(elements.bandTabsEl, band, count);
  }

  setTabCount(elements.statusTabsEl, 'retired', retired);
}

/**
 * A pill holding no words narrows the list to nothing, so it reads as spent
 * rather than as another cut worth trying. It stays clickable: the count moves
 * as words are studied, and a disabled control would have to be explained.
 */
function setTabCount(tabsEl: HTMLElement, value: string, count: number): void {
  const el = tabsEl.querySelector(`#count-${value}`);
  if (!el) return;

  el.textContent = String(count);
  el.closest('.filter-tab')?.classList.toggle('is-empty', count === 0);
}

function updateTabStates(tabsEl: HTMLElement, key: string, active: ReadonlySet<string>): void {
  tabsEl.querySelectorAll('.filter-tab').forEach(tab => {
    const value = (tab as HTMLElement).dataset[key];
    const on = value !== undefined && active.has(value);
    tab.classList.toggle('active', on);
    // The pills are toggles, not links: without this the state they carry is
    // colour alone, which a screen reader never sees.
    tab.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

export function updateFilterTabStates(elements: StatsElements, view: ListView): void {
  updateTabStates(elements.filterTabsEl, 'stage', view.stages as ReadonlySet<string>);
  updateTabStates(elements.bandTabsEl, 'band', view.bands as ReadonlySet<string>);
  updateTabStates(elements.statusTabsEl, 'status', new Set(view.showRetired ? ['retired'] : []));
  elements.sortSelectEl.value = view.sort;
}

/** The markup's own copy, restored whenever the record really is empty. */
const NOTHING_TRACKED =
  'No statistics yet.\nStart hovering over Chinese words on web pages to track them.';

const FILTER_RESET_CLASS = 'empty-state-reset';

/** Puts the way out of a filter that hides everything, or takes it away again. */
function setFilterReset(emptyStateEl: HTMLElement, clearFilters: (() => void) | undefined): void {
  emptyStateEl.querySelector(`.${FILTER_RESET_CLASS}`)?.remove();
  if (!clearFilters) return;

  emptyStateEl.appendChild(
    createElement<HTMLButtonElement>({
      tag: 'button',
      className: FILTER_RESET_CLASS,
      textContent: 'Show all words',
      attributes: { type: 'button' },
      listeners: { click: () => clearFilters() },
    })
  );
}

function matchesView(stat: WordStatistics, view: ListView): boolean {
  if (stat.suppressed && !view.showRetired) return false;
  if (view.stages.size > 0 && !view.stages.has(stageOf(stat, view))) return false;
  if (view.bands.size > 0 && !view.bands.has(bandOf(stat))) return false;
  return true;
}

/**
 * The tracked total, and the cap it is heading for. Words are evicted silently
 * once the record is full, so the number is worth showing before it bites.
 */
function describeTotal(total: number): string {
  const words = `${total.toLocaleString()} ${total === 1 ? 'word' : 'words'} tracked`;
  return total >= MAX_TRACKED_WORDS * 0.8
    ? `${words} of ${MAX_TRACKED_WORDS.toLocaleString()}`
    : words;
}

/**
 * Why the list is empty. The two filter rows are ANDed, so naming them with a
 * single "or" described a narrowing the page never applies.
 */
function noMatchMessage(view: ListView): string {
  const stages = [...view.stages].map(stage => STAGE_LABELS[stage]).join(' or ');
  const bands = [...view.bands].map(band => BAND_LABELS[band]).join(' or ');

  if (stages && bands) return `No ${stages} words in ${bands} yet.`;
  if (stages) return `No ${stages} words yet.`;
  if (bands) return `No ${bands} words yet.`;
  if (!view.showRetired) return 'Every word tracked so far is retired.';

  // An unfiltered list with words in it is never empty.
  return NOTHING_TRACKED;
}

/**
 * The empty state is the same element whichever emptiness it is reporting, so
 * its copy is rewritten each time rather than edited once and left behind.
 */
function setEmptyMessage(emptyStateEl: HTMLElement, message: string): void {
  const paragraph = emptyStateEl.querySelector('p');
  if (paragraph) setMultilineText(paragraph, message);
}

export function renderStatistics(
  statistics: Statistics,
  elements: StatsElements,
  loadDefinition: LoadDefinition,
  view: ListView,
  setStatus: SetWordStatus,
  clearFilters: () => void,
): void {
  const { loadingEl, emptyStateEl, statsListEl, wordCountEl } = elements;
  const allWords = Object.keys(statistics);

  loadingEl.style.display = 'none';

  if (allWords.length === 0) {
    emptyStateEl.style.display = 'block';
    statsListEl.style.display = 'none';
    wordCountEl.textContent = '0 words tracked';
    setEmptyMessage(emptyStateEl, NOTHING_TRACKED);
    setFilterReset(emptyStateEl, undefined);
    return;
  }

  const filtered = allWords.filter(word => {
    const stat = statistics[word];
    return stat !== undefined && matchesView(stat, view);
  });

  const empty = filtered.length === 0;
  emptyStateEl.style.display = empty ? 'block' : 'none';
  statsListEl.style.display = empty ? 'none' : 'flex';
  wordCountEl.textContent = describeTotal(allWords.length);

  // The words are there; a filter is hiding them, so the way back is offered
  // rather than left to be found among nine pills.
  setFilterReset(emptyStateEl, empty ? clearFilters : undefined);

  if (empty) {
    setEmptyMessage(emptyStateEl, noMatchMessage(view));
    return;
  }

  statsListEl.replaceChildren();

  sortWords(filtered, statistics, view.sort).forEach(word => {
    const stat = statistics[word];
    if (!stat) return;
    statsListEl.appendChild(createStatItem(word, stat, stageOf(stat, view), loadDefinition, setStatus));
  });
}

/** Loading placeholder shown while a definition request is in flight. */
export function renderDefinitionLoading(container: HTMLElement): void {
  container.replaceChildren();
  container.appendChild(createElement({
    className: 'stat-loading',
    textContent: 'Loading definition...'
  }));
  container.style.display = 'block';
}

export function renderDefinition(
  container: HTMLElement,
  response: LookupResponse | ErrorResponse | undefined,
  word: string,
  contexts: readonly ContextSighting[] = [],
  display: DisplaySettings = DEFAULT_SETTINGS,
): void {
  container.replaceChildren();
  if (contexts.length > 0) container.appendChild(createContextList(word, contexts));

  if (!response || !response.success || !response.definition) {
    container.appendChild(createElement({
      className: 'stat-error',
      textContent: 'Something went wrong'
    }));
    return;
  }

  container.appendChild(createDefinitionElement(word, response.definition, false, { display }));
  container.dataset.loaded = 'true';
}

function createStageBadge(stage: FlashcardStage): HTMLElement {
  return createElement({
    tag: 'span',
    className: `stage-badge stage-badge--${stage}`,
    textContent: STAGE_LABELS[stage],
  });
}

/**
 * A retired word keeps the stage its progress earned, so retirement is drawn
 * beside that stage rather than in place of it — and on the collapsed row,
 * since a status only the open panel admits to is one the reader has to hunt
 * for a word at a time.
 */
function createRetiredBadge(): HTMLElement {
  return createElement({
    tag: 'span',
    className: 'stage-badge stage-badge--retired',
    textContent: 'Retired',
  });
}

/**
 * Retiring and choosing are the two things the reader can say about a word
 * that hovering cannot: that they already know it, and that they want it
 * studied sooner than the exposure gate would allow.
 */
interface ActionCopy {
  on: { label: string; title: string };
  off: { label: string; title: string };
}

const STUDY_COPY: ActionCopy = {
  on: { label: 'Studying', title: 'Stop prioritising this word' },
  off: { label: 'Study this', title: 'Add this word to the deck now' },
};

const RETIRE_COPY: ActionCopy = {
  on: { label: 'Retired', title: 'Put this word back in the deck' },
  off: { label: 'I know this', title: 'Stop reviewing this word' },
};

/**
 * The button as the flag currently stands. It is painted rather than rebuilt so
 * a press can repaint the row it is in without replacing the pressed button —
 * which would drop the focus that reached it.
 */
function paintAction(button: HTMLButtonElement, copy: ActionCopy, on: boolean): void {
  const text = on ? copy.on : copy.off;

  button.className = `stat-action${on ? ' stat-action--on' : ''}`;
  button.textContent = text.label;
  button.title = text.title;
  // The press reads the flag back off the button, so repainting is enough to
  // change what the next press asks for.
  button.dataset.on = String(on);
}

function createAction(
  action: string,
  copy: ActionCopy,
  on: boolean,
  press: (next: boolean) => void,
): HTMLButtonElement {
  const button = createElement<HTMLButtonElement>({
    tag: 'button',
    dataset: { action },
    listeners: {
      click: (event: Event) => {
        event.stopPropagation();
        press(button.dataset.on !== 'true');
      },
    },
  });

  paintAction(button, copy, on);
  return button;
}

function createStatusControls(
  word: string,
  stat: WordStatistics,
  setStatus: SetWordStatus,
): HTMLElement {
  const study = createAction(
    'study',
    STUDY_COPY,
    stat.pinned === true,
    next => setStatus(word, { pinned: next }),
  );

  const know = createAction(
    'retire',
    RETIRE_COPY,
    stat.suppressed === true,
    next => setStatus(word, { suppressed: next }),
  );

  return createElement({ className: 'stat-actions', children: [study, know] });
}

/**
 * One row brought up to date with the record, leaving the rest of the list —
 * and the open panel the buttons live in — where they are. A press that moves
 * the word out of the current filter is not this function's to draw: it reports
 * false and the caller rebuilds.
 */
export function refreshStatRow(
  elements: StatsElements,
  word: string,
  stat: WordStatistics,
  view: ListView,
): boolean {
  const item = Array.from(elements.statsListEl.children).find(
    child => (child as HTMLElement).dataset.word === word,
  ) as HTMLElement | undefined;

  if (!item || !matchesView(stat, view)) return false;

  item
    .querySelector('.stage-badge:not(.stage-badge--retired)')
    ?.replaceWith(createStageBadge(stageOf(stat, view)));

  const retiredBadge = item.querySelector('.stage-badge--retired');
  if (stat.suppressed === true) {
    if (!retiredBadge) item.querySelector('.stat-word-row')?.appendChild(createRetiredBadge());
  } else {
    retiredBadge?.remove();
  }

  const study = item.querySelector<HTMLButtonElement>('[data-action="study"]');
  const know = item.querySelector<HTMLButtonElement>('[data-action="retire"]');
  if (!study || !know) return false;

  paintAction(study, STUDY_COPY, stat.pinned === true);
  paintAction(know, RETIRE_COPY, stat.suppressed === true);
  return true;
}

function createStatItem(
  word: string,
  stat: WordStatistics,
  stage: FlashcardStage,
  loadDefinition: LoadDefinition,
  setStatus: SetWordStatus,
): HTMLElement {
  const item = createElement({
    className: 'stat-item',
    dataset: { word }
  });

  // A real button: the row is the page's main control, and as a div it could
  // be reached by neither Tab nor Enter.
  const panelId = `stat-panel-${++panelCount}`;
  const header = createElement<HTMLButtonElement>({
    tag: 'button',
    className: 'stat-header',
    attributes: { type: 'button', 'aria-expanded': 'false', 'aria-controls': panelId },
  });

  const wordRow = createElement({
    className: 'stat-word-row',
    children: [
      createElement({ className: 'stat-word', textContent: word, attributes: { lang: 'zh' } }),
      createStageBadge(stage),
      ...(stat.suppressed === true ? [createRetiredBadge()] : []),
    ],
  });

  const expandIcon = createIcon(CHEVRON_SVG, { className: 'stat-expand-icon' });

  const count = stat.count || 0;
  const detailsEl = createElement({
    className: 'stat-details',
    children: [
      createElement({
        className: 'stat-count',
        textContent: String(count)
      }),
      createElement({
        className: 'stat-label',
        textContent: count === 1 ? 'time studied' : 'times studied'
      }),
      expandIcon
    ]
  });

  header.appendChild(wordRow);
  header.appendChild(detailsEl);

  // The definition is rendered into a container of its own, so re-rendering it
  // cannot take the row's controls with it.
  const definitionEl = createElement({ className: 'stat-definition' });
  const expandedContent = createElement({
    id: panelId,
    className: 'stat-expanded',
    style: { display: 'none' },
    children: [definitionEl, createStatusControls(word, stat, setStatus)],
  });

  item.appendChild(header);
  item.appendChild(expandedContent);

  header.addEventListener('click', () => {
    toggleExpansion(item, header, word, expandedContent, definitionEl, loadDefinition);
  });

  return item;
}

function toggleExpansion(
  item: HTMLElement,
  header: HTMLElement,
  word: string,
  expandedContent: HTMLElement,
  definitionEl: HTMLElement,
  loadDefinition: LoadDefinition
): void {
  const isExpanded = expandedContent.style.display !== 'none';

  if (isExpanded) {
    expandedContent.style.display = 'none';
    item.classList.remove('expanded');
  } else {
    expandedContent.style.display = 'block';
    if (!definitionEl.dataset.loaded) loadDefinition(word, definitionEl);
    item.classList.add('expanded');
  }

  header.setAttribute('aria-expanded', isExpanded ? 'false' : 'true');
}

export const INSIGHT_IDS = {
  forecastHeadline: 'forecast-headline',
  forecastBody: 'forecast-body',
  activityHeadline: 'activity-headline',
  activityBody: 'activity-body',
  retentionHeadline: 'retention-headline',
  retentionBody: 'retention-body',
  coverageHeadline: 'coverage-headline',
  coverageBody: 'coverage-body',
} as const;

/**
 * Fills one collapsible section. The headline sits in the summary, so a
 * section still says its one thing while closed — which is how the popup
 * shows it.
 */
function fillInsight(
  document: Document,
  headlineId: string,
  bodyId: string,
  headline: string,
  body: HTMLElement[],
): void {
  const headlineEl = document.getElementById(headlineId);
  const bodyEl = document.getElementById(bodyId);
  if (headlineEl) headlineEl.textContent = headline;
  bodyEl?.replaceChildren(...body);
}

function insightNote(text: string, className = 'insight-note'): HTMLElement {
  return createElement({ tag: 'p', className, textContent: text });
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

function describeDay(start: number): string {
  return new Date(start).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/**
 * Bars rather than a list of dates: the question is the shape — a quiet week
 * or a pile-up on Thursday — and a column per day answers it at a glance. Only
 * the peak is labelled; every bar names its day and count on hover.
 */
export function renderForecast(document: Document, days: ForecastDay[]): void {
  const total = days.reduce((sum, day) => sum + day.count, 0);

  if (total === 0) {
    fillInsight(document, INSIGHT_IDS.forecastHeadline, INSIGHT_IDS.forecastBody, 'Nothing scheduled', [
      insightNote('No card has a review date yet. Rate a flashcard and its next one lands here.', 'insight-empty'),
    ]);
    return;
  }

  const max = Math.max(...days.map(day => day.count));
  const peak = days.findIndex(day => day.count === max);

  const bars = days.map((day, i) => {
    const label = `${i === 0 ? 'Today' : describeDay(day.start)}: ${plural(day.count, 'card')}`;

    return createElement({
      tag: 'li',
      className: 'forecast-day',
      attributes: { title: label, 'aria-label': label },
      children: [
        createElement({
          className: 'forecast-value',
          textContent: i === peak ? String(day.count) : '',
        }),
        createElement({
          className: 'forecast-track',
          children: [
            createElement({
              className: day.count > 0 ? 'forecast-bar' : 'forecast-bar is-zero',
              style: { height: `${(day.count / max) * 100}%` },
            }),
          ],
        }),
        createElement({
          className: 'forecast-label',
          textContent: i === 0 ? 'Today' : String(new Date(day.start).getDate()),
          attributes: { 'aria-hidden': 'true' },
        }),
      ],
    });
  });

  fillInsight(
    document,
    INSIGHT_IDS.forecastHeadline,
    INSIGHT_IDS.forecastBody,
    `${plural(total, 'card')} in ${FORECAST_DAYS} days`,
    [
      createElement({
        tag: 'ol',
        className: 'forecast',
        attributes: { 'aria-label': `Cards due on each of the next ${FORECAST_DAYS} days` },
        children: bars,
      }),
      insightNote('Today includes every card already overdue.'),
    ],
  );
}

/**
 * The streak and a calendar of past study. Nothing was logged by day before
 * the log existed, so an empty log is said to be empty rather than drawn as
 * months of rest days the reader may well have spent studying.
 */
export function renderActivity(
  document: Document,
  log: ReviewLog | undefined,
  now: number = Date.now(),
): void {
  const { activityHeadline, activityBody } = INSIGHT_IDS;

  if (!log) {
    fillInsight(document, activityHeadline, activityBody, '', [
      insightNote('Review history could not be loaded.', 'insight-empty'),
    ]);
    return;
  }

  const logged = Object.values(log).some(count => count > 0);
  if (!logged) {
    fillInsight(document, activityHeadline, activityBody, 'No reviews logged yet', [
      insightNote(
        'Reviews are counted by day from now on. Earlier study was not recorded by day, so the calendar starts empty.',
        'insight-empty',
      ),
    ]);
    return;
  }

  const streak = currentStreak(log, now);
  const days = activityDays(log, now);
  const max = Math.max(...days.map(day => day.count));
  const shown = days.reduce((sum, day) => sum + day.count, 0);

  const cells = days.map(day => {
    const label = `${day.key}: ${plural(day.count, 'review')}`;
    return createElement({
      className: `activity-cell activity-cell--${activityLevel(day.count, max)}`,
      attributes: { title: label },
    });
  });

  const legend = createElement({
    className: 'activity-legend',
    attributes: { 'aria-hidden': 'true' },
    children: [
      'Less',
      ...Array.from({ length: ACTIVITY_LEVELS + 1 }, (_, level) =>
        createElement({ className: `activity-cell activity-cell--${level}` }),
      ),
      'More',
    ],
  });

  fillInsight(
    document,
    activityHeadline,
    activityBody,
    streak > 0 ? `${streak}-day streak` : 'No current streak',
    [
      createElement({
        className: 'activity-grid',
        attributes: {
          role: 'img',
          'aria-label': `${plural(shown, 'review')} over the last ${ACTIVITY_WEEKS} weeks`,
        },
        children: cells,
      }),
      legend,
      insightNote(`${plural(shown, 'review')} in the last ${ACTIVITY_WEEKS} weeks`),
    ],
  );
}

/** Each direction's own name, so a card added later is labelled without an edit here. */
function directionLabel(direction: string): string {
  return direction.charAt(0).toUpperCase() + direction.slice(1);
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function meterRow(label: string, fraction: number | undefined, value: string): HTMLElement {
  return createElement({
    className: 'meter-row',
    children: [
      createElement({ className: 'meter-label', textContent: label }),
      createElement({
        className: 'meter-track',
        children: fraction === undefined || fraction <= 0 ? [] : [
          createElement({
            className: 'meter-fill',
            style: { width: `${Math.min(fraction, 1) * 100}%` },
          }),
        ],
      }),
      createElement({ className: 'meter-value', textContent: value }),
    ],
  });
}

export function renderRetention(document: Document, retention: DirectionRetention[]): void {
  const reviewed = retention.filter(entry => entry.accuracy !== undefined);

  // The weakest direction is the one worth naming, but only once there is
  // another to compare it with.
  const weakest = reviewed.length > 1
    ? reviewed.reduce((low, entry) => (entry.accuracy! < low.accuracy! ? entry : low))
    : undefined;

  const rows = retention.map(entry => meterRow(
    directionLabel(entry.direction),
    entry.accuracy,
    entry.accuracy === undefined
      ? 'No reviews yet'
      : `${percent(entry.accuracy)} of ${entry.reviews.toLocaleString()}`,
  ));

  fillInsight(
    document,
    INSIGHT_IDS.retentionHeadline,
    INSIGHT_IDS.retentionBody,
    weakest ? `Weakest: ${directionLabel(weakest.direction)} ${percent(weakest.accuracy!)}` : '',
    [...rows, insightNote('Share of answers rated Good or Easy, retired words aside.')],
  );
}

export function renderCoverage(document: Document, coverage: BandCoverage[]): void {
  const known = coverage.reduce((sum, entry) => sum + entry.known, 0);

  const rows = coverage.map(entry => meterRow(
    BAND_LABELS[entry.band],
    entry.size === undefined ? undefined : entry.known / entry.size,
    entry.size === undefined
      ? `${entry.known.toLocaleString()} known`
      : `${entry.known.toLocaleString()} / ${entry.size.toLocaleString()}`,
  ));

  fillInsight(
    document,
    INSIGHT_IDS.coverageHeadline,
    INSIGHT_IDS.coverageBody,
    `${plural(known, 'word')} known`,
    [
      ...rows,
      insightNote(
        'Known means its recognition card is Familiar or Mastered, or you retired it. ' +
        'A word buried for being forgotten does not count.',
      ),
    ],
  );
}

