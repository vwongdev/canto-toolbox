// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { TransferControls } from '../transfer-controls.js';
import { serialiseBackup } from '../backup.js';
import type { StatsClient } from '../stats-client.js';
import type { StatsStorage } from '../stats-storage.js';
import type { DefinitionResult, Statistics } from '../../shared/types.js';

const HTML = readFileSync('src/stats/stats.html', 'utf-8')
  .replace(/<link\b[^>]*>/g, '')
  .replace(/<script\b[\s\S]*?<\/script>/g, '');

const STATISTICS: Statistics = {
  好: { count: 6, firstSeen: 1, lastSeen: 9, context: '好嘢' },
  字: { count: 1, firstSeen: 2, lastSeen: 9 },
};

const GOOD: DefinitionResult = {
  word: '好',
  mandarin: { entries: [{ traditional: '好', simplified: '好', romanisation: 'hao3', definitions: ['good', 'well'] }] },
  cantonese: { entries: [{ traditional: '好', simplified: '好', romanisation: 'hou2', definitions: ['good', 'well'] }] },
};

describe('TransferControls', () => {
  let document: Document;
  let client: StatsClient;
  let storage: StatsStorage;
  let onRestored: () => void;
  let downloads: Array<{ name: string; blob: Blob }>;

  const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const click = (id: string) => byId(id).dispatchEvent(new Event('click', { bubbles: true }));
  const status = () => byId('transfer-status').textContent;
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));

  function chooseFile(text: string): void {
    const input = byId<HTMLInputElement>('restore-input');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File([text], 'backup.json', { type: 'application/json' })],
    });
    input.dispatchEvent(new Event('change'));
  }

  beforeEach(() => {
    document = new DOMParser().parseFromString(HTML, 'text/html');
    client = {
      getStatistics: vi.fn(async () => STATISTICS),
      lookupWord: vi.fn(async () => GOOD),
      setWordStatus: vi.fn(),
      getReviewLog: vi.fn(async () => ({})),
    };
    storage = {
      getStatistics: vi.fn(),
      clearStatistics: vi.fn(),
      restoreStatistics: vi.fn(async (backup: Statistics) => ({
        statistics: { ...STATISTICS, ...backup },
        imported: Object.keys(backup).length,
        added: 1,
      })),
    };
    onRestored = vi.fn();

    downloads = [];
    let blobs = 0;
    const saved = new Map<string, Blob>();
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
      const url = `blob:test/${blobs++}`;
      saved.set(url, blob as Blob);
      return url;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ name: this.download, blob: saved.get(this.href)! });
    });

    new TransferControls(document, client, storage, onRestored).init();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (chrome as { tabs?: unknown }).tabs;
  });

  it('downloads the whole record as a versioned backup', async () => {
    click('backup-btn');
    await settle();

    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.name).toMatch(/^canto-toolbox-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const backup = JSON.parse(await downloads[0]!.blob.text());
    expect(backup.statistics).toEqual(STATISTICS);
    expect(status()).toBe('Backed up 2 words.');
  });

  it('exports the study deck to Anki by default', async () => {
    click('export-anki-btn');
    await vi.waitFor(() => expect(downloads).toHaveLength(1));

    const text = await downloads[0]!.blob.text();
    expect(text).toContain('好\t好\thou2\thǎo\tgood; well\t好嘢');
    expect(text).not.toContain('字');
    expect(client.lookupWord).toHaveBeenCalledTimes(1);
    expect(status()).toBe('Exported 1 card for Anki.');
  });

  it('exports every tracked word when the scope asks for it', async () => {
    byId<HTMLSelectElement>('export-scope').value = 'all';
    click('export-pleco-btn');
    await vi.waitFor(() => expect(downloads).toHaveLength(1));

    expect(downloads[0]!.name).toBe('canto-toolbox-pleco.txt');
    expect(client.lookupWord).toHaveBeenCalledTimes(2);
  });

  it('merges a chosen backup and reports how many words it held', async () => {
    chooseFile(serialiseBackup({ 你好: { count: 3, firstSeen: 1, lastSeen: 2 } }));
    await vi.waitFor(() => expect(onRestored).toHaveBeenCalled());

    expect(storage.restoreStatistics).toHaveBeenCalledWith({ 你好: { count: 3, firstSeen: 1, lastSeen: 2 } });
    expect(status()).toBe('Imported 1 word (1 new).');
  });

  it('refuses a file that is not a backup and writes nothing', async () => {
    chooseFile('{"hello": "world"}');
    await vi.waitFor(() => expect(status()).toBe('This file is not a Canto Toolbox backup.'));

    expect(byId('transfer-status').classList.contains('is-error')).toBe(true);
    expect(storage.restoreStatistics).not.toHaveBeenCalled();
    expect(onRestored).not.toHaveBeenCalled();
  });

  it('opens the file picker when the page is a tab', async () => {
    Object.assign(chrome, { tabs: { getCurrent: vi.fn(async () => ({ id: 1 })), create: vi.fn() } });
    const picker = vi.spyOn(byId<HTMLInputElement>('restore-input'), 'click').mockImplementation(() => {});

    click('restore-btn');
    await settle();

    expect(picker).toHaveBeenCalled();
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  // A file picker takes focus from the action popup, which closes it before
  // the chosen file can arrive — so the popup hands restoring to a tab.
  it('moves to a tab to restore when the page is the action popup', async () => {
    Object.assign(chrome, { tabs: { getCurrent: vi.fn(async () => undefined), create: vi.fn() } });
    const picker = vi.spyOn(byId<HTMLInputElement>('restore-input'), 'click');

    click('restore-btn');
    await settle();

    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test/src/stats/stats.html#restore',
    });
    expect(picker).not.toHaveBeenCalled();
  });
});
