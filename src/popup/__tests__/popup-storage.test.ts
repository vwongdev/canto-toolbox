import { describe, it, expect, vi } from 'vitest';
import { PopupStorageClient } from '../popup-storage.js';
import { RedundantStore } from '../../shared/redundant-store.js';
import { StorageManager } from '../../shared/storage-manager.js';
import type { Statistics } from '../../shared/types.js';

const makeStore = (sync: chrome.storage.StorageArea, local: chrome.storage.StorageArea) =>
  new RedundantStore(new StorageManager(sync, local));

const makeSyncStorage = () => ({
  get: vi.fn().mockResolvedValue({}),
  set: vi.fn().mockResolvedValue(undefined),
} as unknown as chrome.storage.StorageArea);

const makeLocalStorage = () => ({
  get: vi.fn().mockResolvedValue({}),
  set: vi.fn().mockResolvedValue(undefined),
} as unknown as chrome.storage.StorageArea);

describe('PopupStorageClient', () => {
  describe('updateStatistics', () => {
    it('does not throw for a valid word', () => {
      const client = new PopupStorageClient(makeStore(makeSyncStorage(), makeLocalStorage()));
      expect(() => client.updateStatistics('好')).not.toThrow();
    });

    it('ignores empty strings', () => {
      const sync = makeSyncStorage();
      const client = new PopupStorageClient(makeStore(sync, makeLocalStorage()));
      client.updateStatistics('');
      expect(sync.set).not.toHaveBeenCalled();
    });

    it('ignores whitespace-only strings', () => {
      const sync = makeSyncStorage();
      const client = new PopupStorageClient(makeStore(sync, makeLocalStorage()));
      client.updateStatistics('   ');
      expect(sync.set).not.toHaveBeenCalled();
    });
  });

  describe('eviction', () => {
    /** Fill past the 500-word cap with words that all outrank a rare one on count. */
    function crowdedStatistics(): Statistics {
      const stats: Statistics = {};
      for (let i = 0; i < 600; i++) {
        stats[`字${i}`] = { count: 100, firstSeen: 1, lastSeen: 2 };
      }
      return stats;
    }

    async function flush(existing: Statistics): Promise<Statistics> {
      const sync = makeSyncStorage();
      (sync.get as ReturnType<typeof vi.fn>).mockResolvedValue({ wordStatistics: existing });

      const client = new PopupStorageClient(makeStore(sync, makeLocalStorage()));
      client.updateStatistics('觸發');
      await vi.waitFor(() => expect(sync.set).toHaveBeenCalled());

      return (sync.set as ReturnType<typeof vi.fn>).mock.calls[0]![0].wordStatistics as Statistics;
    }

    it('keeps a reviewed word that hover count alone would evict', async () => {
      const stats = crowdedStatistics();
      stats['稀有'] = {
        count: 1,
        firstSeen: 1,
        lastSeen: 2,
        flashcard: { reviews: 3, consecutiveCorrect: 2 },
      };

      const written = await flush(stats);

      expect(Object.keys(written)).toHaveLength(500);
      expect(written['稀有']).toBeDefined();
    });

    it('still evicts unreviewed words down to the cap', async () => {
      const written = await flush(crowdedStatistics());
      expect(Object.keys(written)).toHaveLength(500);
    });

    /** A deck that fills the cap on its own has to be ranked within itself. */
    function reviewedDeck(size: number): Statistics {
      const stats: Statistics = {};
      for (let i = 0; i < size; i++) {
        stats[`字${i}`] = {
          count: 1,
          firstSeen: 1,
          lastSeen: 2,
          flashcard: { reviews: 3, consecutiveCorrect: 1, lastReviewed: 1000 + i },
        };
      }
      return stats;
    }

    it('keeps the most recently reviewed words when the deck alone fills the cap', async () => {
      const written = await flush(reviewedDeck(600));

      expect(Object.keys(written)).toHaveLength(500);
      expect(written['字599']).toBeDefined();
      expect(written['字0']).toBeUndefined();
    });

    it('ranks a word reviewed in any direction above an unreviewed one', async () => {
      const stats = crowdedStatistics();
      stats['造句'] = {
        count: 1,
        firstSeen: 1,
        lastSeen: 2,
        production: { reviews: 2, consecutiveCorrect: 1, lastReviewed: 5000 },
      };

      const written = await flush(stats);

      expect(written['造句']).toBeDefined();
    });

    it('keeps a retired word ahead of words known only from hovering', async () => {
      const stats = crowdedStatistics();
      stats['退休'] = { count: 1, firstSeen: 1, lastSeen: 2, suppressed: true };

      const written = await flush(stats);

      expect(written['退休']).toBeDefined();
    });
  });

  describe('decisions', () => {
    /** Run `act` against a record, and return what its one batch wrote. */
    async function written(existing: Statistics, act: (client: PopupStorageClient) => void) {
      const sync = makeSyncStorage();
      (sync.get as ReturnType<typeof vi.fn>).mockResolvedValue({ wordStatistics: existing });

      const client = new PopupStorageClient(makeStore(sync, makeLocalStorage()));
      act(client);
      await vi.waitFor(() => expect(sync.set).toHaveBeenCalled());

      return (sync.set as ReturnType<typeof vi.fn>).mock.calls[0]![0].wordStatistics as Statistics;
    }

    it('records a word marked known without counting it as a sighting', async () => {
      const stats = await written({}, client => {
        client.setStatus('謝謝', { suppressed: true }, { rank: 312 });
      });

      expect(stats['謝謝']).toMatchObject({ count: 0, suppressed: true, rank: 312 });
    });

    it('keeps a word retired when a dwell lands after Known', async () => {
      const stats = await written({}, client => {
        client.setStatus('謝謝', { suppressed: true });
        client.updateStatistics('謝謝');
      });

      expect(stats['謝謝']).toMatchObject({ count: 1, suppressed: true });
    });

    it('lets the later of Study and Known decide', async () => {
      const known = await written({}, client => {
        client.updateStatistics('謝謝', { pinned: true });
        client.setStatus('謝謝', { suppressed: true });
      });
      expect(known['謝謝']).toMatchObject({ count: 1, suppressed: true });
      expect(known['謝謝']!.pinned).toBeUndefined();

      const studied = await written({}, client => {
        client.setStatus('謝謝', { suppressed: true });
        client.updateStatistics('謝謝', { pinned: true });
      });
      expect(studied['謝謝']).toMatchObject({ count: 1, pinned: true });
      expect(studied['謝謝']!.suppressed).toBeUndefined();
    });

    it('pins a word when Study follows a dwell in the same batch', async () => {
      const stats = await written({}, client => {
        client.updateStatistics('謝謝', { context: '真的很謝謝你' });
        client.updateStatistics('謝謝', { pinned: true });
      });

      expect(stats['謝謝']).toMatchObject({ count: 2, pinned: true, context: '真的很謝謝你' });
    });

    it('puts a retired word back without a sighting', async () => {
      const stats = await written(
        { 謝謝: { count: 3, firstSeen: 1, lastSeen: 2, suppressed: true } },
        client => client.setStatus('謝謝', { suppressed: false }),
      );

      expect(stats['謝謝']).toEqual({ count: 3, firstSeen: 1, lastSeen: 2 });
    });

    it('records nothing for a Known taken back before the word was ever tracked', async () => {
      const stats = await written({}, client => {
        client.setStatus('謝謝', { suppressed: true });
        client.setStatus('謝謝', { suppressed: false });
        client.updateStatistics('好');
      });

      expect(stats['謝謝']).toBeUndefined();
    });
  });

  describe('statusOf', () => {
    const record: Statistics = { 謝謝: { count: 3, firstSeen: 1, lastSeen: 2, pinned: true } };

    it('reports the stored decisions about a word', () => {
      const client = new PopupStorageClient(makeStore(makeSyncStorage(), makeLocalStorage()));

      expect(client.statusOf('謝謝', record)).toEqual({ pinned: true });
      expect(client.statusOf('好', record)).toEqual({});
    });

    it('reports a decision still waiting for its batch', () => {
      const client = new PopupStorageClient(makeStore(makeSyncStorage(), makeLocalStorage()));
      client.setStatus('謝謝', { suppressed: true });

      expect(client.statusOf('謝謝', record)).toEqual({ suppressed: true });
    });
  });
});
