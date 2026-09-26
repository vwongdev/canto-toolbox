import { vi } from 'vitest';

// Global Chrome API mock used by background.ts module-level side effects.
// Must run before any test file imports background.ts (or content.ts which re-exports it).
vi.stubGlobal('chrome', {
  runtime: {
    onMessage: { addListener: vi.fn() },
    sendMessage: vi.fn(),
    lastError: null as chrome.runtime.LastError | null,
    getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
  },
  storage: {
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    sync: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
  },
});
