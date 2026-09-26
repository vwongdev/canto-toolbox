import { describe, it, expect, vi, afterEach } from 'vitest';
import { findVoice, whenVoicesReady } from '../speech.js';

function voice(lang: string, name = lang): SpeechSynthesisVoice {
  return { lang, name, default: false, localService: true, voiceURI: name } as SpeechSynthesisVoice;
}

describe('findVoice', () => {
  it('picks a Cantonese voice for Jyutping', () => {
    const voices = [voice('en-US'), voice('zh-CN'), voice('zh-HK')];
    expect(findVoice(voices, 'jyutping')?.lang).toBe('zh-HK');
  });

  it('picks a Mandarin voice for Pinyin', () => {
    const voices = [voice('zh-HK'), voice('zh-CN')];
    expect(findVoice(voices, 'pinyin')?.lang).toBe('zh-CN');
  });

  it('never reads Jyutping with a Mandarin voice', () => {
    // The wrong pronunciation is worse than no audio at all.
    expect(findVoice([voice('zh-CN'), voice('zh-TW')], 'jyutping')).toBeNull();
  });

  it('accepts yue as Cantonese', () => {
    expect(findVoice([voice('yue')], 'jyutping')?.lang).toBe('yue');
  });

  it('matches regardless of case or underscores', () => {
    expect(findVoice([voice('zh_HK')], 'jyutping')?.lang).toBe('zh_HK');
    expect(findVoice([voice('ZH-CN')], 'pinyin')?.lang).toBe('ZH-CN');
  });

  it('accepts a regional variant of an acceptable tag', () => {
    expect(findVoice([voice('zh-HK-hant')], 'jyutping')?.lang).toBe('zh-HK-hant');
  });

  it('returns null when no voice fits', () => {
    expect(findVoice([voice('en-US'), voice('ja-JP')], 'pinyin')).toBeNull();
  });

  it('returns null for an empty voice list', () => {
    expect(findVoice([], 'pinyin')).toBeNull();
  });
});

describe('whenVoicesReady', () => {
  /** A synthesis whose voice list starts as given and fires `voiceschanged` on demand. */
  function stubSynthesis(initial: SpeechSynthesisVoice[]) {
    let voices = initial;
    const target = new EventTarget();
    vi.stubGlobal('SpeechSynthesisUtterance', class {});
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => voices,
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
    });

    return {
      load(loaded: SpeechSynthesisVoice[]) {
        voices = loaded;
        target.dispatchEvent(new Event('voiceschanged'));
      },
    };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('hands over a filled list at once', () => {
    stubSynthesis([voice('zh-HK')]);
    const callback = vi.fn();

    whenVoicesReady(callback);

    expect(callback).toHaveBeenCalledWith([voice('zh-HK')]);
  });

  it('waits for an empty list to load', () => {
    const synthesis = stubSynthesis([]);
    const callback = vi.fn();

    whenVoicesReady(callback);
    expect(callback).not.toHaveBeenCalled();

    synthesis.load([voice('zh-CN')]);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith([voice('zh-CN')]);
  });

  it('gives up on a list that never loads', () => {
    vi.useFakeTimers();
    stubSynthesis([]);
    const callback = vi.fn();

    whenVoicesReady(callback, 1000);
    vi.advanceTimersByTime(1000);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith([]);
  });

  it('answers once even if the voices load after the wait ran out', () => {
    vi.useFakeTimers();
    const synthesis = stubSynthesis([]);
    const callback = vi.fn();

    whenVoicesReady(callback, 1000);
    vi.advanceTimersByTime(1000);
    synthesis.load([voice('zh-CN')]);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('hands over nothing where the browser has no speech synthesis', () => {
    const callback = vi.fn();
    whenVoicesReady(callback);
    expect(callback).toHaveBeenCalledWith([]);
  });
});
