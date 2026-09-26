import { describe, it, expect } from 'vitest';
import { listeningReading } from '../listening.js';

function voice(lang: string): SpeechSynthesisVoice {
  return { lang, name: lang, default: false, localService: true, voiceURI: lang } as SpeechSynthesisVoice;
}

describe('listeningReading', () => {
  it('plays Cantonese when a Cantonese voice exists', () => {
    expect(listeningReading([voice('zh-CN'), voice('zh-HK')])).toBe('jyutping');
  });

  it('falls back to Mandarin without a Cantonese voice', () => {
    expect(listeningReading([voice('en-US'), voice('zh-TW')])).toBe('pinyin');
  });

  it('offers nothing when no voice can say either reading', () => {
    expect(listeningReading([voice('en-US')])).toBeNull();
    expect(listeningReading([])).toBeNull();
  });
});
