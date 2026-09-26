import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

const EXTENSION_PATH = path.resolve(process.cwd(), 'dist');

type WordStat = { count: number; firstSeen: number; lastSeen: number };

let context: BrowserContext;
let extensionId: string;
let tmpDataDir: string;

test.beforeAll(async () => {
  tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'playwright-stats-'));
  context = await chromium.launchPersistentContext(tmpDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });

  let [background] = context.serviceWorkers();
  if (!background) {
    background = await context.waitForEvent('serviceworker');
  }
  extensionId = background.url().split('/')[2]!;
});

test.afterAll(async () => {
  await context.close();
  fs.rmSync(tmpDataDir, { recursive: true, force: true });
});

async function openStatsPage(): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/stats/stats.html`);
  return page;
}

/** One local item per word — see the note on the flashcards spec's copy. */
async function seedStorage(page: Page, data: Record<string, WordStat>): Promise<void> {
  await page.evaluate(async (storageData) => {
    await chrome.storage.sync.clear();
    await chrome.storage.local.clear();
    await chrome.storage.local.set(
      Object.fromEntries(Object.entries(storageData).map(([word, stat]) => [`word:${word}`, stat])),
    );
  }, data);
}

async function clearStorage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.local.clear();
  });
}

test('stats page title is reachable', async () => {
  const page = await openStatsPage();
  await expect(page).toHaveTitle('Chinese Word Statistics');
  await page.close();
});

test('empty state shown when no statistics', async () => {
  const helper = await openStatsPage();
  await clearStorage(helper);
  await helper.close();

  const page = await openStatsPage();
  await expect(page.locator('#empty-state')).toBeVisible();
  await expect(page.locator('#stats-list')).not.toBeVisible();
  await page.close();
});

test('renders tracked words and expands a definition', async () => {
  const now = Date.now();
  const helper = await openStatsPage();
  await seedStorage(helper, {
    你好: { count: 5, firstSeen: now, lastSeen: now },
    再见: { count: 2, firstSeen: now, lastSeen: now },
  });
  await helper.close();

  const page = await openStatsPage();
  const list = page.locator('#stats-list');
  await expect(list).toBeVisible();
  await expect(page.locator('.stat-item')).toHaveCount(2);
  await expect(page.locator('#word-count')).toHaveText(/2 words/);

  // Expand the first row — definition lazy-loads via the background handler
  await page.locator('.stat-item').first().locator('.stat-header').click();
  await expect(page.locator('.stat-item').first().locator('.definition-container'))
    .toBeVisible({ timeout: 15000 });

  await page.close();
});

test('clear button empties the statistics', async () => {
  const now = Date.now();
  const helper = await openStatsPage();
  await seedStorage(helper, { 你好: { count: 5, firstSeen: now, lastSeen: now } });
  await helper.close();

  const page = await openStatsPage();
  await expect(page.locator('.stat-item')).toHaveCount(1);

  // Clearing asks twice through the button itself rather than through a modal
  // dialog, which the page cannot rely on as the extension's action popup.
  await page.click('#clear-btn');
  await expect(page.locator('#clear-btn')).toHaveText('Clear everything?');
  await page.click('#clear-btn');

  await expect(page.locator('#empty-state')).toBeVisible({ timeout: 15000 });
  await page.close();
});
