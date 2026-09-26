import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  loadSettings,
  normaliseSettings,
  saveSettings,
  watchSettings,
} from '../settings.js';

function makeArea(stored: Record<string, unknown> = {}): chrome.storage.StorageArea {
  return {
    get: vi.fn().mockResolvedValue(stored),
    set: vi.fn().mockResolvedValue(undefined),
  } as unknown as chrome.storage.StorageArea;
}

describe('normaliseSettings', () => {
  it('reproduces the behaviour the extension had before settings', () => {
    expect(normaliseSettings(undefined)).toEqual({
      maxCards: 20,
      maxNewCards: 10,
      minCount: 5,
      primaryLanguage: 'mandarin',
      script: 'as-written',
      hideRomanisation: false,
    });
  });

  it('keeps valid stored values', () => {
    const stored = {
      maxCards: 40,
      maxNewCards: 0,
      minCount: 2,
      primaryLanguage: 'cantonese',
      script: 'traditional',
      hideRomanisation: true,
    };
    expect(normaliseSettings(stored)).toEqual(stored);
  });

  it('clamps and rounds numbers into range', () => {
    const settings = normaliseSettings({ maxCards: 0, maxNewCards: 999, minCount: 2.6 });
    expect(settings.maxCards).toBe(1);
    expect(settings.maxNewCards).toBe(50);
    expect(settings.minCount).toBe(3);
  });

  it('falls back to the default for a value of the wrong type or outside the options', () => {
    const settings = normaliseSettings({
      maxCards: '30',
      minCount: Number.NaN,
      primaryLanguage: 'klingon',
      hideRomanisation: 'yes',
    });
    expect(settings.maxCards).toBe(DEFAULT_SETTINGS.maxCards);
    expect(settings.minCount).toBe(DEFAULT_SETTINGS.minCount);
    expect(settings.primaryLanguage).toBe(DEFAULT_SETTINGS.primaryLanguage);
    expect(settings.hideRomanisation).toBe(DEFAULT_SETTINGS.hideRomanisation);
  });

  it('drops keys it does not know', () => {
    expect(normaliseSettings({ retired: true })).toEqual(DEFAULT_SETTINGS);
  });
});

describe('loadSettings', () => {
  it('reads the settings key', async () => {
    const area = makeArea({ [SETTINGS_KEY]: { minCount: 3 } });
    expect((await loadSettings(area)).minCount).toBe(3);
  });

  it('returns the defaults when storage fails', async () => {
    const area = makeArea();
    vi.mocked(area.get).mockRejectedValue(new Error('unavailable'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadSettings(area)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('saveSettings', () => {
  it('merges the change into what is stored and writes the normalised whole', async () => {
    const area = makeArea({ [SETTINGS_KEY]: { maxCards: 30 } });

    const saved = await saveSettings({ minCount: 500 }, area);

    expect(saved).toEqual({ ...DEFAULT_SETTINGS, maxCards: 30, minCount: 50 });
    expect(area.set).toHaveBeenCalledWith({ [SETTINGS_KEY]: saved });
  });
});

describe('watchSettings', () => {
  type Listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;

  function registeredListener(): Listener {
    const calls = vi.mocked(chrome.storage.onChanged.addListener).mock.calls;
    return calls[calls.length - 1]![0] as unknown as Listener;
  }

  beforeEach(() => {
    vi.mocked(chrome.storage.sync.get).mockResolvedValue({} as never);
  });

  it('delivers the stored settings, then each change to them', async () => {
    const listener = vi.fn();
    watchSettings(listener);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(DEFAULT_SETTINGS));

    registeredListener()({ [SETTINGS_KEY]: { newValue: { minCount: 2 } } }, 'sync');

    expect(listener).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, minCount: 2 });
  });

  it('ignores other keys and other storage areas', async () => {
    const listener = vi.fn();
    watchSettings(listener);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));

    registeredListener()({ statistics: { newValue: {} } }, 'sync');
    registeredListener()({ [SETTINGS_KEY]: { newValue: {} } }, 'local');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not let a slow first read overwrite a newer change', async () => {
    let resolveRead: (value: Record<string, unknown>) => void = () => {};
    vi.mocked(chrome.storage.sync.get).mockReturnValue(
      new Promise(resolve => { resolveRead = resolve; }) as never,
    );
    const listener = vi.fn();
    watchSettings(listener);

    registeredListener()({ [SETTINGS_KEY]: { newValue: { minCount: 2 } } }, 'sync');
    resolveRead({});
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, minCount: 2 });
  });

  it('stops listening when unsubscribed', () => {
    const unsubscribe = watchSettings(vi.fn());
    const listener = registeredListener();

    unsubscribe();

    expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledWith(listener);
  });
});
