import { defineConfig } from 'vitest/config';

export default defineConfig({
  css: {
    // Tests compile imported SCSS without vite.config.ts, so repeat its opt-in.
    preprocessorOptions: { scss: { api: 'modern-compiler' } },
  },
  test: {
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'dictionaries/**', '.workflows/**', '.claude/**', '.claire/**', '.direnv/**', 'e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**', 'build-tools/**'],
      exclude: ['**/__tests__/**', '**/*.d.ts', 'src/__tests__/setup.ts'],
    },
  },
});
