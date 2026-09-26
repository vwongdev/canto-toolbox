import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import sharp from 'sharp';
import type { AddressInfo } from 'net';

const EXTENSION_PATH = path.resolve(process.cwd(), 'dist');

const LINES = ['今天天气很好', '我想去图书馆看书', '谢谢你的帮助'];

/**
 * The image under test is drawn here rather than checked in, so the text it
 * holds and the text asserted below cannot drift apart.
 */
const IMAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="260">
  <rect width="640" height="260" fill="#ffffff"/>
  ${LINES.map((line, i) => `<text x="40" y="${90 + i * 75}" font-family="PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, sans-serif" font-size="44" fill="#111111">${line}</text>`).join('\n  ')}
</svg>`;

const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>zh image</title></head>
<body style="padding:40px">
<img id="target" src="/sample.png" width="640" height="260">
</body></html>`;

/**
 * The video page records its own source: a canvas of the same subtitles
 * captured through MediaRecorder. That gives real encoded frames without
 * checking a video file in or depending on ffmpeg, and the `blob:` source is
 * same-origin — the canvas capture path, which is the one streaming video
 * takes.
 */
const VIDEO_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>zh video</title></head>
<body style="padding:40px">
<video id="target" width="800" muted></video>
<script>
window.ready = (async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 520;
  const ctx = canvas.getContext('2d');
  const draw = () => {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 1280, 520);
    ctx.fillStyle = '#111111';
    ctx.font = '64px "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", sans-serif';
    ctx.fillText(${JSON.stringify(LINES[0])}, 80, 180);
    ctx.fillText(${JSON.stringify(LINES[1])}, 80, 330);
  };
  draw();
  const repaint = setInterval(draw, 100);
  const recorder = new MediaRecorder(canvas.captureStream(10), { mimeType: 'video/webm' });
  const chunks = [];
  recorder.ondataavailable = e => chunks.push(e.data);
  recorder.start();
  // Long enough to hold a seekable frame, short enough that several tests
  // recording in parallel workers do not slow the whole suite down.
  await new Promise(r => setTimeout(r, 700));
  recorder.stop();
  await new Promise(r => { recorder.onstop = r; });
  clearInterval(repaint);

  const video = document.querySelector('#target');
  video.src = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
  await new Promise(r => { video.onloadeddata = r; });
  video.currentTime = 0.3;
  await new Promise(r => { video.onseeked = r; });
  return video.videoWidth;
})();
</script>
</body></html>`;

let context: BrowserContext;
let tmpDataDir: string;
let server: http.Server;
let baseUrl: string;
let extensionId: string;

test.beforeAll(async () => {
  const png = await sharp(Buffer.from(IMAGE_SVG)).png().toBuffer();

  server = http.createServer((req, res) => {
    if (req.url === '/sample.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(png);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.url?.startsWith('/video') ? VIDEO_HTML : PAGE_HTML);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

  tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'playwright-ocr-'));
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
  await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(tmpDataDir, { recursive: true, force: true });
});

/** Hovers the image and reads it, leaving the overlay in place. */
async function readImage(page: Page): Promise<void> {
  await page.hover('#target');
  await expect(page.locator('.canto-ocr-badge')).toBeVisible({ timeout: 15000 });
  await page.click('.canto-ocr-badge');
  // The first read loads the model, so this waits longer than a lookup would.
  await expect(page.locator('.canto-ocr-line').first()).toBeAttached({ timeout: 60000 });
}

test('reading an image lays its text over it', async () => {
  const page = await context.newPage();
  await page.goto(baseUrl);

  await readImage(page);

  await expect(page.locator('.canto-ocr-line')).toHaveText(LINES);
  await page.close();
});

/**
 * The whole point of the overlay: recognised text is ordinary hoverable text,
 * so the popup, the statistics and the flashcards all reach it through the
 * path they already use, with nothing taught about images.
 */
test('hovering recognised text shows the definition popup and studies the word', async () => {
  const page = await context.newPage();
  await page.goto(baseUrl);

  await readImage(page);

  // The third character of the second line: 去 of 我想去图书馆看书.
  const target = await page.evaluate(() => {
    const line = document.querySelectorAll('.canto-ocr-line')[1]!;
    const range = document.createRange();
    range.setStart(line.firstChild!, 2);
    range.setEnd(line.firstChild!, 3);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });

  await page.mouse.move(target.x - 20, target.y - 20);
  await page.mouse.move(target.x, target.y);

  const popup = page.locator('#chinese-hover-popup');
  await expect(popup).toBeVisible({ timeout: 15000 });
  await expect(popup.locator('.popup-word')).toHaveText('去');
  await expect(popup.locator('.definition-section')).toHaveCount(2);

  // Dwelling records the word, with the recognised line as the sentence it
  // was met in — exactly as a word met in page text would be. chrome.storage
  // is only reachable from an extension page, not the page under test.
  const extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/src/stats/stats.html`);

  await expect
    .poll(() => readStatistics(extensionPage), { timeout: 15000 })
    .toMatchObject({ 去: { contexts: [{ text: LINES[1] }] } });

  await extensionPage.close();
  await page.close();
});

