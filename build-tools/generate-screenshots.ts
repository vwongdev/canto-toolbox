#!/usr/bin/env node
// generate-screenshots.ts - Automate screenshot capture for Chrome Web Store.
// Requires a headed Chrome (extensions are not supported in headless mode).

import puppeteer, { type Page } from 'puppeteer';
import sharp from 'sharp';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { createHash } from 'crypto';
import type { Statistics } from '../src/shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, __dirname.includes('dist') ? '../../..' : '../..');

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 800;
const WIKTIONARY_URL = 'https://en.wiktionary.org/wiki/咩';

// Sample statistics data for stats page screenshot
const sampleStats: Statistics = {
  '你好': { count: 42, firstSeen: Date.now(), lastSeen: Date.now() },
  '中文': { count: 28, firstSeen: Date.now(), lastSeen: Date.now() },
  '學習': { count: 15, firstSeen: Date.now(), lastSeen: Date.now() },
  '廣東話': { count: 12, firstSeen: Date.now(), lastSeen: Date.now() },
  '香港': { count: 8, firstSeen: Date.now(), lastSeen: Date.now() },
};

// Sample statistics data for flashcard screenshot — 粵語 leads so it appears as the first card
const flashcardSampleStats: Statistics = {
  '粵語': { count: 42, firstSeen: Date.now(), lastSeen: Date.now() },
  '學習': { count: 28, firstSeen: Date.now(), lastSeen: Date.now() },
  '香港': { count: 15, firstSeen: Date.now(), lastSeen: Date.now() },
};

// Replicates Chromium's crx_file::id_util::GenerateIdForPath: SHA-256 of the absolute
// path bytes, take the first 16 bytes as 32 hex chars, then map 0-9a-f → a-p.
// This is how Chrome derives the ID for unpacked extensions loaded via --load-extension.
function computeExtensionIdForPath(absPath: string): string {
  const hex = createHash('sha256').update(absPath).digest('hex').slice(0, 32);
  const aCode = 'a'.charCodeAt(0);
  return Array.from(hex, c => String.fromCharCode(aCode + parseInt(c, 16))).join('');
}

async function waitForPopup(page: Page): Promise<void> {
  await page.waitForSelector('#chinese-hover-popup', { timeout: 15000 });
  // Wait a bit for any animations to complete
  await new Promise(resolve => setTimeout(resolve, 200));
}

async function triggerChinesePopup(page: Page): Promise<void> {
  // Wait for the page title element containing 咩
  await page.waitForSelector('h1#firstHeading', { timeout: 10000 });

  // Use text selection to trigger the popup, which is more reliable than hover
  // The extension handles both hover and selection events
  await page.evaluate(() => {
    // Find the Chinese character in the title
    const title = document.querySelector('h1#firstHeading');
    if (!title) throw new Error('Title element not found');

    // Find the text node containing 咩
    const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
    let textNode: Text | null = null;
    let node: Node | null;

    while ((node = walker.nextNode())) {
      if (node.textContent?.includes('咩')) {
        textNode = node as Text;
        break;
      }
    }

    if (!textNode) throw new Error('Chinese text node not found');

    // Create a selection range over the Chinese character
    const range = document.createRange();
    const charIndex = textNode.textContent!.indexOf('咩');
    range.setStart(textNode, charIndex);
    range.setEnd(textNode, charIndex + 1);

    // Select the text
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    // Get the bounding rect for positioning
    const rect = range.getBoundingClientRect();

    // Dispatch mouseup event to trigger the selection handler
    const mouseUpEvent = new MouseEvent('mouseup', {
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      bubbles: true,
      cancelable: true,
      view: window
    });
    document.dispatchEvent(mouseUpEvent);
  });

  // Wait for the event to be processed
  await new Promise(resolve => setTimeout(resolve, 500));
}

async function injectSampleStatistics(page: Page, extensionId: string, stats: Statistics = sampleStats): Promise<void> {
  // Navigate to stats page to inject sample data
  const statsUrl = `chrome-extension://${extensionId}/src/stats/stats.html`;
  await page.goto(statsUrl);

  // Inject sample statistics into chrome.storage.local, one `word:<word>` item each
  await page.evaluate(async (stats) => {
    await chrome.storage.local.set(
      Object.fromEntries(Object.entries(stats).map(([word, stat]) => [`word:${word}`, stat])),
    );
  }, stats);

  // Reload the page to show the injected stats
  await page.reload();
  // Wait for stats list to be visible (display changes from 'none' to 'flex' when populated)
  await page.waitForFunction(
    () => {
      const el = document.getElementById('stats-list');
      return el && el.style.display !== 'none' && el.children.length > 0;
    },
    { timeout: 10000 }
  );
  // Wait for content to fully render
  await new Promise(resolve => setTimeout(resolve, 500));
}

