import { vi } from 'vitest';
import { storedWord, wordItems } from '../shared/stored-word.js';
import type { Statistics } from '../shared/types.js';

/** The quotas `chrome.storage.sync` enforces, for a fake that enforces them too. */
export const SYNC_QUOTAS = { bytes: 102_400, items: 512, bytesPerItem: 8192 };

interface Quotas {
  bytes?: number;
  items?: number;
  bytesPerItem?: number;
}

const encoder = new TextEncoder();
const sizeOf = (key: string, value: unknown) =>
  encoder.encode(key).length + encoder.encode(JSON.stringify(value)).length;

/**
 * An in-memory `chrome.storage` area. Values round-trip through JSON the way
 * the real one does, so a caller editing what it read cannot edit what is held.
 */
export function fakeArea(initial: Record<string, unknown> = {}, quotas: Quotas = {}) {
  const held = new Map<string, string>(
    Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]),
  );

  const snapshot = (keys?: string[]) =>
    Object.fromEntries(
      [...held]
        .filter(([key]) => !keys || keys.includes(key))
        .map(([key, value]) => [key, JSON.parse(value) as unknown]),
    );

  const area = {
    get: vi.fn(async (keys?: string | string[] | null) =>
      snapshot(keys == null ? undefined : typeof keys === 'string' ? [keys] : keys),
    ),
    set: vi.fn(async (items: Record<string, unknown>) => {
      const next = new Map(held);
      for (const [key, value] of Object.entries(items)) {
        if (sizeOf(key, value) > (quotas.bytesPerItem ?? Infinity)) {
          throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
        }
        next.set(key, JSON.stringify(value));
      }
      if (quotas.bytes !== undefined) {
        const bytes = [...next].reduce(
          (sum, [key, value]) => sum + encoder.encode(key).length + encoder.encode(value).length,
          0,
        );
        if (bytes > quotas.bytes) throw new Error('QUOTA_BYTES quota exceeded');
      }
      if (next.size > (quotas.items ?? Infinity)) throw new Error('MAX_ITEMS quota exceeded');
      for (const [key, value] of next) held.set(key, value);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of typeof keys === 'string' ? [keys] : keys) held.delete(key);
    }),
  };

  return {
    area: area as unknown as chrome.storage.StorageArea,
    mocks: area,
    /** Everything held, parsed. */
    items: () => snapshot(),
    /** The words held, decoded from whichever layout holds them. */
    words: () =>
      Object.fromEntries(
        Object.entries(snapshot()).flatMap(([key, value]) => {
          const held = storedWord(key, value);
          return held ? [held] : [];
        }),
      ),
  };
}

/** A record's words as the items the store keeps them in. */
export function asItems(words: Statistics): Record<string, unknown> {
  return wordItems(words);
}

/** A record's words as the plain items versions before the compact layout kept. */
export function asLegacyItems(words: Statistics): Record<string, unknown> {
  return Object.fromEntries(Object.entries(words).map(([word, stat]) => [`word:${word}`, stat]));
}
