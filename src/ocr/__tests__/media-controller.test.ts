// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../capture.js', async (original) => ({
  ...(await original<typeof import('../capture.js')>()),
  captureFrame: vi.fn(),
}));

import { MediaOcrManager } from '../media-controller.js';
import { captureFrame } from '../capture.js';
import type { OcrClient } from '../ocr-client.js';
import type { OcrResult } from '../../shared/types.js';

const RESULT: OcrResult = {
  width: 1920,
  height: 1080,
  items: [{ text: '今天天气很好', box: { x: 40, y: 900, width: 600, height: 60 } }],
};

function client(): OcrClient & { readImage: ReturnType<typeof vi.fn> } {
  return {
    readImage: vi.fn().mockResolvedValue(RESULT),
    captureTab: vi.fn().mockResolvedValue('data:image/png;base64,SHOT'),
  };
}

function addVideo(paused = true): HTMLVideoElement {
  const video = document.createElement('video');
  Object.defineProperty(video, 'videoWidth', { value: 1920, configurable: true });
  Object.defineProperty(video, 'videoHeight', { value: 1080, configurable: true });
  Object.defineProperty(video, 'paused', { value: paused, writable: true, configurable: true });
  video.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360 }) as DOMRect;
  document.body.appendChild(video);
  return video;
}

function hover(target: EventTarget): void {
  target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
}

function badge(): HTMLElement | null {
  return document.querySelector('.canto-ocr-badge');
}

/** Lets the read's promise chain settle. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let manager: MediaOcrManager;
let ocr: ReturnType<typeof client>;

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  vi.mocked(captureFrame).mockReset();
  vi.mocked(captureFrame).mockResolvedValue({ src: 'data:image/png;base64,FRAME', via: 'canvas' });
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));

  ocr = client();
  manager = new MediaOcrManager(document, ocr);
  manager.init();
});

afterEach(() => {
  manager.destroy();
  vi.unstubAllGlobals();
});

describe('the badge', () => {
  it('is offered on a paused video', () => {
    hover(addVideo(true));
    expect(badge()).not.toBeNull();
  });

  /**
   * Reading a frame the reader is still watching gives them a frame they have
   * already left, and the badge would fight the player's own controls.
   */
  it('is not offered while the video is playing', () => {
    hover(addVideo(false));
    expect(badge()).toBeNull();
  });

  /**
   * The way a reader actually reaches the frame they want read: space, `k` or
   * a click on the picture, none of which move the pointer off the video.
   */
  it('is offered when the video is paused under the cursor', () => {
    const video = addVideo(false);
    hover(video);
    expect(badge()).toBeNull();

    (video as { paused: boolean }).paused = true;
    video.dispatchEvent(new Event('pause'));

    expect(badge()).not.toBeNull();
  });

  it('is withdrawn when the video plays on under the cursor', () => {
    const video = addVideo(true);
    hover(video);

    (video as { paused: boolean }).paused = false;
    video.dispatchEvent(new Event('play'));

    expect(badge()).toBeNull();
  });

  it('is not offered on a video too small to hold readable text', () => {
    const video = addVideo(true);
    video.getBoundingClientRect = () => ({ left: 0, top: 0, width: 40, height: 30 }) as DOMRect;

    hover(video);
    expect(badge()).toBeNull();
  });
});

describe('reading a frame', () => {
  it('captures the frame and lays its text over the video', async () => {
    const video = addVideo(true);
    hover(video);
    badge()!.click();
    await settle();

    expect(captureFrame).toHaveBeenCalledTimes(1);
    expect(ocr.readImage).toHaveBeenCalledWith('data:image/png;base64,FRAME');
    expect(document.querySelector('.canto-ocr-line')?.textContent).toBe('今天天气很好');
  });

  it('marks the badge failed when the frame cannot be read', async () => {
    vi.mocked(captureFrame).mockRejectedValue(new Error('no frame'));
    hover(addVideo(true));
    badge()!.click();
    await settle();

    expect(badge()?.dataset.state).toBe('failed');
    expect(document.querySelector('.canto-ocr-line')).toBeNull();
  });

  // The reader clicked and waited out a model load; the badge disappearing
  // said nothing about whether it had worked.
  it('says so when the frame holds no Chinese', async () => {
    ocr.readImage.mockResolvedValue({ ...RESULT, items: [] });
    hover(addVideo(true));
    badge()!.click();
    await settle();

    expect(badge()?.dataset.state).toBe('empty');
    expect(badge()?.getAttribute('title')).toBe('No Chinese text found here');
  });

  it('offers a failed read another try', async () => {
    vi.mocked(captureFrame).mockRejectedValueOnce(new Error('no frame'));
    hover(addVideo(true));

    badge()!.click();
    await settle();
    expect(badge()?.getAttribute('title')).toBe('Could not read this — click to try again');

    badge()!.click();
    await settle();

    expect(document.querySelector('.canto-ocr-line')?.textContent).toBe('今天天气很好');
  });
});

describe('following playback', () => {
  async function readVideo(): Promise<HTMLVideoElement> {
    const video = addVideo(true);
    hover(video);
    badge()!.click();
    await settle();
    return video;
  }

  /** Text read off one frame is wrong for every frame after it. */
  it('clears the overlay when the video plays on', async () => {
    const video = await readVideo();
    expect(document.querySelector('.canto-ocr-line')).not.toBeNull();

    video.dispatchEvent(new Event('play'));

    expect(document.querySelector('.canto-ocr-line')).toBeNull();
  });

  it('reads the new frame after a seek, without another click', async () => {
    const video = await readVideo();
    Object.defineProperty(video, 'currentTime', { value: 42, configurable: true });

    video.dispatchEvent(new Event('seeked'));
    await settle();

    expect(captureFrame).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.canto-ocr-line')).not.toBeNull();
  });

  it('does not read the same frame twice', async () => {
    const video = await readVideo();

    // currentTime has not moved since the read.
    video.dispatchEvent(new Event('pause'));
    await settle();

    expect(captureFrame).toHaveBeenCalledTimes(1);
  });

  it('stops listening once the overlay is gone', async () => {
    const video = await readVideo();
    video.dispatchEvent(new Event('play'));

    Object.defineProperty(video, 'currentTime', { value: 99, configurable: true });
    video.dispatchEvent(new Event('seeked'));
    await settle();

    expect(captureFrame).toHaveBeenCalledTimes(1);
  });
});
