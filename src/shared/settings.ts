/**
 * The reader's preferences, as every surface reads them.
 *
 * Kept in `chrome.storage.sync` under one key: the record is a few dozen bytes,
 * far under sync's 8 KB item limit, and a preference is exactly what a reader
 * expects to follow them to another machine. Pure code never reads storage —
 * the pages and the content script load these once, subscribe to changes, and
 * hand the values they need to the functions that use them.
 *
 * Each setting is declared once in {@link SETTING_SPECS}; its type, its default
 * and the way a stored value is checked all follow from that one line, so a
 * new toggle is a spec here and a label on the options page.
 */

import { MIN_COUNT } from './statistics-utils.js';

export type PrimaryLanguage ='mandarin' | 'cantonese';

/**
 * Which form of a word leads. `as-written` keeps whatever script the page used,
 * which is what the popup has always shown.
 */
export type ScriptPreference = 'as-written' | 'traditional' | 'simplified';

interface IntegerSpec {
  kind: 'integer';
  default: number;
  min: number;
  max: number;
}

interface ChoiceSpec<T extends string> {
  kind: 'choice';
  default: T;
  options: readonly T[];
}

interface BooleanSpec {
  kind: 'boolean';
  default: boolean;
}

export type SettingSpec = IntegerSpec | ChoiceSpec<string> | BooleanSpec;

const integer = (value: number, min: number, max: number): IntegerSpec =>
  ({ kind: 'integer', default: value, min, max });

const choice = <T extends string>(value: T, options: readonly T[]): ChoiceSpec<T> =>
  ({ kind: 'choice', default: value, options });

const boolean = (value: boolean): BooleanSpec => ({ kind: 'boolean', default: value });

/** Every default reproduces what the extension did before it had settings. */
export const SETTING_SPECS = {
  maxCards: integer(20, 1, 100),
  // Zero is allowed on purpose: a reader behind on reviews can stop new cards
  // arriving until the backlog is cleared.
  maxNewCards: integer(10, 0, 50),
  minCount: integer(MIN_COUNT, 1, 50),
  // Mandarin has always been the left-hand column.
  primaryLanguage: choice<PrimaryLanguage>('mandarin', ['mandarin', 'cantonese']),
  script: choice<ScriptPreference>('as-written', ['as-written', 'traditional', 'simplified']),
  hideRomanisation: boolean(false),
  // Off by default: marking a page is a change to every site the reader visits,
  // and it costs a pass over the page's text that a reader who never asked for
  // it should not pay.
  markUnknownWords: boolean(false),
} as const;

type ValueOf<S> =
  S extends IntegerSpec ? number
    : S extends BooleanSpec ? boolean
      : S extends ChoiceSpec<infer T> ? T
        : never;

export type SettingKey = keyof typeof SETTING_SPECS;

export type Settings = { readonly [K in SettingKey]: ValueOf<(typeof SETTING_SPECS)[K]> };

/** The settings a definition is drawn with, on whichever surface draws it. */
export type DisplaySettings = Pick<Settings, 'primaryLanguage' | 'script' | 'hideRomanisation'>;

export const SETTINGS_KEY = 'settings';

export const SETTING_KEYS = Object.keys(SETTING_SPECS) as SettingKey[];

export const DEFAULT_SETTINGS: Settings = Object.fromEntries(
  SETTING_KEYS.map(key => [key, SETTING_SPECS[key].default]),
) as unknown as Settings;

function normaliseValue(spec: SettingSpec, value: unknown): unknown {
  switch (spec.kind) {
    case 'integer':
      if (typeof value !== 'number' || !Number.isFinite(value)) return spec.default;
      return Math.min(spec.max, Math.max(spec.min, Math.round(value)));
    case 'choice':
      return typeof value === 'string' && spec.options.includes(value) ? value : spec.default;
    case 'boolean':
      return typeof value === 'boolean' ? value : spec.default;
  }
}

/**
 * A stored record made safe to use. Sync storage is written by every machine
 * the reader signs in on, including ones running an older or newer version, so
 * a missing, mistyped or out-of-range value falls back to its default or is
 * clamped rather than trusted — a session size of zero would empty the deck.
 */
export function normaliseSettings(raw: unknown): Settings {
  const stored = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  return Object.fromEntries(
    SETTING_KEYS.map(key => [key, normaliseValue(SETTING_SPECS[key], stored[key])]),
  ) as unknown as Settings;
}

export async function loadSettings(
  area: chrome.storage.StorageArea = chrome.storage.sync,
): Promise<Settings> {
  try {
    return normaliseSettings((await area.get([SETTINGS_KEY]))[SETTINGS_KEY]);
  } catch (error) {
    console.warn('[Settings] Failed to read settings:', error);
    return DEFAULT_SETTINGS;
  }
}

/** Applies a change on top of what is stored, and returns what was written. */
export async function saveSettings(
  changes: Partial<Settings>,
  area: chrome.storage.StorageArea = chrome.storage.sync,
): Promise<Settings> {
  const next = normaliseSettings({ ...(await loadSettings(area)), ...changes });
  await area.set({ [SETTINGS_KEY]: next });
  return next;
}

/**
 * Calls `listener` with the stored settings, then again whenever they change —
 * in this document or any other — so an open page follows the options page
 * without a reload. Returns the unsubscribe.
 */
export function watchSettings(listener: (settings: Settings) => void): () => void {
  // A change that lands before the first read resolves is newer than the read.
  let changed = false;

  const onChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ): void => {
    if (areaName !== 'sync' || !(SETTINGS_KEY in changes)) return;
    changed = true;
    listener(normaliseSettings(changes[SETTINGS_KEY]?.newValue));
  };

  chrome.storage.onChanged.addListener(onChanged);

  void loadSettings().then(settings => {
    if (!changed) listener(settings);
  });

  return () => chrome.storage.onChanged.removeListener(onChanged);
}