function readStatistics(page: Page): Promise<Record<string, { contexts?: { text: string }[] }>> {
  return page.evaluate(
    () =>
      new Promise<Record<string, { contexts?: { text: string }[] }>>(resolve => {
        // Local holds every word, one item each; sync carries only studied ones.
        chrome.storage.local.get(null, items =>
          resolve(
            Object.fromEntries(
              Object.entries(items)
                .filter(([key]) => key.startsWith('word:'))
                .map(([key, stat]) => [key.slice('word:'.length), stat]),
            ),
          ),
        );
      }),
  );
}

/** Brings the recorded video up and parks it on a frame with subtitles. */
async function openPausedVideo(): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${baseUrl}video`);
  // The page records its source before it has a frame at all, so this waits on
  // the recording rather than on the element.
  await page.waitForFunction(
    () => (window as unknown as { ready?: Promise<number> }).ready !== undefined,
    undefined,
    { timeout: 30000 },
  );
  await page.evaluate(() => (window as unknown as { ready: Promise<number> }).ready);
  return page;
}

async function readFrame(page: Page): Promise<void> {
  await page.hover('#target');
  await expect(page.locator('.canto-ocr-badge')).toBeVisible({ timeout: 15000 });
  await page.click('.canto-ocr-badge');
  await expect(page.locator('.canto-ocr-line').first()).toBeAttached({ timeout: 60000 });
}

test('reading a paused video lays its subtitles over the frame', async () => {
  const page = await openPausedVideo();

  await readFrame(page);
  await expect(page.locator('.canto-ocr-line')).toHaveText([LINES[0]!, LINES[1]!]);

  await page.close();
});

/**
 * The same claim as for images, reached through a different capture path:
 * recognised frame text is ordinary hoverable text, so the popup finds it with
 * nothing taught about video.
 */
test('hovering a recognised subtitle shows the definition popup', async () => {
  const page = await openPausedVideo();
  await readFrame(page);

  const target = await page.evaluate(() => {
    const line = document.querySelectorAll('.canto-ocr-line')[1]!;
    const range = document.createRange();
    range.setStart(line.firstChild!, 2);
    range.setEnd(line.firstChild!, 3);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });

  await page.mouse.move(target.x - 20, target.y - 20);
  await page.mouse.move(target.x, target.y);

  await expect(page.locator('#chinese-hover-popup .popup-word')).toHaveText('去', {
    timeout: 15000,
  });

  await page.close();
});

/** Text read off one frame is wrong for every frame after it. */
test('playing the video clears the overlay', async () => {
  const page = await openPausedVideo();
  await readFrame(page);

  await page.mouse.move(2, 2);
  await page.evaluate(() => (document.querySelector('#target') as HTMLVideoElement).play());

  await expect(page.locator('.canto-ocr-line')).toHaveCount(0, { timeout: 10000 });

  await page.close();
});

/** A frame the reader is still watching is one they have already left. */
test('no badge is offered while the video is playing', async () => {
  const page = await openPausedVideo();

  await page.evaluate(() => (document.querySelector('#target') as HTMLVideoElement).play());
  await page.waitForTimeout(300);
  await page.hover('#target');

  await expect(page.locator('.canto-ocr-badge')).toHaveCount(0);

  await page.close();
});
