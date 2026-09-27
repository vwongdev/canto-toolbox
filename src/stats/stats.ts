import type { Statistics, WordStatus } from '../shared/types.js';
import { statsClient, type StatsClient } from './stats-client.js';
import { statsStorage, type StatsStorage } from './stats-storage.js';
import {
  ELEMENT_IDS,
  getRequiredElements,
  showError,
  renderStatistics,
  renderDefinitionLoading,
  renderDefinition,
  renderOverview,
  renderActivity,
  renderCoverage,
  renderForecast,
  renderRetention,
  renderSortOptions,
  refreshStatRow,
  updateFilterCounts,
  updateFilterTabStates,
  type ListView,
  type StatsElements
} from './stats-view.js';
import { summarise } from './overview.js';
import { bandCoverage, forecast, retentionByDirection } from './insights.js';
import { DEFAULT_SORT, isSortKey } from './ordering.js';
import { applyWordStatus } from '../shared/statistics-utils.js';
import { contextsOf } from '../shared/word-contexts.js';
import { TransferControls } from './transfer-controls.js';
import { DEFAULT_SETTINGS, watchSettings, type Settings } from '../shared/settings.js';

const CLEAR_LABEL = 'Clear Statistics';
const CLEAR_CONFIRM_LABEL = 'Clear everything?';
const CLEAR_FAILED_LABEL = 'Could not clear';

/** How long the armed button waits for the second press before standing down. */
const CLEAR_CONFIRM_MS = 5000;

export class StatsManager {
  private readonly document: Document;
  private readonly client: StatsClient;
  private readonly storage: StatsStorage;
  private cachedStatistics: Statistics | null = null;
  private controlsReady = false;
  private view: ListView =
    { stages: new Set(), bands: new Set(), showRetired: false, sort: DEFAULT_SORT };
  private settings: Settings = DEFAULT_SETTINGS;

  constructor(document: Document, client: StatsClient, storage: StatsStorage) {
    this.document = document;
    this.client = client;
    this.storage = storage;
  }

  /**
   * The threshold decides which words are Candidates, so a change redraws the
   * list and its counts from the record already held rather than waiting for
   * the page to be reopened. Redrawing closes any open row, so the next one
   * opened is drawn with the new display settings too.
   */
  applySettings(settings: Settings): void {
    this.settings = settings;
    this.view = { ...this.view, minCount: settings.minCount };

    const elements = getRequiredElements(this.document);
    if (elements && this.cachedStatistics) this.render(elements, this.cachedStatistics);
  }

  init(): void {
    this.loadStatistics();
    this.loadReviewLog();
    this.setupClearButton();
    this.setupFlashcardButton();
    this.setupSettingsButton();
    new TransferControls(
      this.document,
      this.client,
      this.storage,
      () => this.loadStatistics(),
      () => this.view.minCount,
    ).init();
  }

  private loadStatistics(): void {
    const elements = getRequiredElements(this.document);
    if (!elements) return;

    this.client.getStatistics().then(
      statistics => this.showStatistics(statistics, elements),
      (error: unknown) => {
        console.error('[Stats] Failed to load statistics:', error);
        showError(elements.loadingEl, 'Failed to load statistics: ' + (error as Error).message);
      },
    );
  }

  private showStatistics(statistics: Statistics, elements: StatsElements): void {
    this.cachedStatistics = statistics;
    updateFilterCounts(elements, statistics, this.view);
    this.setupListControls(elements);
    this.render(elements, statistics);
  }

  private render(elements: StatsElements, statistics: Statistics): void {
    // The overview reads the whole record on purpose: what is owed does not
    // change because the list below is filtered to one stage.
    renderOverview(this.document, summarise(statistics));
    this.renderInsights(statistics);
    updateFilterCounts(elements, statistics, this.view);
    updateFilterTabStates(elements, this.view);
    renderStatistics(
      statistics,
      elements,
      (word, container) => this.loadDefinition(word, container),
      this.view,
      (word, status) => this.setWordStatus(elements, word, status),
      () => this.clearFilters(elements),
    );
  }

  /** Like the overview, the insights read the whole record and ignore the list's filters. */
  private renderInsights(statistics: Statistics): void {
    renderForecast(this.document, forecast(statistics));
    renderRetention(this.document, retentionByDirection(statistics));
    renderCoverage(this.document, bandCoverage(statistics));
  }

  /**
   * The review log is a record of its own, so it is fetched on its own: a page
   * whose log fails to load still shows everything the statistics can say.
   */
  private loadReviewLog(): void {
    this.client.getReviewLog().then(
      log => renderActivity(this.document, log),
      () => renderActivity(this.document, undefined),
    );
  }

  /** The way out is offered as "Show all words", so it has to mean all of them. */
  private clearFilters(elements: StatsElements): void {
    this.view.stages.clear();
    this.view.bands.clear();
    this.view.showRetired = true;
    if (this.cachedStatistics) this.render(elements, this.cachedStatistics);
  }

  /**
   * A retired or chosen word changes which stage it counts towards, so the
   * overview and the pills are redrawn from the updated record. The row itself
   * is repainted in place: the buttons sit inside the row's expanded panel, and
   * rebuilding the list closed the panel the reader had just opened. Only a
   * word the press moves out of the current filter needs the list rebuilt.
   */
  private setWordStatus(elements: StatsElements, word: string, status: WordStatus): void {
    const stat = this.cachedStatistics?.[word];
    if (!stat || !this.cachedStatistics) return;

    const updated = applyWordStatus(stat, status);

    this.cachedStatistics = { ...this.cachedStatistics, [word]: updated };
    void this.client.setWordStatus(word, status).catch(() => {});

    renderOverview(this.document, summarise(this.cachedStatistics));
    this.renderInsights(this.cachedStatistics);
    updateFilterCounts(elements, this.cachedStatistics, this.view);

    if (!refreshStatRow(elements, word, updated, this.view)) {
      this.render(elements, this.cachedStatistics);
    }
  }

