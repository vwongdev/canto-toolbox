import { request } from '../shared/message-manager.js';
import type { OcrResult } from '../shared/types.js';

export interface OcrClient {
  readImage(src: string): Promise<OcrResult>;
  /** PNG data URL of the visible tab. */
  captureTab(): Promise<string>;
}

export const ocrClient: OcrClient = {
  readImage: async (src) => (await request({ type: 'ocr_image', src })).result,
  captureTab: async () => (await request({ type: 'capture_tab' })).dataUrl,
};
