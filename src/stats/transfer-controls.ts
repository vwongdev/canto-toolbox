import type { DefinitionResult } from '../shared/types.js';
import { MAX_TRACKED_WORDS } from '../shared/statistics-store.js';
import type { StatsClient } from './stats-client.js';
import type { StatsStorage } from './stats-storage.js';
import { BackupError, backupFilename, parseBackup, serialiseBackup } from './backup.js';
import {
  collectCards,
  toAnki,
  toPleco,
  wordsToExport,
  type ExportScope,
} from './card-export.js';

export const TRANSFER_IDS = {
  details: 'transfer',
  backupBtn: 'backup-btn',
  restoreBtn: 'restore-btn',
  restoreInput: 'restore-input',
  exportScope: 'export-scope',
  ankiBtn: 'export-anki-btn',
  plecoBtn: 'export-pleco-btn',
  status: 'transfer-status',
} as const;

/** The fragment a popup opens the page with to say the reader came to restore. */
export const RESTORE_HASH = '#restore';

const STATS_PAGE = 'src/stats/stats.html';

/**
 * Whether the page is the action popup rather than a tab. A popup has no tab
 * of its own, and it closes the moment a file picker takes focus — the chosen
 * file would arrive at a page that no longer exists.
 */
async function isActionPopup(): Promise<boolean> {
  if (!chrome.tabs?.getCurrent) return false;
  return (await chrome.tabs.getCurrent()) === undefined;
}

export class TransferControls {
  private busy = false;

  constructor(
    private readonly document: Document,
    private readonly client: StatsClient,
    private readonly storage: StatsStorage,
    /** Called once a restore has changed the record, so the page can reload it. */
    private readonly onRestored: () => void,
    /** The reader's enrolment threshold, read at export time so it is current. */
    private readonly minCount: () => number | undefined = () => undefined,
  ) {}

  init(): void {
    const el = (id: string) => this.document.getElementById(id);

    el(TRANSFER_IDS.backupBtn)?.addEventListener('click', () => void this.backup());
    el(TRANSFER_IDS.restoreBtn)?.addEventListener('click', () => void this.chooseBackup());
    el(TRANSFER_IDS.restoreInput)?.addEventListener('change', () => void this.restore());
    el(TRANSFER_IDS.ankiBtn)?.addEventListener('click', () => void this.exportCards('anki'));
    el(TRANSFER_IDS.plecoBtn)?.addEventListener('click', () => void this.exportCards('pleco'));

    if (this.document.defaultView?.location.hash === RESTORE_HASH) {
      el(TRANSFER_IDS.details)?.setAttribute('open', '');
      this.setStatus('Press Restore to choose the backup file.');
    }
  }

  private setStatus(message: string, isError = false): void {
    const status = this.document.getElementById(TRANSFER_IDS.status);
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-error', isError);
  }

  /** One job at a time: a second export while the first is still looking up would race it. */
  private setBusy(busy: boolean): void {
    this.busy = busy;
    for (const id of [TRANSFER_IDS.backupBtn, TRANSFER_IDS.restoreBtn, TRANSFER_IDS.ankiBtn, TRANSFER_IDS.plecoBtn]) {
      const button = this.document.getElementById(id);
      if (button instanceof HTMLButtonElement) button.disabled = busy;
    }
  }

  private lookup(word: string): Promise<DefinitionResult | undefined> {
    return this.client.lookupWord(word).catch(() => undefined);
  }

  /**
   * A blob URL behind an anchor downloads from a popup and a tab alike, with
   * no `downloads` permission. The URL is released after the click has had
   * its turn, since revoking it synchronously can cancel the download.
   */
  private download(filename: string, text: string, type: string): void {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const anchor = this.document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    this.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  private async backup(): Promise<void> {
    if (this.busy) return;
    this.setBusy(true);
    try {
      const statistics = await this.client.getStatistics();
      const now = new Date();
      this.download(backupFilename(now), serialiseBackup(statistics, now), 'application/json');
      this.setStatus(`Backed up ${plural(Object.keys(statistics).length, 'word')}.`);
    } catch (error) {
      console.error('[Stats] Backup failed:', error);
      this.setStatus('Could not back up: ' + errorMessage(error), true);
    } finally {
      this.setBusy(false);
    }
  }

  private async chooseBackup(): Promise<void> {
    if (this.busy) return;

    if (await isActionPopup()) {
      void chrome.tabs.create({ url: chrome.runtime.getURL(STATS_PAGE) + RESTORE_HASH });
      this.document.defaultView?.close();
      return;
    }

    // Still inside the click's user activation, which survives the await above.
    const input = this.document.getElementById(TRANSFER_IDS.restoreInput);
    if (input instanceof HTMLInputElement) {
      input.value = '';
      input.click();
    }
  }

  private async restore(): Promise<void> {
    const input = this.document.getElementById(TRANSFER_IDS.restoreInput);
    const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
    if (!file || this.busy) return;

    this.setBusy(true);
    try {
      const backup = parseBackup(await file.text());
      const outcome = await this.storage.restoreStatistics(backup);
      const total = Object.keys(outcome.statistics).length;

      let message = `Imported ${plural(outcome.imported, 'word')} (${outcome.added} new).`;
      if (total > MAX_TRACKED_WORDS) {
        message += ` The record now holds ${total}, over the ${MAX_TRACKED_WORDS}-word limit —`
          + ' the least studied will be dropped as new words are tracked.';
      }
      this.setStatus(message);
      this.onRestored();
    } catch (error) {
      if (!(error instanceof BackupError)) console.error('[Stats] Restore failed:', error);
      this.setStatus(
        error instanceof BackupError ? error.message : 'Could not restore: ' + errorMessage(error),
        true,
      );
    } finally {
      this.setBusy(false);
    }
  }

  private async exportCards(format: 'anki' | 'pleco'): Promise<void> {
    if (this.busy) return;
    this.setBusy(true);
    try {
      const scopeEl = this.document.getElementById(TRANSFER_IDS.exportScope);
      const scope: ExportScope =
        scopeEl instanceof HTMLSelectElement && scopeEl.value === 'all' ? 'all' : 'deck';

      const statistics = await this.client.getStatistics();
      const words = wordsToExport(statistics, scope, this.minCount());
      if (words.length === 0) {
        this.setStatus(scope === 'deck'
          ? 'No words in the study deck yet. Choose All tracked words to export everything.'
          : 'No words tracked yet.');
        return;
      }

      const cards = await collectCards(words, statistics, word => this.lookup(word),
        (done, total) => this.setStatus(`Looking up ${done} of ${total}…`));

      const text = format === 'anki' ? toAnki(cards) : toPleco(cards);
      this.download(`canto-toolbox-${format}.txt`, text, 'text/plain;charset=utf-8');
      this.setStatus(`Exported ${plural(cards.length, 'card')} for ${format === 'anki' ? 'Anki' : 'Pleco'}.`);
    } catch (error) {
      console.error('[Stats] Export failed:', error);
      this.setStatus('Could not export: ' + errorMessage(error), true);
    } finally {
      this.setBusy(false);
    }
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
