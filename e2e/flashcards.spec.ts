import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

const EXTENSION_PATH = path.resolve(process.cwd(), 'dist');

const WORD_HIGH = '你好';   // count 5
const WORD_MID = '再见';    // count 2
const WORD_LOW = '谢谢';    // count 1 (should be filtered)

type WordStat = { count: number; firstSeen: number; lastSeen: number; pinned?: boolean };

let context: BrowserContext;
let extensionId: string;
let tmpDataDir: string;

test.beforeAll(async () => {
  tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'playwright-ext-'));
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

/**
 * The record is exactly `data`: one local item per word, as the extension
 * keeps it. Both areas are cleared first, because the extension reads the two
 * reconciled — an earlier test's ratings left standing in either would still
 * count, and sync carries the reviewed words it would otherwise put back.
 */
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

async function openExtensionPage(): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/stats/stats.html`);
  return page;
}

async function openFlashcardsPage(): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/flashcards/flashcards.html`);
  return page;
}

test('flashcard page URL is reachable', async () => {
  const page = await openFlashcardsPage();
  await expect(page).toHaveTitle('Flashcard Review');
  await page.close();
});

test('empty-state shown when no storage data', async () => {
  const helper = await openExtensionPage();
  await clearStorage(helper);
  await helper.close();

  const page = await openFlashcardsPage();
  await expect(page.locator('#empty-state')).toBeVisible();
  await expect(page.locator('#review')).not.toBeVisible();
  await page.close();
});

test('only words seen often enough, or chosen, appear in session', async () => {
  const now = Date.now();
  const helper = await openExtensionPage();
  await seedStorage(helper, {
    [WORD_LOW]: { count: 1, firstSeen: now, lastSeen: now },
    [WORD_MID]: { count: 2, firstSeen: now, lastSeen: now, pinned: true },
    [WORD_HIGH]: { count: 5, firstSeen: now, lastSeen: now },
  });
  await helper.close();

  const page = await openFlashcardsPage();
  await expect(page.locator('#review')).toBeVisible();

  // WORD_MID was chosen outright and WORD_HIGH has been met enough times;
  // WORD_LOW is only a candidate.
  const counter = page.locator('#counter');
  await expect(counter).toHaveText(/of 2/);

  await page.close();
});

test('Show Answer reveals definition section', async () => {
  const now = Date.now();
  const helper = await openExtensionPage();
  await seedStorage(helper, {
    [WORD_HIGH]: { count: 5, firstSeen: now, lastSeen: now },
  });
  await helper.close();

  const page = await openFlashcardsPage();
  await expect(page.locator('#review')).toBeVisible();
  await expect(page.locator('#show-answer-btn')).toBeVisible();

  await page.click('#show-answer-btn');

  // After clicking, definition-container should become visible
  await expect(page.locator('.definition-container')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#rating-btns')).toBeVisible();

  await page.close();
});

test('Again re-queues word so it re-appears later', async () => {
  const now = Date.now();
  const helper = await openExtensionPage();
  await seedStorage(helper, {
    [WORD_HIGH]: { count: 5, firstSeen: now, lastSeen: now },
    [WORD_MID]: { count: 5, firstSeen: now, lastSeen: now },
  });
  await helper.close();

  const page = await openFlashcardsPage();
  await expect(page.locator('#review')).toBeVisible();

  // First card
  const firstWord = await page.locator('.card-characters').textContent();

  // Show answer, click Again
  await page.click('#show-answer-btn');
  await expect(page.locator('#rating-btns')).toBeVisible({ timeout: 15000 });
  await page.click('[data-rating="again"]');

  // Second card should be different
  await expect(page.locator('.card-characters')).not.toHaveText(firstWord!);
  const secondWord = await page.locator('.card-characters').textContent();
  expect(secondWord).not.toBe(firstWord);

  // Show answer, click Good on second card
  await page.click('#show-answer-btn');
  await expect(page.locator('#rating-btns')).toBeVisible({ timeout: 15000 });
  await page.click('[data-rating="good"]');

  // Third card should be firstWord (re-queued after Again)
  await expect(page.locator('.card-characters')).toHaveText(firstWord!);

  await page.close();
});

test('Good on all cards shows finished screen with correct count', async () => {
  const now = Date.now();
  const helper = await openExtensionPage();
  await seedStorage(helper, {
    [WORD_HIGH]: { count: 5, firstSeen: now, lastSeen: now },
    [WORD_MID]: { count: 5, firstSeen: now, lastSeen: now },
  });
  await helper.close();

  const page = await openFlashcardsPage();
  await expect(page.locator('#review')).toBeVisible();

  // Go through 2 cards clicking Good each time
  for (let i = 0; i < 2; i++) {
    await expect(page.locator('.card-characters')).toBeVisible();
    await page.click('#show-answer-btn');
    await expect(page.locator('#rating-btns')).toBeVisible({ timeout: 15000 });
    await page.click('[data-rating="good"]');
  }

  // Finished screen should appear
  await expect(page.locator('#finished')).toBeVisible();
  await expect(page.locator('#result-summary')).toHaveText('2 / 2 correct');

  await page.close();
});

test('Review Again resets counter to Card 1', async () => {
  const now = Date.now();
  const helper = await openExtensionPage();
  await seedStorage(helper, {
    [WORD_HIGH]: { count: 5, firstSeen: now, lastSeen: now },
    [WORD_MID]: { count: 5, firstSeen: now, lastSeen: now },
  });
  await helper.close();

  const page = await openFlashcardsPage();
  await expect(page.locator('#review')).toBeVisible();

  // Complete all 2 cards with Good
  for (let i = 0; i < 2; i++) {
    await expect(page.locator('.card-characters')).toBeVisible();
    await page.click('#show-answer-btn');
    await expect(page.locator('#rating-btns')).toBeVisible({ timeout: 15000 });
    await page.click('[data-rating="good"]');
  }

  await expect(page.locator('#finished')).toBeVisible();

  // Click Review Again
  await page.click('#review-again-btn');

  // Counter should reset to "Card 1 of ..."
  await expect(page.locator('#review')).toBeVisible();
  await expect(page.locator('#counter')).toHaveText(/^Card 1 of /);

  await page.close();
});

test('keyboard shortcuts drive a full review session', async () => {
  const now = Date.now();
  const helper = await openExtensionPage();
  await seedStorage(helper, {
    [WORD_HIGH]: { count: 5, firstSeen: now, lastSeen: now },
  });
  await helper.close();

  const page = await openFlashcardsPage();
  await expect(page.locator('#review')).toBeVisible();

  // Space reveals the answer
  await page.keyboard.press('Space');
  await expect(page.locator('.definition-container')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#rating-btns')).toBeVisible();

  // 3 rates the card Good
  await page.keyboard.press('3');
  await expect(page.locator('#finished')).toBeVisible();
  await expect(page.locator('#result-summary')).toHaveText('1 / 1 correct');

  // Enter restarts the session
  await page.keyboard.press('Enter');
  await expect(page.locator('#review')).toBeVisible();
  await expect(page.locator('#counter')).toHaveText(/^Card 1 of /);

  await page.close();
});