async function waitForContentScript(page: Page): Promise<void> {
  // Wait for the content script's injected styles as proof of loading
  await page.waitForFunction(
    () => document.getElementById('chinese-hover-styles') !== null,
    { timeout: 10000 }
  );
  console.log('[Screenshots] Content script loaded');
}

/** Prepares the page with the hover popup visible (optionally with a given color scheme). */
async function prepareHoverPopup(
  page: Page,
  colorScheme: 'light' | 'dark'
): Promise<void> {
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: colorScheme }]);

  // For dark mode, use Wiktionary's native dark theme via Vector's URL param (same as choosing Dark in the right-hand Appearance sidebar).
  const url =
    colorScheme === 'dark'
      ? `${WIKTIONARY_URL}${WIKTIONARY_URL.includes('?') ? '&' : '?'}vectornightmode=1`
      : WIKTIONARY_URL;
  console.log('[Screenshots] Navigating to Wiktionary...');
  await page.goto(url, { waitUntil: 'networkidle2' });

  await waitForContentScript(page);

  console.log('[Screenshots] Selecting Chinese character...');
  await triggerChinesePopup(page);

  console.log('[Screenshots] Waiting for popup...');
  await waitForPopup(page);

  await expandCharacterBreakdowns(page);
}

/**
 * Opens every character breakdown on the page. The UI ships them closed so the
 * definition stays at the top; a store screenshot is meant to show the feature.
 */