  /**
   * Wired once. Statistics are loaded again after a clear, and re-running this
   * would leave two listeners on each row of pills — a click toggling a filter
   * on and straight back off.
   */
  private setupListControls(elements: StatsElements): void {
    if (this.controlsReady) return;
    this.controlsReady = true;

    renderSortOptions(elements.sortSelectEl);
    this.setupTabs(elements, elements.filterTabsEl, 'stage');
    this.setupTabs(elements, elements.bandTabsEl, 'band');

    // Its own listener rather than a third `setupTabs` row: the stage and band
    // pills toggle membership of a set, and this one toggles a flag.
    elements.statusTabsEl.addEventListener('click', (e: Event) => {
      if (!(e.target instanceof HTMLElement)) return;
      if (!e.target.closest('[data-status="retired"]')) return;

      this.view.showRetired = !this.view.showRetired;
      if (this.cachedStatistics) this.render(elements, this.cachedStatistics);
    });

    elements.sortSelectEl.addEventListener('change', () => {
      const chosen = elements.sortSelectEl.value;
      if (!isSortKey(chosen)) return;

      this.view = { ...this.view, sort: chosen };
      if (this.cachedStatistics) this.render(elements, this.cachedStatistics);
    });
  }

  /**
   * Each tab toggles one value; an empty set means the filter is off entirely.
   * The set is read off the view on every click rather than captured, so
   * replacing the view does not leave the pills editing a discarded one.
   */
  private setupTabs(
    elements: StatsElements,
    tabsEl: HTMLElement,
    key: 'stage' | 'band',
  ): void {
    tabsEl.addEventListener('click', (e: Event) => {
      if (!(e.target instanceof HTMLElement)) return;
      const tab = e.target.closest(`[data-${key}]`) as HTMLElement | null;
      const value = tab?.dataset[key];
      if (!value) return;

      const active: Set<string> = key === 'stage' ? this.view.stages : this.view.bands;
      if (active.has(value)) active.delete(value);
      else active.add(value);

      if (this.cachedStatistics) this.render(elements, this.cachedStatistics);
    });
  }

  private loadDefinition(word: string, container: HTMLElement): void {
    renderDefinitionLoading(container);
    const contexts = contextsOf(this.cachedStatistics?.[word]);
    this.client.lookupWord(word).then(
      definition => renderDefinition(container, definition, word, contexts, this.settings),
      () => renderDefinition(container, undefined, word, contexts, this.settings),
    );
  }

  private async clearStatistics(): Promise<void> {
    await this.storage.clearStatistics();
    this.cachedStatistics = null;
    this.view.stages.clear();
    this.view.bands.clear();
    this.view.showRetired = false;
    this.view.sort = DEFAULT_SORT;
    this.loadStatistics();
  }

  private setupFlashcardButton(): void {
    const flashcardBtn = this.document.getElementById(ELEMENT_IDS.flashcardBtn);
    if (!flashcardBtn) return;

    flashcardBtn.addEventListener('click', () => {
      void chrome.tabs.create({ url: chrome.runtime.getURL('src/flashcards/flashcards.html') });
    });
  }

  private setupSettingsButton(): void {
    const settingsBtn = this.document.getElementById(ELEMENT_IDS.settingsBtn);
    if (!settingsBtn) return;

    settingsBtn.addEventListener('click', () => {
      void chrome.runtime.openOptionsPage();
    });
  }

  /**
   * Clearing is irreversible, so it asks twice — but through the button
   * itself rather than `confirm()`. The page is the extension's action popup,
   * and a modal dialog there is unreliable: it can take the popup down with
   * it, leaving the reader unsure whether anything was cleared.
   */
  private setupClearButton(): void {
    const clearBtn = this.document.getElementById(ELEMENT_IDS.clearBtn);
    if (!clearBtn) {
      console.error('[Stats] Clear button not found');
      return;
    }

    let armed = false;
    let disarm: ReturnType<typeof setTimeout> | undefined;

    const reset = (): void => {
      armed = false;
      if (disarm !== undefined) clearTimeout(disarm);
      disarm = undefined;
      clearBtn.textContent = CLEAR_LABEL;
      clearBtn.classList.remove('is-armed');
    };

    clearBtn.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        clearBtn.textContent = CLEAR_CONFIRM_LABEL;
        clearBtn.classList.add('is-armed');
        disarm = setTimeout(reset, CLEAR_CONFIRM_MS);
        return;
      }

      reset();

      try {
        await this.clearStatistics();
      } catch (error) {
        console.error('Error clearing statistics:', error);
        clearBtn.textContent = CLEAR_FAILED_LABEL;
        setTimeout(reset, CLEAR_CONFIRM_MS);
      }
    });

    // Tabbing away is an answer of "no".
    clearBtn.addEventListener('blur', reset);
  }
}

export const statsManager = new StatsManager(document, statsClient, statsStorage);

watchSettings(settings => statsManager.applySettings(settings));

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => statsManager.init());
} else {
  statsManager.init();
}