async function expandCharacterBreakdowns(page: Page): Promise<void> {
  const opened = await page.$$eval(
    '.popup-etymology-section.is-collapsed .popup-etymology-toggle',
    toggles => {
      toggles.forEach(toggle => (toggle as HTMLElement).click());
      return toggles.length;
    }
  );
  if (opened > 0) {
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

const VIEWPORT_CLIP ={ x: 0, y: 0, width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT };
const POPUP_CLIP_PADDING = 120;

function getPopupClip(box: { x: number; y: number; width: number; height: number }) {
  const pad = POPUP_CLIP_PADDING;
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  let width = Math.min(VIEWPORT_WIDTH, box.width + pad * 2);
  let height = Math.min(VIEWPORT_HEIGHT, box.height + pad * 2);
  width = Math.min(width, VIEWPORT_WIDTH - x);
  height = Math.min(height, VIEWPORT_HEIGHT - y);
  return { x, y, width, height };
}

async function captureClippedAndResize(page: Page, clip: { x: number; y: number; width: number; height: number }, outputPath: string): Promise<void> {
  const buffer = await page.screenshot({ type: 'png', clip, encoding: 'binary' });
  await sharp(buffer)
    .resize(VIEWPORT_WIDTH, VIEWPORT_HEIGHT, { fit: 'cover' })
    .toFile(outputPath);
}

async function captureHoverPopupScreenshot(page: Page, outputPath: string): Promise<void> {
  await prepareHoverPopup(page, 'light');

  console.log('[Screenshots] Capturing hover-popup.png (zoomed on popup, 1280×800)...');
  const popup = await page.$('#chinese-hover-popup');
  if (!popup) throw new Error('Popup element not found');
  const box = await popup.boundingBox();
  await popup.dispose();
  if (!box) throw new Error('Popup has no bounding box');
  await captureClippedAndResize(page, getPopupClip(box), outputPath);
}

async function captureStatsScreenshot(
  page: Page,
  extensionId: string,
  outputPath: string
): Promise<void> {
  // Ensure light mode for stats page
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

  console.log('[Screenshots] Injecting sample statistics...');
  await injectSampleStatistics(page, extensionId);

  console.log('[Screenshots] Expanding first word definition...');
  const firstHeader = await page.$('.stat-header');
  if (!firstHeader) throw new Error('No stat header found');
  await firstHeader.click();
  await firstHeader.dispose();

  // Wait for definition to load (expand triggers async lookup)
  await page.waitForSelector('.stat-expanded .definition-container', {
    visible: true,
    timeout: 15000
  });
  await new Promise(resolve => setTimeout(resolve, 300));

  await expandCharacterBreakdowns(page);

  console.log('[Screenshots] Capturing statistics.png (1280×800)...');
  await page.screenshot({ path: outputPath, type: 'png', clip: VIEWPORT_CLIP });
}

async function captureFlashcardScreenshot(
  page: Page,
  extensionId: string,
  outputPath: string
): Promise<void> {
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

  console.log('[Screenshots] Injecting sample statistics for flashcards...');
  await injectSampleStatistics(page, extensionId, flashcardSampleStats);

  console.log('[Screenshots] Navigating to flashcard page...');
  await page.goto(`chrome-extension://${extensionId}/src/flashcards/flashcards.html`);

  await page.waitForFunction(
    () => {
      const el = document.getElementById('review');
      return el && el.style.display !== 'none';
    },
    { timeout: 10000 }
  );

  await page.click('#show-answer-btn');
  await page.waitForSelector('.definition-container', { visible: true, timeout: 15000 });
  await new Promise(resolve => setTimeout(resolve, 300));

  await expandCharacterBreakdowns(page);

  console.log('[Screenshots] Capturing flashcard-review.png (1280×800)...');
  await page.screenshot({ path: outputPath, type: 'png', clip: VIEWPORT_CLIP });
}

async function captureDarkModeScreenshot(page: Page, outputPath: string): Promise<void> {
  await prepareHoverPopup(page, 'dark');

  console.log('[Screenshots] Capturing dark-mode.png (zoomed on popup, 1280×800)...');
  const popup = await page.$('#chinese-hover-popup');
  if (!popup) throw new Error('Popup element not found');
  const box = await popup.boundingBox();
  await popup.dispose();
  if (!box) throw new Error('Popup has no bounding box');
  await captureClippedAndResize(page, getPopupClip(box), outputPath);
}

async function generateScreenshots(): Promise<void> {
  const distDir = join(rootDir, 'dist');
  const screenshotsDir = join(rootDir, 'screenshots');

  // Verify dist directory exists
  if (!existsSync(distDir)) {
    throw new Error(`Extension not built. Run 'pnpm build' first. Expected: ${distDir}`);
  }

  // Verify it contains extension files
  const distFiles = readdirSync(distDir);
  if (!distFiles.includes('manifest.json')) {
    throw new Error(`Invalid extension build. Missing manifest.json in ${distDir}`);
  }

  console.log('[Screenshots] Starting screenshot generation...');
  console.log(`[Screenshots] Loading extension from: ${distDir}`);

  if (!existsSync(screenshotsDir)) {
    mkdirSync(screenshotsDir, { recursive: true });
    console.log(`[Screenshots] Created output directory: ${screenshotsDir}`);
  }

  // Launch Chrome with extension loaded
  const browser = await puppeteer.launch({
    headless: false, // Extensions require non-headless mode
    args: [
      `--disable-extensions-except=${distDir}`,
      `--load-extension=${distDir}`,
      // Chrome 128+ disables --load-extension by default. This feature flag re-enables it.
      // See https://issues.chromium.org/issues/40274926
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });

  try {
    // Wait for extension to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Compute the extension ID deterministically from the dist path — Chrome derives
    // the ID for unpacked extensions as a hash of their absolute path, so we can predict
    // it without inspecting browser state or service worker targets.
    const extensionId = computeExtensionIdForPath(distDir);
    console.log(`[Screenshots] Extension ID: ${extensionId}`);

    // Warm up the background service worker by visiting the extension page.
    // The 48MB background bundle takes several seconds to parse on first load;
    // without this, the first lookupWord message from the content script times out.
    console.log('[Screenshots] Warming up background service worker...');
    const warmupPage = await browser.newPage();
    await warmupPage.goto(`chrome-extension://${extensionId}/src/stats/stats.html`);
    await new Promise(resolve => setTimeout(resolve, 3000));
    await warmupPage.close();
    console.log('[Screenshots] Background service worker ready');

    // Create a new page with the required viewport
    const page = await browser.newPage();
    await page.setViewport({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });

    // Capture hover popup screenshot
    await captureHoverPopupScreenshot(
      page,
      join(screenshotsDir, 'hover-popup.png')
    );

    // Capture statistics page screenshot
    await captureStatsScreenshot(
      page,
      extensionId,
      join(screenshotsDir, 'statistics.png')
    );

    // Capture flashcard review screenshot
    await captureFlashcardScreenshot(
      page,
      extensionId,
      join(screenshotsDir, 'flashcard-review.png')
    );

    // Capture dark mode screenshot (hover popup in dark theme)
    await captureDarkModeScreenshot(page, join(screenshotsDir, 'dark-mode.png'));

    console.log('[Screenshots] All screenshots captured successfully!');
    console.log(`[Screenshots] Output directory: ${screenshotsDir}`);
  } finally {
    await browser.close();
  }
}

generateScreenshots().catch((error) => {
  console.error('[Screenshots] Error:', error.message);
  process.exit(1);
});
